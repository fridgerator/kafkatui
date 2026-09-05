import { useKeyboard } from "@opentui/react"
import type { GroupSnapshot } from "../../kafka/groups"
import { Sparkline } from "../Sparkline"
import { theme } from "../../theme/monokai"

interface GroupDetailProps {
  snapshot: GroupSnapshot
  aggregateHistory: number[]
  getPartitionHistory: (topic: string, partition: number) => number[]
  onClose: () => void
}

/**
 * Owns its own `useKeyboard` for `Escape` rather than routing through
 * `GroupsTab`'s central handler — only ever mounted while detail mode is
 * active, so mounting is already the scope guard (same pattern as
 * `MessageDetail`, phase 6).
 */
export function GroupDetail({ snapshot, aggregateHistory, getPartitionHistory, onClose }: GroupDetailProps) {
  useKeyboard((key) => {
    if (key.name === "escape") onClose()
  })

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.accent}>{snapshot.groupId}</text>
        <text fg={theme.fgDim}>{`(${snapshot.state})`}</text>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>{`Aggregate lag: ${snapshot.totalLag.toLocaleString()}`}</text>
        <Sparkline values={aggregateHistory} fg={theme.info} />
      </box>
      <scrollbox focused style={{ flexGrow: 1 }}>
        <box style={{ flexDirection: "column", paddingLeft: 1 }}>
          <text fg={theme.fgDim}>Members:</text>
          {snapshot.members.length === 0 ? (
            <text fg={theme.fgDim}>  (none)</text>
          ) : (
            snapshot.members.map((member) => (
              <text key={member.memberId} fg={theme.fg} truncate wrapMode="none">
                {`  ${member.clientId.padEnd(20)} ${member.host.padEnd(16)} ${member.assignment
                  .map((a) => `${a.topic}[${a.partitions.join(",")}]`)
                  .join(" ")}`}
              </text>
            ))
          )}

          <text fg={theme.fgDim}> </text>
          <text fg={theme.fgDim} truncate wrapMode="none">
            {`${"TOPIC".padEnd(22)}${"PART".padEnd(6)}${"CURRENT".padStart(10)}  ${"LOG-END".padStart(10)}  ${"LAG".padStart(8)}  TREND`}
          </text>
          {snapshot.partitionLags.length === 0 ? (
            <text fg={theme.fgDim}>(no committed partitions)</text>
          ) : (
            snapshot.partitionLags.map((p) => {
              const history = getPartitionHistory(p.topic, p.partition)
              const row =
                `${p.topic.length > 21 ? `${p.topic.slice(0, 20)}…` : p.topic.padEnd(22)}` +
                `${String(p.partition).padEnd(6)}` +
                `${(p.currentOffset === null ? "—" : p.currentOffset.toLocaleString()).padStart(10)}  ` +
                `${p.logEndOffset.toLocaleString().padStart(10)}  ` +
                `${(p.lag === null ? "—" : p.lag.toLocaleString()).padStart(8)}  `
              return (
                <box key={`${p.topic}:${p.partition}`} style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
                  <text fg={theme.fg} truncate wrapMode="none">
                    {row}
                  </text>
                  <Sparkline values={history} fg={theme.info} />
                </box>
              )
            })
          )}
        </box>
      </scrollbox>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>esc: back</text>
      </box>
    </box>
  )
}
