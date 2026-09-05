import { theme } from "../../theme/monokai"

/** Placeholder for the Consumer Groups tab (spec §5 tab 2). Wired up in phase 7. */
export function GroupsTab() {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, padding: 1, gap: 1, overflow: "hidden" }}>
      <text flexShrink={0} fg={theme.accent}>Consumer Groups</text>
      <text flexShrink={0} fg={theme.fgDim}>Members, partition assignment, and lag trend per group.</text>
      <box style={{ flexDirection: "column", marginTop: 1, flexShrink: 0 }}>
        <text flexShrink={0} fg={theme.fgDim}>Lands in phase 7:</text>
        <text flexShrink={0} fg={theme.fgDim}> · listGroups / describeGroups</text>
        <text flexShrink={0} fg={theme.fgDim}> · per-partition current offset, high-water mark, lag</text>
        <text flexShrink={0} fg={theme.fgDim}> · lag sparklines on a 5-10s poll</text>
        <text flexShrink={0} fg={theme.fgDim}> · stuck/idle consumer detection</text>
      </box>
    </box>
  )
}
