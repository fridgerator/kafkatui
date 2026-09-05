import type { RingBufferSlot } from "../../buffer/ringBuffer"
import { decodeMessage } from "../../kafka/decode/decodeMessage"
import type { BufferedMessage } from "../../kafka/types"
import { theme } from "../../theme/monokai"

const KIND_COLOR = {
  json: theme.info,
  text: theme.fg,
  binary: theme.warning,
  empty: theme.fgDim,
} as const

function formatTime(timestamp: string): string {
  const date = new Date(Number(timestamp))
  return date.toISOString().slice(11, 23) // HH:MM:SS.mmm
}

interface MessageRowProps {
  slot: RingBufferSlot<BufferedMessage>
  selected: boolean
}

function MessageRow({ slot, selected }: MessageRowProps) {
  // Memoized directly on the buffered entry (spec-§6.3-risk resolution — see
  // kafka/types.ts) so scrolling back over already-seen rows never re-decodes.
  const decoded = (slot.value.decoded ??= decodeMessage(slot.value.value))
  const line = `${formatTime(slot.value.timestamp)}  p${slot.value.partition}  o${slot.value.offset}  ${decoded.preview}`

  return (
    <text
      truncate
      wrapMode="none"
      fg={KIND_COLOR[decoded.kind]}
      bg={selected ? theme.bgSelected : undefined}
      style={{ height: 1, flexShrink: 0 }}
    >
      {line}
    </text>
  )
}

interface MessageListProps {
  rows: RingBufferSlot<BufferedMessage>[]
  rowCount: number
  selectedSeq: number | null
  emptyMessage: string
}

/** Pure presentational: renders exactly `rowCount` rows, no scrolling logic of its own. */
export function MessageList({ rows, rowCount, selectedSeq, emptyMessage }: MessageListProps) {
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
        <MessageRow key={slot.seq} slot={slot} selected={slot.seq === selectedSeq} />
      ))}
      {Array.from({ length: padding }, (_, i) => (
        <text key={`pad-${i}`} style={{ height: 1, flexShrink: 0 }}>
          {""}
        </text>
      ))}
    </box>
  )
}
