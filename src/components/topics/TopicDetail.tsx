import { useKeyboard } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import { fetchTopicDetail, type TopicDetail as TopicDetailData } from "../../kafka/topics"
import { useKafkaClient } from "../../kafka/KafkaClientContext"
import { Sparkline } from "../Sparkline"
import { fitCell, fitCellRight } from "../tableCell"
import { theme } from "../../theme/monokai"

const POLL_INTERVAL_MS = 5000
/** Matches Groups tab's sparkline window — ~2.5 minutes of trend at this cadence. */
const HISTORY_LENGTH = 30

interface TopicDetailProps {
  topic: string
  onClose: () => void
}

function pushCapped(history: number[], value: number): number[] {
  const next = [...history, value]
  return next.length > HISTORY_LENGTH ? next.slice(next.length - HISTORY_LENGTH) : next
}

/**
 * Owns its own `useKeyboard` for `Escape` only — only ever mounted while
 * detail mode is active, same mount-scoped pattern as `MessageDetail`/`GroupDetail`.
 */
export function TopicDetail({ topic, onClose }: TopicDetailProps) {
  const kafka = useKafkaClient()

  const [detail, setDetail] = useState<TopicDetailData | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const throughputHistoryRef = useRef(new Map<number, number[]>())
  const prevOffsetRef = useRef(new Map<number, number>())

  useEffect(() => {
    const admin = kafka.admin()
    let cancelled = false

    const poll = async () => {
      const result = await fetchTopicDetail(admin, topic)
      if (cancelled) return
      if (!result) {
        setPollError("Topic not found (it may have been deleted).")
        return
      }
      setPollError(null)

      for (const p of result.partitions) {
        const prev = prevOffsetRef.current.get(p.partitionId)
        // No rate on the very first sample — a delta needs two points.
        const rate = prev === undefined ? 0 : Math.max(0, (p.latestOffset - prev) / (POLL_INTERVAL_MS / 1000))
        prevOffsetRef.current.set(p.partitionId, p.latestOffset)
        const history = throughputHistoryRef.current.get(p.partitionId) ?? []
        throughputHistoryRef.current.set(p.partitionId, pushCapped(history, rate))
      }

      setDetail(result)
    }

    let interval: ReturnType<typeof setInterval> | undefined
    admin
      .connect()
      .then(() => {
        if (cancelled) return
        void poll()
        interval = setInterval(poll, POLL_INTERVAL_MS)
      })
      .catch((err) => {
        if (!cancelled) setPollError(`Failed to connect: ${(err as Error).message}`)
      })

    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
      void admin.disconnect()
    }
  }, [kafka, topic])

  useKeyboard((key) => {
    if (key.name === "escape") onClose()
  })

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.accent}>{topic}</text>
        {pollError && (
          <text fg={theme.error} truncate wrapMode="none">
            {pollError}
          </text>
        )}
      </box>

      {!detail ? (
        <box style={{ flexGrow: 1, flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          <text fg={theme.fgDim}>Loading…</text>
        </box>
      ) : (
        <scrollbox focused style={{ flexGrow: 1 }}>
          <box style={{ flexDirection: "column", paddingLeft: 1 }}>
            <text fg={theme.fgDim} truncate wrapMode="none">
              {`${fitCell("PART", 6)}${fitCell("LEADER", 8)}${fitCell("ISR", 10)}${fitCell("REPLICAS", 10)}${fitCellRight("EARLIEST", 10)}  ${fitCellRight("LATEST", 10)}  ${fitCellRight("COUNT", 10)}  THROUGHPUT`}
            </text>
            {detail.partitions.map((p) => {
              const history = throughputHistoryRef.current.get(p.partitionId) ?? []
              const row =
                fitCell(String(p.partitionId), 6) +
                fitCell(String(p.leader), 8) +
                fitCell(`[${p.isr.join(",")}]`, 10) +
                fitCell(`[${p.replicas.join(",")}]`, 10) +
                fitCellRight(p.earliestOffset.toLocaleString(), 10) +
                "  " +
                fitCellRight(p.latestOffset.toLocaleString(), 10) +
                "  " +
                fitCellRight(p.messageCount.toLocaleString(), 10) +
                "  "
              return (
                <box key={p.partitionId} style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                  <text fg={p.underReplicated ? theme.warning : theme.fg} truncate wrapMode="none">
                    {row}
                  </text>
                  <Sparkline values={history} fg={theme.info} />
                  {p.underReplicated && <text fg={theme.warning}>{"  ⚠ under-replicated"}</text>}
                </box>
              )
            })}

            <text fg={theme.fgDim}> </text>
            <text fg={theme.fgDim}>{`Config (${detail.configs.length} entries, non-default first):`}</text>
            {detail.configs.map((c) => (
              <text
                key={c.name}
                fg={c.isDefault ? theme.fgDim : theme.info}
                truncate
                wrapMode="none"
              >
                {`  ${c.name} = ${c.value === "" ? '""' : c.value}`}
              </text>
            ))}
          </box>
        </scrollbox>
      )}

      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>esc: back</text>
      </box>
    </box>
  )
}
