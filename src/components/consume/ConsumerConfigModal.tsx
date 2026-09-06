import { useKeyboard } from "@opentui/react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import type { StartPositionKind } from "../../kafka/ConsumeConfigContext"
import { parseTimestampInput } from "../../kafka/parseTimestampInput"
import { useTopicsData } from "../../kafka/TopicsDataContext"
import { theme } from "../../theme/monokai"
import { useListViewport } from "../useListViewport"

const START_POSITIONS: StartPositionKind[] = ["earliest", "latest", "timestamp"]
const START_POSITION_LABELS: Record<StartPositionKind, string> = {
  earliest: "Earliest",
  latest: "Latest",
  timestamp: "Timestamp",
}

type FieldId = "topic" | "startPosition" | "timestamp" | "connect" | "cancel"

export interface ConsumerConfigModalSubmitValue {
  topic: string
  startPosition: StartPositionKind
  timestampInput: string
}

interface ConsumerConfigModalProps {
  initialTopic: string
  initialStartPosition: StartPositionKind
  initialTimestampInput: string
  onCancel: () => void
  onSubmit: (value: ConsumerConfigModalSubmitValue) => void
}

/**
 * Overlay, not a full-screen replace like `MessageDetail`/`GroupDetail`/`TopicDetail` — the
 * request specifically asked for a modal/popup. Owns its own mount-scoped `useKeyboard`
 * (same scope-guard pattern those three use), and — unlike them — `ConsumeTab` treats this as
 * trapping *all* input for its entire open duration (`onInputActiveChange(true)` the whole
 * time), not just while a sub-field is text-editing, matching how a modal conventionally works.
 */
