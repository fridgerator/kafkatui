import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RingBuffer, type RingBufferSlot } from "../../buffer/ringBuffer"
import { writeNdjsonExport } from "../../export/ndjson"
import { evaluateFilter } from "../../filter/evaluateFilter"
import { FilterParseError, parseFilter } from "../../filter/parseFilter"
import { useConsumeConfig } from "../../kafka/ConsumeConfigContext"
import { startConsuming, type ConsumeHandle, type StartPosition } from "../../kafka/consume"
import { decodeAvroMessage } from "../../kafka/decode/avro"
import { looksLikeConfluentAvro } from "../../kafka/decode/decodeMessage"
import { useKafkaClient } from "../../kafka/KafkaClientContext"
import { parseTimestampInput } from "../../kafka/parseTimestampInput"
import { useSchemaRegistry } from "../../kafka/SchemaRegistryContext"
import { getOrDecode, getSearchableText, type BufferedMessage, type ConnectionState, type RawMessage } from "../../kafka/types"
import { SearchBox } from "../SearchBox"
import { theme } from "../../theme/monokai"
import { ConsumerConfigModal, type ConsumerConfigModalSubmitValue } from "./ConsumerConfigModal"
import { MessageDetail } from "./MessageDetail"
import { MessageList } from "./MessageList"
import { TopicBar } from "./TopicBar"

type Mode = "browse" | "configuring" | "editingSearch" | "detail"

const FILTER_PREFIX = "@filter:"

/** ~16Hz — within spec §6.3's "max 10-20 UI updates/sec" band. */
const FLUSH_INTERVAL_MS = 62
/** Safety net against pathological bursts between flush ticks; realistic bursts never get close. */
const PENDING_QUEUE_CAP = 2000

export interface ConsumeStatus {
  connection: ConnectionState
  topic: string | null
}

interface ConsumeTabProps {
  ringBufferSize: number
  onStatusChange: (status: ConsumeStatus) => void
  onInputActiveChange: (active: boolean) => void
}

type Matcher = (slot: RingBufferSlot<BufferedMessage>) => boolean

/** Compiles the active query text into a matcher. `null` matcher means "no filter, show everything." */
function compileQuery(query: string): { matcher: Matcher | null; error: string | null; isFilterMode: boolean } {
  const trimmed = query.trim()
  if (!trimmed) return { matcher: null, error: null, isFilterMode: false }

  if (trimmed.startsWith(FILTER_PREFIX)) {
    const expr = trimmed.slice(FILTER_PREFIX.length)
    try {
      const parsed = parseFilter(expr)
      const matcher: Matcher = (slot) => {
        const decoded = getOrDecode(slot.value)
        return decoded.kind === "json" && decoded.value !== undefined && evaluateFilter(parsed, decoded.value)
      }
      return { matcher, error: null, isFilterMode: true }
    } catch (err) {
      const message = err instanceof FilterParseError ? err.message : String(err)
      // A parse failure shows the whole unfiltered buffer plus the error, rather than
      // freezing on a stale filtered view — the common case is a query still being typed.
      return { matcher: null, error: message, isFilterMode: true }
    }
  }

  const needle = trimmed.toLowerCase()
  const matcher: Matcher = (slot) => getSearchableText(slot.value).toLowerCase().includes(needle)
  return { matcher, error: null, isFilterMode: false }
}

/**
 * Pure. The raw upper seq bound for the visible window is normally `viewportStartSeq + rowCount
 * - 1`, computed fresh every render — while following the live tail this is exactly what's
 * wanted (it naturally rises as `newestSeq` does). But it's *also* what's used while paused, and
 * a fixed row-count-sized window will happily backfill with messages that arrive after pausing
 * if the screen wasn't already full at that moment (e.g. you just connected, watched a handful
 * of messages, then paused before a full screen accumulated) — from the user's perspective the
 * list keeps growing/appending despite "paused" being shown, which is the actual bug this fixes.
 * `pausedAtSeq` is the buffer's `newestSeq` captured at the exact moment pausing began (`null`
 * while following, meaning "no cap") — once set, the window can never extend past it, so a
 * screen that wasn't full when you paused just stays partially full instead of quietly catching
 * up. Eviction (the buffer's `oldestSeq` outrunning `viewportStartSeq` on a busy topic with a
 * small buffer) is the one case still allowed to move the window while paused — that's not
 * fixable without unbounded memory, since the data has genuinely been evicted.
 */
