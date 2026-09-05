import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RingBuffer, type RingBufferSlot } from "../../buffer/ringBuffer"
import { evaluateFilter } from "../../filter/evaluateFilter"
import { FilterParseError, parseFilter } from "../../filter/parseFilter"
import { startConsuming, type ConsumeHandle } from "../../kafka/consume"
import { decodeAvroMessage } from "../../kafka/decode/avro"
import { looksLikeConfluentAvro } from "../../kafka/decode/decodeMessage"
import { useKafkaClient } from "../../kafka/KafkaClientContext"
import { useSchemaRegistry } from "../../kafka/SchemaRegistryContext"
import { getOrDecode, getSearchableText, type BufferedMessage, type ConnectionState, type RawMessage } from "../../kafka/types"
import { SearchBox } from "../SearchBox"
import { theme } from "../../theme/monokai"
import { MessageDetail } from "./MessageDetail"
import { MessageList } from "./MessageList"
import { TopicBar } from "./TopicBar"

type Mode = "browse" | "editingTopic" | "editingSearch" | "detail"

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

export function ConsumeTab({ ringBufferSize, onStatusChange, onInputActiveChange }: ConsumeTabProps) {
  const kafka = useKafkaClient()
  const { client: schemaRegistryClient, config: schemaRegistryConfig } = useSchemaRegistry()

  const ringBufferRef = useRef(new RingBuffer<BufferedMessage>(ringBufferSize))
  const pendingRef = useRef<RawMessage[]>([])
  const listBoxRef = useRef<BoxRenderable>(null)
  /** Tracks the in-flight `stop()` of the previous consumer so a reconnect can await it first. */
  const previousStopRef = useRef<Promise<void> | null>(null)

  const [mode, setMode] = useState<Mode>("browse")
  const [topicDraft, setTopicDraft] = useState("")
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [fromBeginning, setFromBeginning] = useState(false)
  const [connectRequest, setConnectRequest] = useState<{ topic: string; fromBeginning: boolean } | null>(null)
  const [connection, setConnection] = useState<ConnectionState>("disconnected")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

  useEffect(() => {
    onStatusChange({ connection, topic: activeTopic })
  }, [connection, activeTopic, onStatusChange])

  useEffect(() => {
    // "detail" isn't a text input — quitting or switching tabs while viewing a message
    // should still work; only the two text-entry modes need to block global shortcuts.
    onInputActiveChange(mode === "editingTopic" || mode === "editingSearch")
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
    setViewportStartSeq(0)
    setSelectedSeq(null)
    setFollowing(true)
    setDroppedCount(0)
    setMsgsPerSecond(0)
    setErrorMessage(null)
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
        fromBeginning: connectRequest.fromBeginning,
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

  const handleSubmitTopic = useCallback(
    (value: string) => {
      const topic = value.trim()
      if (!topic) return
      setActiveTopic(topic)
      setMode("browse")
      setConnectRequest({ topic, fromBeginning })
    },
    [fromBeginning],
  )

  const handleSubmitSearch = useCallback((value: string) => {
    setSearchQuery(value)
    setMode("browse")
  }, [])

  const snapToFollow = useCallback(() => {
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
    if (mode === "editingTopic") {
      if (key.name === "escape") {
        setMode("browse")
        setTopicDraft("")
      }
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
        // Starts blank rather than prefilled with the active topic — the common case
        // for a debugging tool is switching to an unrelated topic, not tweaking the
        // current one, and prefilling would force clearing it first every time.
        setTopicDraft("")
        setMode("editingTopic")
        break
      case "/":
        // Prefilled with the current query, unlike the topic field — refining an
        // existing search is the common case here (decision 5).
        setSearchDraft(searchQuery)
        setMode("editingSearch")
        break
      case "e":
        setFromBeginning((v) => !v)
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
          if (now) snapToFollow()
          return now
        })
        break
      case "c":
        ringBufferRef.current.clear()
        matchesRef.current = matcherRef.current ? [] : null
        setViewportStartSeq(0)
        setSelectedSeq(null)
        setDroppedCount(0)
        setTick((t) => t + 1)
        break
      case "up": {
        const buffer = ringBufferRef.current
        const matches = matchesRef.current
        if (matches) {
          if (matches.length === 0) break
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
            if (nextIdx >= matches.length - 1) setFollowing(true)
            setViewportStartSeq((v) => Math.max(v, nextSlot.seq - rowCountRef.current + 1))
            return nextSlot.seq
          })
        } else {
          if (buffer.size === 0) break
          setSelectedSeq((s) => {
            const next = s === null ? buffer.newestSeq : Math.min(buffer.newestSeq, s + 1)
            if (next >= buffer.newestSeq) setFollowing(true)
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
    if (matches === null) {
      return buffer.getRange(viewportStartSeq, viewportStartSeq + rowCount - 1)
    }
    const startIndex = matches.findIndex((m) => m.seq >= viewportStartSeq)
    const from = startIndex === -1 ? matches.length : startIndex
    return matches.slice(from, from + rowCount)
    // `tick` (not `buffer`/`matches` object identity alone) is the intentional invalidation
    // signal — both are mutable refs that change in place; `tick` is bumped exactly when
    // their contents changed.
  }, [tick, viewportStartSeq, rowCount, matches])

  const emptyMessage = !activeTopic
    ? "Press t to pick a topic."
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
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <TopicBar
        mode={mode === "editingTopic" ? "editingTopic" : "browse"}
        topicDraft={topicDraft}
        onTopicDraftChange={setTopicDraft}
        onSubmit={handleSubmitTopic}
        activeTopic={activeTopic}
        fromBeginning={fromBeginning}
      />
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
    </box>
  )
}
