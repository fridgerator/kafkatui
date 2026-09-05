import type { DecodedMessage } from "./decode/decodeMessage"

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