export function cappedEndSeq(viewportStartSeq: number, rowCount: number, pausedAtSeq: number | null): number {
  const rawEnd = viewportStartSeq + rowCount - 1
  return pausedAtSeq === null ? rawEnd : Math.min(rawEnd, pausedAtSeq)
}

export function ConsumeTab({ ringBufferSize, onStatusChange, onInputActiveChange }: ConsumeTabProps) {
  const kafka = useKafkaClient()
  const { client: schemaRegistryClient, config: schemaRegistryConfig } = useSchemaRegistry()
  const { config: consumeConfig, setConfig: setConsumeConfig } = useConsumeConfig()

  const ringBufferRef = useRef(new RingBuffer<BufferedMessage>(ringBufferSize))
  const pendingRef = useRef<RawMessage[]>([])
  const listBoxRef = useRef<BoxRenderable>(null)
  /** Tracks the in-flight `stop()` of the previous consumer so a reconnect can await it first. */
  const previousStopRef = useRef<Promise<void> | null>(null)

  const [mode, setMode] = useState<Mode>("browse")
  // The topic actually connected to (or being connected to) — distinct from
  // `consumeConfig.topic`, which is "whatever the modal last submitted" and persists across a
  // tab switch even though the live connection itself deliberately does not (see
  // ConsumeConfigContext.tsx's doc comment). Starts `null` on every mount: reconnecting is
  // always an explicit Connect press, never automatic.
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [connectRequest, setConnectRequest] = useState<{ topic: string; startPosition: StartPosition } | null>(null)
  const [connection, setConnection] = useState<ConnectionState>("disconnected")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<{ text: string; ok: boolean } | null>(null)

  const [searchDraft, setSearchDraft] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  const [detailSlot, setDetailSlot] = useState<RingBufferSlot<BufferedMessage> | null>(null)

  const [rowCount, setRowCount] = useState(1)
  const [viewportStartSeq, setViewportStartSeq] = useState(0)
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [following, setFollowing] = useState(true)
  const [droppedCount, setDroppedCount] = useState(0)
  const [msgsPerSecond, setMsgsPerSecond] = useState(0)
  const [tick, setTick] = useState(0) // bumped whenever the buffer or the compiled matcher changed

  // The query actually in effect: the live draft while editing search, else the committed one
  // (spec §6.4 — filtering re-runs live "when first typed", not only on submit).
  const activeQueryText = mode === "editingSearch" ? searchDraft : searchQuery
  const { matcher, error: queryError, isFilterMode } = useMemo(() => compileQuery(activeQueryText), [activeQueryText])

  const followingRef = useRef(following)
  useEffect(() => {
    followingRef.current = following
  }, [following])
  const rowCountRef = useRef(rowCount)
  useEffect(() => {
    rowCountRef.current = rowCount
  }, [rowCount])
  const matcherRef = useRef<Matcher | null>(matcher)
  useEffect(() => {
    matcherRef.current = matcher
  }, [matcher])
  /** Set inside the flush loop each tick it ran; read directly during render, same convention as `ringBufferRef`. */
  const matchesRef = useRef<RingBufferSlot<BufferedMessage>[] | null>(null)
  const lastMatcherRef = useRef<Matcher | null | undefined>(undefined)
  /** `null` while following; set to the buffer's `newestSeq` at the exact moment pausing began.
   *  See `cappedEndSeq()`'s doc comment for why this exists. */
  const pausedAtSeqRef = useRef<number | null>(null)

  useEffect(() => {
    onStatusChange({ connection, topic: activeTopic })
  }, [connection, activeTopic, onStatusChange])

  useEffect(() => {
    // "detail" isn't a text input — quitting or switching tabs while viewing a message
    // should still work. "configuring" blocks everything for its whole open duration (a modal
    // conventionally traps all input, not just while a sub-field is text-editing — see
    // ConsumerConfigModal.tsx's doc comment); "editingSearch" only blocks while text-entering.
    onInputActiveChange(mode === "configuring" || mode === "editingSearch")
  }, [mode, onInputActiveChange])

  // Measure available rows via the renderer's own size-change event rather than
  // hardcoding chrome-height arithmetic — robust to any future change in the
  // surrounding StatusBar/TabBar/HintBar/TopicBar/SearchBox heights.
  useEffect(() => {
    const box = listBoxRef.current
    if (!box) return
    const measure = () => setRowCount(Math.max(1, box.height))
    measure()
    box.onSizeChange = measure
    return () => {
      box.onSizeChange = undefined
    }
  }, [])

  // Consumer lifecycle: (re)connect whenever a new connect request arrives — a fresh
  // object each submit (see handleSubmitTopic) so even reconnecting to the same topic
  // with a different start-position setting reruns this effect. Search/filter state
  // intentionally does NOT appear in this effect's dependencies — typing a query must
  // never disconnect and reconnect the consumer.
  useEffect(() => {
    if (!connectRequest) return

    ringBufferRef.current = new RingBuffer<BufferedMessage>(ringBufferSize)
    pendingRef.current = []
    matchesRef.current = null
    lastMatcherRef.current = undefined
    pausedAtSeqRef.current = null
    setViewportStartSeq(0)
    setSelectedSeq(null)
    setFollowing(true)
    setDroppedCount(0)
    setMsgsPerSecond(0)
    setErrorMessage(null)
    setExportStatus(null)
    setTick((t) => t + 1)

    let sentSinceLastMeasure = 0
    let lastMeasureAt = Date.now()

    const flushInterval = setInterval(() => {
      const buffer = ringBufferRef.current
      const pending = pendingRef.current
      const hasNewMessages = pending.length > 0
      const currentMatcher = matcherRef.current
      const matcherChanged = currentMatcher !== lastMatcherRef.current

      if (hasNewMessages) {
        for (const raw of pending) {
          const slot = buffer.push(raw)
          // Avro decode needs an HTTP round-trip on a cache miss, so it can't happen
          // inline like the JSON/text paths in decodeMessage() (a render function can't
          // await a promise). Kicked off here instead — still off the render path,
          // still before any setState below triggers a re-render — with `decoded` set
          // to a synchronous "pending" placeholder in the meantime.
          if (schemaRegistryClient && raw.value && looksLikeConfluentAvro(raw.value)) {
            const value = raw.value
            slot.value.decoded = { kind: "pending", preview: "⏳ decoding avro…" }
            void decodeAvroMessage(schemaRegistryClient, value).then((decoded) => {
              slot.value.decoded = decoded
              setTick((t) => t + 1)
            })
          }
        }
        pendingRef.current = []
        sentSinceLastMeasure += pending.length
      }

      if (hasNewMessages || matcherChanged) {
        lastMatcherRef.current = currentMatcher
        const allMatches = currentMatcher ? buffer.getRange(buffer.oldestSeq, buffer.newestSeq).filter(currentMatcher) : null
        matchesRef.current = allMatches

        if (followingRef.current) {
          const rc = rowCountRef.current
          if (allMatches) {
            const tailStart = Math.max(0, allMatches.length - rc)
            const tailStartSlot = allMatches[tailStart]
            const lastMatch = allMatches[allMatches.length - 1]
            setViewportStartSeq(tailStartSlot ? tailStartSlot.seq : buffer.oldestSeq)
            setSelectedSeq(lastMatch ? lastMatch.seq : null)
          } else {
            setViewportStartSeq(Math.max(buffer.oldestSeq, buffer.newestSeq - rc + 1))
            setSelectedSeq(buffer.newestSeq >= 0 ? buffer.newestSeq : null)
          }
        } else if (allMatches) {
          // Self-heal: if the selection no longer matches (filter changed) or was
          // evicted, fall back to the newest remaining match (decision 6).
          setSelectedSeq((s) => {
            if (s !== null && allMatches.some((m) => m.seq === s)) return s
            const last = allMatches[allMatches.length - 1]
            return last ? last.seq : null
          })
          setViewportStartSeq((v) => Math.max(v, buffer.oldestSeq))
        } else {
          setViewportStartSeq((v) => Math.max(v, buffer.oldestSeq))
          setSelectedSeq((s) => (s !== null && s < buffer.oldestSeq ? buffer.oldestSeq : s))
        }
        setTick((t) => t + 1)
      }

      const now = Date.now()
      const elapsedSec = (now - lastMeasureAt) / 1000
      if (elapsedSec >= 1) {
        setMsgsPerSecond(sentSinceLastMeasure / elapsedSec)
        sentSinceLastMeasure = 0
        lastMeasureAt = now
      }
    }, FLUSH_INTERVAL_MS)

    // The previous consumer's `stop()` must fully resolve before this one connects —
    // both share one `Kafka` client instance, and starting a new consumer while the
    // old one's disconnect is still in flight raced kafkajs's connection pool into a
    // spurious "This server does not host this topic-partition" error when switching
    // topics quickly (caught while testing this phase against the live stack).
    let cancelled = false
    let handle: ConsumeHandle | null = null

    const start = async () => {
      if (previousStopRef.current) {
        await previousStopRef.current.catch(() => {})
      }
      if (cancelled) return
      handle = startConsuming({
        kafka,
        topic: connectRequest.topic,
        startPosition: connectRequest.startPosition,
        onMessage: (raw) => {
          const pending = pendingRef.current
          if (pending.length >= PENDING_QUEUE_CAP) {
            pending.shift()
            setDroppedCount((d) => d + 1)
          }
          pending.push(raw)
        },
        onError: (err) => setErrorMessage(err.message),
        onStateChange: setConnection,
      })
    }
    void start()

    return () => {
      cancelled = true
      clearInterval(flushInterval)
      if (handle) {
        previousStopRef.current = handle.stop()
      }
    }
  }, [connectRequest, kafka, ringBufferSize, schemaRegistryClient])

  const handleModalSubmit = useCallback((value: ConsumerConfigModalSubmitValue) => {
    const { topic, startPosition, timestampInput } = value
    // Already validated inside the modal before it calls onSubmit — parseTimestampInput
    // returning null here would mean that validation regressed, not a real user error, so
    // falling back to "latest" rather than silently connecting from the wrong place.
    const resolved: StartPosition =
      startPosition === "timestamp"
        ? { timestamp: parseTimestampInput(timestampInput) ?? Date.now() }
        : startPosition
    setConsumeConfig(value)
    setActiveTopic(topic)
    setMode("browse")
    setConnectRequest({ topic, startPosition: resolved })
  }, [setConsumeConfig])

  const handleSubmitSearch = useCallback((value: string) => {
    setSearchQuery(value)
    setMode("browse")
  }, [])

  const snapToFollow = useCallback(() => {
    pausedAtSeqRef.current = null
    const buffer = ringBufferRef.current
    const matches = matchesRef.current
    if (matches) {
      if (matches.length === 0) {
        setSelectedSeq(null)
        return
      }
      const rc = rowCountRef.current
      const tailStart = Math.max(0, matches.length - rc)
      const startSlot = matches[tailStart]
      const lastSlot = matches[matches.length - 1]
      setViewportStartSeq(startSlot ? startSlot.seq : buffer.oldestSeq)
      setSelectedSeq(lastSlot ? lastSlot.seq : null)
      return
    }
    if (buffer.size === 0) {
      setSelectedSeq(null)
      return
    }
    setViewportStartSeq(Math.max(buffer.oldestSeq, buffer.newestSeq - rowCountRef.current + 1))
    setSelectedSeq(buffer.newestSeq)
  }, [])

  useKeyboard((key) => {
    if (mode === "configuring") {
      // ConsumerConfigModal owns its own useKeyboard while mounted (mount-scoped, same pattern
      // as MessageDetail) — nothing to do here beyond not falling through to the switch below.
      return
    }

    if (mode === "editingSearch") {
      if (key.name === "escape") {
        // Reverts to the last committed query — the draft never got written to
        // `searchQuery`, so simply leaving edit mode is enough (decision 4).
        setMode("browse")
      }
      return
    }

    if (mode === "detail") {
      // MessageDetail owns its own useKeyboard (escape/r/y) since it's only ever mounted
      // while this mode is active — mounting is already the scope guard, so nothing needs
      // handling here. This still has to exist so browse-mode keys (c/space/up/down/...)
      // don't also fire underneath the open detail pane.
      return
    }

    switch (key.name) {
      case "t":
        setMode("configuring")
        break
      case "/":
        // Prefilled with the current query, unlike the topic field — refining an
        // existing search is the common case here (decision 5).
        setSearchDraft(searchQuery)
        setMode("editingSearch")
        break
      case "return": {
        if (selectedSeq === null) break
        // Holds the slot object directly rather than re-looking it up by seq later —
        // if the ring buffer evicts this seq while the pane is open, the object itself
        // isn't destroyed (JS keeps it alive via this reference), so the detail view is
        // naturally immune to eviction (decision 2).
        const matches = matchesRef.current
        const slot = matches
          ? matches.find((m) => m.seq === selectedSeq)
          : ringBufferRef.current.getBySeq(selectedSeq)
        if (!slot) break
        setDetailSlot(slot)
        setMode("detail")
        break
      }
      case "space":
        setFollowing((was) => {
          const now = !was
          if (now) {
            snapToFollow()
          } else {
            pausedAtSeqRef.current = ringBufferRef.current.newestSeq
          }
          return now
        })
        break
      case "c":
        ringBufferRef.current.clear()
        matchesRef.current = matcherRef.current ? [] : null
        // A stale freeze point from before the clear would otherwise point past the end of the
        // now-empty buffer, which — since a stale cap that's too high behaves as no cap at all —
        // would let a paused view silently backfill again with whatever arrives post-clear.
        if (!following) pausedAtSeqRef.current = ringBufferRef.current.newestSeq
        setViewportStartSeq(0)
        setSelectedSeq(null)
        setDroppedCount(0)
        setExportStatus(null)
        setTick((t) => t + 1)
        break
      case "x": {
        // Exports whatever's currently matching the active search/filter, or the whole
        // buffer if none is active — "act on what you're looking at," same philosophy as
        // MessageDetail's `y` (copy the currently displayed view, not always the raw bytes).
        const toExport = (matchesRef.current ?? ringBufferRef.current.getRange(ringBufferRef.current.oldestSeq, ringBufferRef.current.newestSeq)).map(
          (slot) => slot.value,
        )
        if (toExport.length === 0) {
          setExportStatus({ text: "Nothing to export yet.", ok: false })
          break
        }
        try {
          const path = writeNdjsonExport(activeTopic ?? "messages", toExport)
          setExportStatus({ text: `Exported ${toExport.length} message${toExport.length === 1 ? "" : "s"} to ${path}`, ok: true })
        } catch (err) {
          setExportStatus({ text: `Export failed: ${(err as Error).message}`, ok: false })
        }
        break
      }
      case "up": {
        const buffer = ringBufferRef.current
        const matches = matchesRef.current
        // Only freeze on the *transition* into paused — repeated "up" presses while already
        // paused must not keep re-arming the cap to a later seq, or it'd defeat the freeze.
        const freezeIfNeeded = () => {
          if (following) pausedAtSeqRef.current = buffer.newestSeq
        }
        if (matches) {
          if (matches.length === 0) break
          freezeIfNeeded()
          setFollowing(false)
          setSelectedSeq((s) => {
            const idx = s === null ? matches.length - 1 : matches.findIndex((m) => m.seq === s)
            const prevSlot = matches[idx <= 0 ? 0 : idx - 1]
            if (!prevSlot) return s
            setViewportStartSeq((v) => Math.min(v, prevSlot.seq))
            return prevSlot.seq
          })
        } else {
          if (buffer.size === 0) break
          freezeIfNeeded()
          setFollowing(false)
          setSelectedSeq((s) => {
            const next = s === null ? buffer.newestSeq : Math.max(buffer.oldestSeq, s - 1)
            setViewportStartSeq((v) => Math.min(v, next))
            return next
          })
        }
        break
      }
      case "down": {
        const buffer = ringBufferRef.current
        const matches = matchesRef.current
        if (matches) {
          if (matches.length === 0) break
          setSelectedSeq((s) => {
            const idx = s === null ? -1 : matches.findIndex((m) => m.seq === s)
            const nextIdx = idx === -1 ? 0 : Math.min(matches.length - 1, idx + 1)
            const nextSlot = matches[nextIdx]
            if (!nextSlot) return s
            if (nextIdx >= matches.length - 1) {
              pausedAtSeqRef.current = null
              setFollowing(true)
            }
            setViewportStartSeq((v) => Math.max(v, nextSlot.seq - rowCountRef.current + 1))
            return nextSlot.seq
          })
        } else {
          if (buffer.size === 0) break
          setSelectedSeq((s) => {
            const next = s === null ? buffer.newestSeq : Math.min(buffer.newestSeq, s + 1)
            if (next >= buffer.newestSeq) {
              pausedAtSeqRef.current = null
              setFollowing(true)
            }
            setViewportStartSeq((v) => Math.max(v, next - rowCountRef.current + 1))
            return next
          })
        }
        break
      }
    }
  })

  const buffer = ringBufferRef.current
  const matches = matchesRef.current
  const visibleRows = useMemo(() => {
    const pausedAtSeq = pausedAtSeqRef.current
    const end = cappedEndSeq(viewportStartSeq, rowCount, pausedAtSeq)
    if (matches === null) {
      return buffer.getRange(viewportStartSeq, end)
    }
    const startIndex = matches.findIndex((m) => m.seq >= viewportStartSeq)
    const from = startIndex === -1 ? matches.length : startIndex
    if (pausedAtSeq === null) return matches.slice(from, from + rowCount)
    // Same cap, expressed as a count rather than a raw seq span: `matches` is sparse, so "up to
    // rowCount entries" and "nothing past `end`" are two independent limits, both needed. Only
    // worth searching for at all while actually paused — otherwise this would linearly rescan
    // the whole (possibly buffer-capacity-sized) matches array every tick for no reason.
    const overCapIndex = matches.findIndex((m) => m.seq > end)
    const availableEnd = overCapIndex === -1 ? matches.length : overCapIndex
    return matches.slice(from, Math.min(from + rowCount, availableEnd))
    // `tick` (not `buffer`/`matches` object identity alone) is the intentional invalidation
    // signal — both are mutable refs that change in place; `tick` is bumped exactly when
    // their contents changed.
  }, [tick, viewportStartSeq, rowCount, matches])

  const emptyMessage = !activeTopic
    ? "Press t to configure a topic."
    : connection === "connecting"
      ? "Connecting…"
      : connection === "failed"
        ? `Connection failed${errorMessage ? `: ${errorMessage}` : ""}`
        : matches !== null && matches.length === 0
          ? "No messages match."
          : "Waiting for messages…"

  const displayError = errorMessage ?? queryError

  if (mode === "detail" && detailSlot) {
    return (
      <MessageDetail
        slot={detailSlot}
        schemaRegistryConfig={schemaRegistryConfig}
        onClose={() => {
          setMode("browse")
          setDetailSlot(null)
        }}
      />
    )
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden", position: "relative" }}>
      <TopicBar topic={consumeConfig.topic} startPosition={consumeConfig.startPosition} timestampInput={consumeConfig.timestampInput} />
      <SearchBox
        editing={mode === "editingSearch"}
        draft={searchDraft}
        onDraftChange={setSearchDraft}
        onSubmit={handleSubmitSearch}
        committedQuery={searchQuery}
      />
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1, overflow: "hidden" }}>
        <text flexShrink={0} fg={theme.fgDim}>{`${buffer.size}/${buffer.getCapacity()} buffered`}</text>
        {matches !== null && (
          <text flexShrink={0} fg={theme.info}>{`${matches.length} match${matches.length === 1 ? "" : "es"} (searching last ${buffer.getCapacity()} buffered)`}</text>
        )}
        <text flexShrink={0} fg={theme.fgDim}>{`${msgsPerSecond.toFixed(1)} msgs/sec`}</text>
        {droppedCount > 0 && <text flexShrink={0} fg={theme.warning}>{`${droppedCount} dropped`}</text>}
        <text flexShrink={0} fg={following ? theme.success : theme.warning}>
          {following ? "following" : "paused (space to resume)"}
        </text>
        {displayError && (
          <text flexShrink={0} truncate wrapMode="none" fg={theme.error}>
            {displayError}
          </text>
        )}
        {exportStatus && (
          <text flexShrink={0} truncate wrapMode="none" fg={exportStatus.ok ? theme.success : theme.error}>
            {exportStatus.text}
          </text>
        )}
      </box>
      <box ref={listBoxRef} style={{ flexGrow: 1, flexDirection: "column", overflow: "hidden" }}>
        <MessageList
          rows={visibleRows}
          rowCount={rowCount}
          selectedSeq={selectedSeq}
          emptyMessage={emptyMessage}
          highlightQuery={matches !== null && !isFilterMode ? activeQueryText.trim() : undefined}
          filterActive={matches !== null && isFilterMode}
        />
      </box>
      {mode === "configuring" && (
        <ConsumerConfigModal
          initialTopic={consumeConfig.topic}
          initialStartPosition={consumeConfig.startPosition}
          initialTimestampInput={consumeConfig.timestampInput}
          onCancel={() => setMode("browse")}
          onSubmit={handleModalSubmit}
        />
      )}
    </box>
  )
}
