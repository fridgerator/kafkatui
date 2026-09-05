import { theme } from "../../theme/monokai"

interface TopicBarProps {
  mode: "browse" | "editingTopic"
  topicDraft: string
  onTopicDraftChange: (value: string) => void
  onSubmit: (value: string) => void
  activeTopic: string | null
  fromBeginning: boolean
}

/**
 * The Consume tab's only text input (spec §6.1 has no topic browser until
 * phase 8, so this is how a topic gets picked). `t` enters edit mode,
 * `Enter` connects, `Escape` cancels — all driven by ConsumeTab's own
 * `useKeyboard`, not OpenTUI's focus/blur events (see plan decision 1).
 */
export function TopicBar({ mode, topicDraft, onTopicDraftChange, onSubmit, activeTopic, fromBeginning }: TopicBarProps) {
  const editing = mode === "editingTopic"

  // `InputRenderableOptions` extends `Omit<TextareaOptions, "height" | ...>`, which
  // does not strip `onSubmit` — so it inherits Textarea's own `(event: SubmitEvent)
  // => void` (@opentui/core's own SubmitEvent class) alongside InputProps's explicit
  // `(value: string) => void`, and TypeScript intersects the two. No real function
  // literal satisfies that intersection; at runtime OpenTUI only ever calls an
  // <input>'s onSubmit with a string (confirmed in @opentui/react's own
  // src/types/components.d.ts), so the cast below is safe and scoped to this line.
  const handleSubmit: any = onSubmit

  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 1, overflow: "hidden" }}>
      <text flexShrink={0} fg={theme.fgDim}>
        Topic:
      </text>
      {editing ? (
        <input
          value={topicDraft}
          onInput={onTopicDraftChange}
          onSubmit={handleSubmit}
          focused
          placeholder="e.g. orders.json"
          style={{ flexGrow: 1 }}
        />
      ) : (
        <text flexGrow={1} truncate wrapMode="none" fg={activeTopic ? theme.info : theme.fgDim}>
          {activeTopic ?? "(none — press t to pick a topic)"}
        </text>
      )}
      <text flexShrink={0} fg={theme.warning}>
        {`[${fromBeginning ? "earliest" : "latest"}]`}
      </text>
      <text flexShrink={0} fg={theme.fgDim}>
        {editing ? "⏎ connect · esc cancel" : "t edit · e toggle"}
      </text>
    </box>
  )
}
