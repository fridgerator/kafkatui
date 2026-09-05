import { theme } from "../../theme/monokai"

/** Placeholder for the Topics / cluster metadata tab (spec §5 tab 3, §8). Wired up in phase 8. */
export function TopicsTab() {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, padding: 1, gap: 1, overflow: "hidden" }}>
      <text flexShrink={0} fg={theme.accent}>Topics</text>
      <text flexShrink={0} fg={theme.fgDim}>Read-only cluster and topic inspection.</text>
      <box style={{ flexDirection: "column", marginTop: 1, flexShrink: 0 }}>
        <text flexShrink={0} fg={theme.fgDim}>Lands in phase 8:</text>
        <text flexShrink={0} fg={theme.fgDim}> · partition count, replication factor, leader/ISR state</text>
        <text flexShrink={0} fg={theme.fgDim}> · earliest/latest offset per partition</text>
        <text flexShrink={0} fg={theme.fgDim}> · topic config via describeConfigs (retention, cleanup policy)</text>
        <text flexShrink={0} fg={theme.fgDim}> · per-partition throughput and key skew</text>
      </box>
    </box>
  )
}
