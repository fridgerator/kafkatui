import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RingBuffer } from "../../buffer/ringBuffer"
import { startConsuming, type ConsumeHandle } from "../../kafka/consume"
import { useKafkaClient } from "../../kafka/KafkaClientContext"
import type { BufferedMessage, ConnectionState, RawMessage } from "../../kafka/types"
import { theme } from "../../theme/monokai"
import { MessageList } from "./MessageList"
import { TopicBar } from "./TopicBar"

type Mode = "browse" | "editingTopic"

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

export function ConsumeTab({ ringBufferSize, onStatusChange, onInputActiveChange }: ConsumeTabProps) {
  const kafka = useKafkaClient()

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

  const [rowCount, setRowCount] = useState(1)
  const [viewportStartSeq, setViewportStartSeq] = useState(0)
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [following, setFollowing] = useState(true)
  const [droppedCount, setDroppedCount] = useState(0)
  const [msgsPerSecond, setMsgsPerSecond] = useState(0)
  const [tick, setTick] = useState(0) // bumped once per flush to invalidate the visible-rows memo

  const followingRef = useRef(following)
  useEffect(() => {
    followingRef.current = following
  }, [following])
  const rowCountRef = useRef(rowCount)
  useEffect(() => {
    rowCountRef.current = rowCount
  }, [rowCount])

  useEffect(() => {
    onStatusChange({ connection, topic: activeTopic })
  }, [connection, activeTopic, onStatusChange])

  useEffect(() => {
    onInputActiveChange(mode === "editingTopic")
  }, [mode, onInputActiveChange])

  // Measure available rows via the renderer's own size-change event rather than
  // hardcoding chrome-height arithmetic — robust to any future change in the
  // surrounding StatusBar/TabBar/HintBar/TopicBar heights.
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
  // with a different start-position setting reruns this effect.
  useEffect(() => {
    if (!connectRequest) return

    ringBufferRef.current = new RingBuffer<BufferedMessage>(ringBufferSize)
    pendingRef.current = []
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
      const pending = pendingRef.current
      if (pending.length > 0) {
        const buffer = ringBufferRef.current
        for (const raw of pending) buffer.push(raw)
        pendingRef.current = []
        sentSinceLastMeasure += pending.length

        if (followingRef.current) {
          const rc = rowCountRef.current
          setViewportStartSeq(Math.max(buffer.oldestSeq, buffer.newestSeq - rc + 1))
          setSelectedSeq(buffer.newestSeq)
        } else {
          // Self-heal: a paused viewport can never point below the retained window (decision 4).
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
  }, [connectRequest, kafka, ringBufferSize])

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

  const snapToFollow = useCallback(() => {
    const buffer = ringBufferRef.current
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

    switch (key.name) {
      case "t":
        // Starts blank rather than prefilled with the active topic — the common case
        // for a debugging tool is switching to an unrelated topic, not tweaking the
        // current one, and prefilling would force clearing it first every time.
        setTopicDraft("")
        setMode("editingTopic")
        break
      case "e":
        setFromBeginning((v) => !v)
        break
      case "space":
        setFollowing((was) => {
          const now = !was
          if (now) snapToFollow()
          return now
        })
        break
      case "c":
        ringBufferRef.current.clear()
        setViewportStartSeq(0)
        setSelectedSeq(null)
        setDroppedCount(0)
        setTick((t) => t + 1)
        break
      case "up": {
        const buffer = ringBufferRef.current
        if (buffer.size === 0) break
        setFollowing(false)
        setSelectedSeq((s) => {
          const next = s === null ? buffer.newestSeq : Math.max(buffer.oldestSeq, s - 1)
          setViewportStartSeq((v) => Math.min(v, next))
          return next
        })
        break
      }
      case "down": {
        const buffer = ringBufferRef.current
        if (buffer.size === 0) break
        setSelectedSeq((s) => {
          const next = s === null ? buffer.newestSeq : Math.min(buffer.newestSeq, s + 1)
          if (next >= buffer.newestSeq) setFollowing(true)
          setViewportStartSeq((v) => Math.max(v, next - rowCountRef.current + 1))
          return next
        })
        break
      }
    }
  })

  const buffer = ringBufferRef.current
  const visibleRows = useMemo(
    () => buffer.getRange(viewportStartSeq, viewportStartSeq + rowCount - 1),
    // `tick` (not `buffer`) is the intentional invalidation signal — `buffer` is a mutable
    // ref target that changes in place; `tick` is bumped exactly when its contents changed.
    [tick, viewportStartSeq, rowCount],
  )

  const emptyMessage = !activeTopic
    ? "Press t to pick a topic."
    : connection === "connecting"
      ? "Connecting…"
      : connection === "failed"
        ? `Connection failed${errorMessage ? `: ${errorMessage}` : ""}`
        : "Waiting for messages…"

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <TopicBar
        mode={mode}
        topicDraft={topicDraft}
        onTopicDraftChange={setTopicDraft}
        onSubmit={handleSubmitTopic}
        activeTopic={activeTopic}
        fromBeginning={fromBeginning}
      />
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1, overflow: "hidden" }}>
        <text flexShrink={0} fg={theme.fgDim}>{`${buffer.size}/${buffer.getCapacity()} buffered`}</text>
        <text flexShrink={0} fg={theme.fgDim}>{`${msgsPerSecond.toFixed(1)} msgs/sec`}</text>
        {droppedCount > 0 && <text flexShrink={0} fg={theme.warning}>{`${droppedCount} dropped`}</text>}
        <text flexShrink={0} fg={following ? theme.success : theme.warning}>
          {following ? "following" : "paused (space to resume)"}
        </text>
        {errorMessage && (
          <text flexShrink={0} truncate wrapMode="none" fg={theme.error}>
            {errorMessage}
          </text>
        )}
      </box>
      <box ref={listBoxRef} style={{ flexGrow: 1, flexDirection: "column", overflow: "hidden" }}>
        <MessageList rows={visibleRows} rowCount={rowCount} selectedSeq={selectedSeq} emptyMessage={emptyMessage} />
      </box>
    </box>
  )
}
