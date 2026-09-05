import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState } from "react"
import { fetchTopicOverviews, type TopicOverview } from "../../kafka/topics"
import { useKafkaClient } from "../../kafka/KafkaClientContext"
import { theme } from "../../theme/monokai"
import { TopicDetail } from "./TopicDetail"

/**
 * No polling at this level (decision 6, phase 8 plan) — partition count and
 * replication factor are structural and don't change during a session the
 * way consumer-group lag does. Fetched once on mount; switching tabs away
 * and back is the implicit "refresh."
 */
export function TopicsTab() {
  const kafka = useKafkaClient()

  const [overviews, setOverviews] = useState<TopicOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    const admin = kafka.admin()
    let cancelled = false

    admin
      .connect()
      .then(() => fetchTopicOverviews(admin))
      .then((result) => {
        if (cancelled) return
        setOverviews(result)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setFetchError((err as Error).message)
        setLoading(false)
      })

    return () => {
      cancelled = true
      void admin.disconnect()
    }
  }, [kafka])

  const sortedTopics = useMemo(() => [...overviews].sort((a, b) => a.name.localeCompare(b.name)), [overviews])

  useKeyboard((key) => {
    if (detailOpen) return // TopicDetail owns its own useKeyboard while mounted (mount-scoped, see MessageDetail)

    switch (key.name) {
      case "up": {
        if (sortedTopics.length === 0) break
        const idx = sortedTopics.findIndex((t) => t.name === selectedTopic)
        const next = sortedTopics[idx <= 0 ? 0 : idx - 1]
        if (next) setSelectedTopic(next.name)
        break
      }
      case "down": {
        if (sortedTopics.length === 0) break
        const idx = sortedTopics.findIndex((t) => t.name === selectedTopic)
        const next = sortedTopics[idx === -1 ? 0 : Math.min(sortedTopics.length - 1, idx + 1)]
        if (next) setSelectedTopic(next.name)
        break
      }
      case "return":
        if (selectedTopic) setDetailOpen(true)
        break
    }
  })

  if (detailOpen && selectedTopic) {
    return <TopicDetail topic={selectedTopic} onClose={() => setDetailOpen(false)} />
  }

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>{`${sortedTopics.length} topic${sortedTopics.length === 1 ? "" : "s"}`}</text>
        {fetchError && (
          <text fg={theme.error} truncate wrapMode="none">
            {fetchError}
          </text>
        )}
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.fgDim} truncate wrapMode="none">
          {`${"TOPIC".padEnd(32)}${"PARTITIONS".padEnd(12)}REPLICATION`}
        </text>
      </box>
      <box style={{ flexGrow: 1, flexDirection: "column", overflow: "hidden" }}>
        {sortedTopics.length === 0 ? (
          <box style={{ flexGrow: 1, flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
            <text fg={theme.fgDim}>{loading ? "Loading…" : "No topics found."}</text>
          </box>
        ) : (
          sortedTopics.map((topic) => {
            const selected = topic.name === selectedTopic
            const row =
              `${topic.name.length > 31 ? `${topic.name.slice(0, 30)}…` : topic.name.padEnd(32)}` +
              `${String(topic.partitionCount).padEnd(12)}${topic.replicationFactor}`
            return (
              <box key={topic.name} style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
                <text fg={theme.fg} bg={selected ? theme.bgSelected : undefined} truncate wrapMode="none">
                  {row}
                </text>
              </box>
            )
          })
        )}
      </box>
    </box>
  )
}
