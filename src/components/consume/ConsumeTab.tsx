import { theme } from "../../theme/monokai"

/** Placeholder for the Consume tab (spec §6). Wired up in phase 3. */
export function ConsumeTab() {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1, padding: 1, gap: 1, overflow: "hidden" }}>
      <text flexShrink={0} fg={theme.accent}>Consume</text>
      <text flexShrink={0} fg={theme.fgDim}>
        Ephemeral tail of a topic — no consumer group, no offset commits.
      </text>
      <box style={{ flexDirection: "column", marginTop: 1, flexShrink: 0 }}>
        <text flexShrink={0} fg={theme.fgDim}>Lands in phase 3:</text>
        <text flexShrink={0} fg={theme.fgDim}> · ring buffer (5,000 messages, configurable)</text>
        <text flexShrink={0} fg={theme.fgDim}> · windowed message list with lazy decode</text>
        <text flexShrink={0} fg={theme.fgDim}> · throttled ingestion, pause/resume on space</text>
        <text flexShrink={0} fg={theme.fgDim}> · JSON / text decode (Avro in phase 4)</text>
      </box>
    </box>
  )
}