export function ConsumerConfigModal({
  initialTopic,
  initialStartPosition,
  initialTimestampInput,
  onCancel,
  onSubmit,
}: ConsumerConfigModalProps) {
  const { overviews, ensureFetched } = useTopicsData()

  useEffect(() => {
    ensureFetched()
  }, [ensureFetched])

  const [focusedField, setFocusedField] = useState<FieldId>("topic")

  const [topic, setTopic] = useState(initialTopic)
  const [editingTopic, setEditingTopic] = useState(false)
  const [topicTyping, setTopicTyping] = useState(initialTopic)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const [startPosition, setStartPosition] = useState<StartPositionKind>(initialStartPosition)

  const [timestampInput, setTimestampInput] = useState(initialTimestampInput)
  const [editingTimestamp, setEditingTimestamp] = useState(false)
  const [timestampTyping, setTimestampTyping] = useState(initialTimestampInput)

  const [validationError, setValidationError] = useState<string | null>(null)

  const fields: FieldId[] = useMemo(
    () =>
      startPosition === "timestamp"
        ? ["topic", "startPosition", "timestamp", "connect", "cancel"]
        : ["topic", "startPosition", "connect", "cancel"],
    [startPosition],
  )

  // If the timestamp field drops out of the focus order (start position changed away from
  // "timestamp" while it was focused), land on the next logical field rather than a stale one.
  useEffect(() => {
    if (!fields.includes(focusedField)) setFocusedField("connect")
  }, [fields, focusedField])

  const suggestions = useMemo(() => {
    const q = topicTyping.trim().toLowerCase()
    const names = overviews.map((t) => t.name).sort((a, b) => a.localeCompare(b))
    return q ? names.filter((name) => name.toLowerCase().includes(q)) : names
  }, [overviews, topicTyping])

  const { boxRef: suggestionsBoxRef, rowCount: suggestionRowCount, viewportStart, scrollToIndex } = useListViewport(
    suggestions.length,
    editingTopic,
  )

  // `InputRenderableOptions`'s `onSubmit` intersects Textarea's `(event: SubmitEvent) => void`
  // with InputProps's own `(value: string) => void` — no real function literal satisfies that
  // intersection. OpenTUI only ever calls it with a string (see TopicBar.tsx for the full note).
  const asSubmitHandler = (fn: (value: string) => void): any => fn

  const commitTopicEdit = (typedValue: string) => {
    const chosen = highlightedIndex >= 0 ? suggestions[highlightedIndex] : undefined
    const next = (chosen ?? typedValue).trim()
    setTopic(next)
    setEditingTopic(false)
    setValidationError(null)
  }

  const commitTimestampEdit = (typedValue: string) => {
    setTimestampInput(typedValue)
    setEditingTimestamp(false)
    setValidationError(null)
  }

  const handleConnect = () => {
    const trimmedTopic = topic.trim()
    if (!trimmedTopic) {
      setValidationError("Pick a topic first.")
      return
    }
    if (startPosition === "timestamp" && parseTimestampInput(timestampInput) === null) {
      setValidationError("That timestamp doesn't parse — see the format hint above.")
      return
    }
    onSubmit({ topic: trimmedTopic, startPosition, timestampInput })
  }

  useKeyboard((key) => {
    // Enter is deliberately NOT handled here for either text field — OpenTUI's `<input>`
    // consumes it internally and calls `onSubmit` instead of forwarding a "return" key event
    // to this global handler (same reason TopicBar/SearchBox commit via `onSubmit`, not a
    // keyboard case). Escape and the arrow keys do still reach here while an input is focused.
    if (editingTopic) {
      switch (key.name) {
        case "escape":
          setTopicTyping(topic)
          setEditingTopic(false)
          break
        case "up":
          setHighlightedIndex((i) => Math.max(0, i - 1))
          scrollToIndex(Math.max(0, highlightedIndex - 1))
          break
        case "down":
          setHighlightedIndex((i) => {
            const next = Math.min(suggestions.length - 1, i + 1)
            scrollToIndex(next)
            return next
          })
          break
      }
      return
    }

    if (editingTimestamp) {
      if (key.name === "escape") {
        setTimestampTyping(timestampInput)
        setEditingTimestamp(false)
      }
      return
    }

    switch (key.name) {
      case "up": {
        const idx = fields.indexOf(focusedField)
        setFocusedField(fields[Math.max(0, idx - 1)] ?? focusedField)
        break
      }
      case "down": {
        const idx = fields.indexOf(focusedField)
        setFocusedField(fields[Math.min(fields.length - 1, idx + 1)] ?? focusedField)
        break
      }
      case "return":
        if (focusedField === "topic") {
          setTopicTyping(topic)
          const idx = suggestions.findIndex((name) => name === topic)
          setHighlightedIndex(idx >= 0 ? idx : 0)
          scrollToIndex(idx >= 0 ? idx : 0)
          setEditingTopic(true)
        } else if (focusedField === "startPosition") {
          const idx = START_POSITIONS.indexOf(startPosition)
          setStartPosition(START_POSITIONS[(idx + 1) % START_POSITIONS.length]!)
          setValidationError(null)
        } else if (focusedField === "timestamp") {
          setTimestampTyping(timestampInput)
          setEditingTimestamp(true)
        } else if (focusedField === "connect") {
          handleConnect()
        } else if (focusedField === "cancel") {
          onCancel()
        }
        break
      case "escape":
        onCancel()
        break
    }
  })

  const visibleSuggestions = suggestions.slice(viewportStart, viewportStart + suggestionRowCount)

  const row = (id: FieldId, label: string, content: ReactNode) => (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 1 }}>
      <text flexShrink={0} fg={theme.fgDim}>{`${label}:`}</text>
      {content}
      {focusedField === id && !editingTopic && !editingTimestamp && (
        <text flexShrink={0} fg={theme.accent}>
          {"◀"}
        </text>
      )}
    </box>
  )

  return (
    <box
      style={{
        position: "absolute",
        top: "12%",
        left: "10%",
        right: "10%",
        bottom: "12%",
        zIndex: 10,
        flexDirection: "column",
        padding: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: theme.accent,
        backgroundColor: theme.bgPanel,
        overflow: "hidden",
      }}
    >
      <text fg={theme.accent}>Configure consumer</text>
      <text fg={theme.fgDim}> </text>

      {row(
        "topic",
        "Topic",
        editingTopic ? (
          <input
            value={topicTyping}
            onInput={(v: string) => {
              setTopicTyping(v)
              setHighlightedIndex(0)
              scrollToIndex(0)
            }}
            onSubmit={asSubmitHandler(commitTopicEdit)}
            focused
            placeholder="topic name substring"
            style={{ flexGrow: 1 }}
          />
        ) : (
          <text flexGrow={1} truncate wrapMode="none" bg={focusedField === "topic" ? theme.bgSelected : undefined} fg={topic ? theme.fg : theme.fgDim}>
            {topic || "(none — ⏎ to pick)"}
          </text>
        ),
      )}

      {editingTopic && (
        <box ref={suggestionsBoxRef} style={{ flexDirection: "column", flexGrow: 1, maxHeight: 10, overflow: "hidden", paddingLeft: 8 }}>
          {suggestions.length === 0 ? (
            <text fg={theme.fgDim}>(no matching topics — ⏎ to use the typed text as-is)</text>
          ) : (
            visibleSuggestions.map((name, i) => {
              const idx = viewportStart + i
              return (
                <text key={name} truncate wrapMode="none" bg={idx === highlightedIndex ? theme.bgSelected : undefined} fg={theme.fg}>
                  {name}
                </text>
              )
            })
          )}
        </box>
      )}

      {!editingTopic && (
        <>
          {row(
            "startPosition",
            "Start",
            <text flexGrow={1} fg={theme.fg}>
              {START_POSITIONS.map((pos) => (
                <span key={pos} fg={pos === startPosition ? theme.fgInverted : theme.fgDim} bg={pos === startPosition ? theme.accent : undefined}>
                  {`  ${pos === startPosition ? "●" : "○"} ${START_POSITION_LABELS[pos]}  `}
                </span>
              ))}
            </text>,
          )}

          {startPosition === "timestamp" &&
            row(
              "timestamp",
              "At",
              editingTimestamp ? (
                <input
                  value={timestampTyping}
                  onInput={setTimestampTyping}
                  onSubmit={asSubmitHandler(commitTimestampEdit)}
                  focused
                  placeholder="2026-09-06T12:00:00Z"
                  style={{ flexGrow: 1 }}
                />
              ) : (
                <text flexGrow={1} truncate wrapMode="none" bg={focusedField === "timestamp" ? theme.bgSelected : undefined} fg={timestampInput ? theme.fg : theme.fgDim}>
                  {timestampInput || "(none — ⏎ to enter)"}
                </text>
              ),
            )}
          {startPosition === "timestamp" && (
            <text fg={theme.fgDim}>{"  UTC — e.g. 2026-09-06T12:00:00Z, or epoch milliseconds"}</text>
          )}

          <text fg={theme.fgDim}> </text>
          <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 3 }}>
            <text fg={theme.fg} bg={focusedField === "connect" ? theme.bgSelected : undefined}>
              {"[ Connect ]"}
            </text>
            <text fg={theme.fg} bg={focusedField === "cancel" ? theme.bgSelected : undefined}>
              {"[ Cancel ]"}
            </text>
          </box>

          {validationError && (
            <text fg={theme.error} truncate wrapMode="none">
              {validationError}
            </text>
          )}
        </>
      )}

      <text fg={theme.fgDim}> </text>
      <text fg={theme.fgDim}>↑↓ field · ⏎ edit/cycle/select · esc {editingTopic || editingTimestamp ? "cancel edit" : "close"}</text>
    </box>
  )
}
