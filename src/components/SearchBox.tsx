import { theme } from "../theme/monokai"

interface SearchBoxProps {
  editing: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSubmit: (value: string) => void
  committedQuery: string
}

/**
 * One input, two modes auto-detected by prefix (spec §6.4): plain text is a
 * case-insensitive substring search; text starting with `@filter:` is the
 * structured nested-path query language. This component only owns the input
 * widget itself — mode detection, compiling the query into a matcher, and
 * live-vs-committed state all live in the caller (`ConsumeTab`), the same
 * split `TopicBar` uses for the topic field.
 *
 * Placed at the top level of `components/` (not nested under `consume/`)
 * because spec §10's own project structure names it there, as a
 * potentially-shared widget rather than something Consume-tab-specific.
 */
export function SearchBox({ editing, draft, onDraftChange, onSubmit, committedQuery }: SearchBoxProps) {
  // See TopicBar.tsx for why this cast is necessary and safe: InputRenderableOptions
  // inherits Textarea's `(event: SubmitEvent) => void` onSubmit alongside InputProps's
  // own `(value: string) => void`, and no real function literal satisfies the
  // resulting intersection type. OpenTUI only ever calls it with a string.
  const handleSubmit: any = onSubmit

  return (
    <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 1, overflow: "hidden" }}>
      <text flexShrink={0} fg={theme.fgDim}>
        Search:
      </text>
      {editing ? (
        <input
          value={draft}
          onInput={onDraftChange}
          onSubmit={handleSubmit}
          focused
          placeholder='text, or @filter: path op value'
          style={{ flexGrow: 1 }}
        />
      ) : (
        <text flexGrow={1} truncate wrapMode="none" fg={committedQuery ? theme.info : theme.fgDim}>
          {committedQuery || "(none — press / to search)"}
        </text>
      )}
      <text flexShrink={0} fg={theme.fgDim}>
        {editing ? "⏎ apply · esc cancel" : "/ edit"}
      </text>
    </box>
  )
}
