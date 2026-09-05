import { decodeMessage, type DecodedMessage } from "./decode/decodeMessage"

export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed"

/**
 * A message as it comes off the wire, before decoding. No `seq` field —
 * `RingBuffer.push()` assigns that on insert, so this type stays decoupled
 * from any particular buffer instance.
 */
export interface RawMessage {
  topic: string
  partition: number
  offset: string
  key: Buffer | null
  value: Buffer | null
  headers: Record<string, Buffer | string | (Buffer | string)[] | undefined>
  timestamp: string
  receivedAt: number
}

/**
 * A `RawMessage` as retained in the ring buffer, with a lazily-computed,
 * memoized decode result attached directly to the object (`decoded ??=
 * decodeMessage(...)`). It's garbage-collected the moment the ring buffer
 * overwrites that slot — no separate cache or eviction bookkeeping needed.
 */
export interface BufferedMessage extends RawMessage {
  decoded?: DecodedMessage
}

/**
 * The single memoization point for decode — shared by row rendering
 * (`MessageList`) and the phase-5 filter scan, so whichever one visits an
 * entry first computes it once and both see the same cached result.
 */
export function getOrDecode(entry: BufferedMessage): DecodedMessage {
  return (entry.decoded ??= decodeMessage(entry.value))
}

/**
 * Full, untruncated text to search against — never `decoded.preview`, which
 * is capped at 200 chars for the list-row display and would silently miss a
 * match past that point. JSON has no gap (`decoded.value` is already the
 * full parsed object); text messages are re-derived from the raw bytes still
 * on the entry rather than caching a second, larger string per message.
 */
export function getSearchableText(entry: BufferedMessage): string {
  const decoded = getOrDecode(entry)
  if (decoded.kind === "json" && decoded.value !== undefined) {
    return JSON.stringify(decoded.value)
  }
  if (decoded.kind === "text") {
    return entry.value?.toString("utf8") ?? decoded.preview
  }
  return decoded.preview
}
