import { theme } from "../../theme/monokai"

/**
 * Placeholder for the Produce tab (spec §5 tab 4).
 *
 * Producing is an explicit non-goal for v1 (§1). The real form shell — topic
 * selector, key/value inputs, partition strategy, disabled Send — is built in
 * phase 10; this phase only reserves the tab.
 */
export function ProduceTab() {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, padding: 1, gap: 1, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text flexShrink={0} fg={theme.accent}>Produce</text>
        <text flexShrink={0} fg={theme.warning}>{"  (coming soon)"}</text>
      </box>
      <text flexShrink={0} fg={theme.fgDim}>Producing is not yet implemented — this tool is read-only in v1.</text>
      <box style={{ flexDirection: "column", marginTop: 1, flexShrink: 0 }}>
        <text flexShrink={0} fg={theme.fgDim}>Lands in phase 10, as a disabled UI shell:</text>
        <text flexShrink={0} fg={theme.fgDim}> · topic selector, key input, value input</text>
        <text flexShrink={0} fg={theme.fgDim}> · partition / key-strategy selector</text>
        <text flexShrink={0} fg={theme.fgDim}> · Send button, present but disabled</text>
      </box>
    </box>
  )
}
