import type { RingBufferSlot } from "../../buffer/ringBuffer"
import { getOrDecode } from "../../kafka/types"
import type { BufferedMessage } from "../../kafka/types"
import { theme } from "../../theme/monokai"

const KIND_COLOR = {
  json: theme.info,
  text: theme.fg,
  binary: theme.warning,
  empty: theme.fgDim,
  pending: theme.fgDim,
} as const

function formatTime(timestamp: string): string {
  const date = new Date(Number(timestamp))
  return date.toISOString().slice(11, 23) // HH:MM:SS.mmm
}

interface MessageRowProps {
  slot: RingBufferSlot<BufferedMessage>
  selected: boolean
  /** Case-insensitive substring to highlight (raw search mode only — see plan decision 7). */
  highlightQuery?: string
  /** True if this row matched an active `@filter:` query — gets a background tint, not a span highlight. */
  filterMatched?: boolean
}

function MessageRow({ slot, selected, highlightQuery, filterMatched }: MessageRowProps) {
  // Shared with the filter scan (kafka/types.ts) so whichever visits an entry first
  // computes the decode once and both see the same cached result.
  const decoded = getOrDecode(slot.value)
  const prefix = `${formatTime(slot.value.timestamp)}  p${slot.value.partition}  o${slot.value.offset}  `
  const line = prefix + decoded.preview
  const rowBg = selected ? theme.bgSelected : filterMatched ? theme.bgPanel : undefined

  // Highlighting looks for the match inside `decoded.preview` specifically (what's
  // actually rendered), not the full untruncated searchable text used for matching
  // itself — a match that exists only past the 200-char preview cutoff still counts
  // as a match (the row is shown), it just has nothing visible to highlight.
  if (highlightQuery) {
    const matchIndex = decoded.preview.toLowerCase().indexOf(highlightQuery.toLowerCase())
    if (matchIndex >= 0) {
      const start = prefix.length + matchIndex
      const end = start + highlightQuery.length
      return (
        <text truncate wrapMode="none" bg={rowBg} style={{ height: 1, flexShrink: 0 }}>
          <span fg={KIND_COLOR[decoded.kind]}>{line.slice(0, start)}</span>
          <span fg={theme.fgInverted} bg={theme.warning}>
            {line.slice(start, end)}
          </span>
          <span fg={KIND_COLOR[decoded.kind]}>{line.slice(end)}</span>
        </text>
      )
    }
  }

  return (
    <text truncate wrapMode="none" fg={KIND_COLOR[decoded.kind]} bg={rowBg} style={{ height: 1, flexShrink: 0 }}>
      {line}
    </text>
  )
}

interface MessageListProps {
  rows: RingBufferSlot<BufferedMessage>[]
  rowCount: number
  selectedSeq: number | null
  emptyMessage: string
  /** Set only in raw substring search mode — drives per-row highlighting. */
  highlightQuery?: string
  /** Set only in `@filter:` mode — every row in `rows` already matched, so this just enables the tint. */
  filterActive?: boolean
}

/** Pure presentational: renders exactly `rowCount` rows, no scrolling logic of its own. */
export function MessageList({
  rows,
  rowCount,
  selectedSeq,
  emptyMessage,
  highlightQuery,
  filterActive,
}: MessageListProps) {
  if (rows.length === 0) {
    return (
      <box style={{ flexGrow: 1, flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
        <text fg={theme.fgDim}>{emptyMessage}</text>
      </box>
    )
  }

  const padding = Math.max(0, rowCount - rows.length)

  return (
    <box style={{ flexDirection: "column" }}>
      {rows.map((slot) => (
        <MessageRow
          key={slot.seq}
          slot={slot}
          selected={slot.seq === selectedSeq}
          highlightQuery={highlightQuery}
          filterMatched={filterActive}
        />
      ))}
      {Array.from({ length: padding }, (_, i) => (
        <text key={`pad-${i}`} style={{ height: 1, flexShrink: 0 }}>
          {""}
        </text>
      ))}
    </box>
  )
}
