import type { StartPositionKind } from "../../kafka/ConsumeConfigContext"
import { theme } from "../../theme/monokai"

interface TopicBarProps {
  topic: string
  startPosition: StartPositionKind
  timestampInput: string
}

const START_POSITION_LABEL: Record<StartPositionKind, string> = {
  earliest: "earliest",
  latest: "latest",
  timestamp: "timestamp",
}

/**
 * Read-only status line — configuring a connection now happens exclusively in
 * `ConsumerConfigModal` (`t` opens it), reading its last-submitted values from
 * `ConsumeConfigContext` so this keeps showing them even while disconnected (e.g. right after
 * switching back to this tab, before pressing Connect again).
 */
export function TopicBar({ topic, startPosition, timestampInput }: TopicBarProps) {
  const positionLabel =
    startPosition === "timestamp" && timestampInput ? `timestamp: ${timestampInput}` : START_POSITION_LABEL[startPosition]

  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 1, overflow: "hidden" }}>
      <text flexShrink={0} fg={theme.fgDim}>
        Topic:
      </text>
      <text flexGrow={1} truncate wrapMode="none" fg={topic ? theme.info : theme.fgDim}>
        {topic || "(none — press t to configure)"}
      </text>
      <text flexShrink={0} fg={theme.warning} truncate wrapMode="none">
        {`[${positionLabel}]`}
      </text>
      <text flexShrink={0} fg={theme.fgDim}>
        t configure
      </text>
    </box>
  )
}
