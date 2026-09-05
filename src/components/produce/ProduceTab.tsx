import { useKeyboard } from "@opentui/react"
import { useEffect, useState } from "react"
import { theme } from "../../theme/monokai"

/**
 * Static form UI (spec §5 tab 4) — the shape a future producing pass would wire up, not a real
 * producer. Send always stays disabled; "locking in the UI shape" is read here to include the
 * interaction shape too, not just the visual layout, so fields are genuinely focusable/editable.
 */

type FieldId = "topic" | "key" | "value" | "partitionStrategy" | "send"
const FIELDS: FieldId[] = ["topic", "key", "value", "partitionStrategy", "send"]
const TEXT_FIELDS: ReadonlySet<FieldId> = new Set(["topic", "key", "value"])

const PARTITION_STRATEGIES = [
  "Auto (default partitioner)",
  "Manual: partition 0",
  "Manual: partition 1",
  "Manual: partition 2",
  "Manual: partition 3",
] as const

const DISABLED_MESSAGE = "Producing is not yet implemented — this tool is read-only in v1."

interface ProduceTabProps {
  onInputActiveChange: (active: boolean) => void
}

export function ProduceTab({ onInputActiveChange }: ProduceTabProps) {
  const [focusedField, setFocusedField] = useState<FieldId>("topic")
  const [editingField, setEditingField] = useState<FieldId | null>(null)

  const [topic, setTopic] = useState("")
  const [topicDraft, setTopicDraft] = useState("")
  const [key, setKey] = useState("")
  const [keyDraft, setKeyDraft] = useState("")
  const [value, setValue] = useState("")
  const [valueDraft, setValueDraft] = useState("")
  const [strategyIndex, setStrategyIndex] = useState(0)
  const [sendStatus, setSendStatus] = useState<string | null>(null)

  useEffect(() => {
    onInputActiveChange(editingField !== null)
  }, [editingField, onInputActiveChange])

  // `InputRenderableOptions`'s `onSubmit` intersects Textarea's `(event: SubmitEvent) => void`
  // with InputProps's own `(value: string) => void` — no real function literal satisfies that
  // intersection. OpenTUI only ever calls it with a string (see TopicBar.tsx for the full note).
  const asSubmitHandler = (fn: (value: string) => void): any => fn

  useKeyboard((evt) => {
    if (editingField) {
      if (evt.name === "escape") setEditingField(null)
      return
    }

    switch (evt.name) {
      case "up": {
        const idx = FIELDS.indexOf(focusedField)
        setFocusedField(FIELDS[Math.max(0, idx - 1)] ?? focusedField)
        setSendStatus(null)
        break
      }
      case "down": {
        const idx = FIELDS.indexOf(focusedField)
        setFocusedField(FIELDS[Math.min(FIELDS.length - 1, idx + 1)] ?? focusedField)
        setSendStatus(null)
        break
      }
      case "return":
        if (focusedField === "topic") {
          setTopicDraft(topic)
          setEditingField("topic")
        } else if (focusedField === "key") {
          setKeyDraft(key)
          setEditingField("key")
        } else if (focusedField === "value") {
          setValueDraft(value)
          setEditingField("value")
        } else if (focusedField === "partitionStrategy") {
          setStrategyIndex((i) => (i + 1) % PARTITION_STRATEGIES.length)
        } else if (focusedField === "send") {
          setSendStatus(DISABLED_MESSAGE)
        }
        break
    }
  })

  const fieldRow = (id: FieldId, label: string, committed: string, draft: string, onDraftChange: (v: string) => void, onCommit: (v: string) => void, placeholder: string) => {
    const focused = focusedField === id && !editingField
    const editing = editingField === id
    return (
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 1, paddingLeft: 1, overflow: "hidden" }}>
        <text flexShrink={0} fg={theme.fgDim}>{`${label}:`}</text>
        {editing ? (
          <input
            value={draft}
            onInput={onDraftChange}
            onSubmit={asSubmitHandler(onCommit)}
            focused
            placeholder={placeholder}
            style={{ flexGrow: 1 }}
          />
        ) : (
          <text flexGrow={1} truncate wrapMode="none" bg={focused ? theme.bgSelected : undefined} fg={committed ? theme.fg : theme.fgDim}>
            {committed || `(empty — ⏎ to edit)`}
          </text>
        )}
      </box>
    )
  }

  const strategyFocused = focusedField === "partitionStrategy"
  const sendFocused = focusedField === "send"

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, padding: 1, gap: 0, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", flexShrink: 0, gap: 2, paddingBottom: 1 }}>
        <text flexShrink={0} fg={theme.accent}>Produce</text>
        <text flexShrink={0} fg={theme.warning}>(disabled — read-only in v1)</text>
      </box>

      {fieldRow("topic", "Topic", topic, topicDraft, setTopicDraft, (v) => {
        setTopic(v)
        setEditingField(null)
      }, "e.g. orders.json")}
      {fieldRow("key", "Key", key, keyDraft, setKeyDraft, (v) => {
        setKey(v)
        setEditingField(null)
      }, "e.g. order-123")}
      {fieldRow("value", "Value", value, valueDraft, setValueDraft, (v) => {
        setValue(v)
        setEditingField(null)
      }, '{"example": "value"} or plain text')}

      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 1, paddingLeft: 1 }}>
        <text flexShrink={0} fg={theme.fgDim}>Partition:</text>
        <text flexGrow={1} truncate wrapMode="none" bg={strategyFocused ? theme.bgSelected : undefined} fg={theme.fg}>
          {PARTITION_STRATEGIES[strategyIndex]}
        </text>
      </box>

      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1, marginTop: 1 }}>
        <text flexShrink={0} bg={sendFocused ? theme.bgSelected : undefined} fg={theme.fgDim}>
          [ Send ]
        </text>
        {sendStatus && (
          <text flexShrink={0} truncate wrapMode="none" fg={theme.warning}>
            {sendStatus}
          </text>
        )}
      </box>

      <box style={{ flexDirection: "column", marginTop: 1, flexShrink: 0 }}>
        <text flexShrink={0} fg={theme.fgDim}>
          This locks in the Produce screen's shape for a future pass to wire up real producer
          logic — topic/key/value/partition selection all work as a form, Send stays inert.
        </text>
      </box>
    </box>
  )
}
