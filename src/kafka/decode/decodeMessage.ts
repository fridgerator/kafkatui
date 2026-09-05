import { toHexPreview } from "./hexDump"

export type DecodedKind = "json" | "text" | "binary" | "empty" | "pending"

export interface DecodedMessage {
  kind: DecodedKind
  /** Single-line, already-truncated string for the message list row. */
  preview: string
  value?: unknown
}

const CONFLUENT_MAGIC_BYTE = 0x0
const UTF8_REPLACEMENT_CHAR_CODE = 0xfffd

/** Exported so `ConsumeTab` can trigger the async Avro path (`kafka/decode/avro.ts`) on the same test. */
export function looksLikeConfluentAvro(buffer: Buffer): boolean {
  // Magic byte + 4-byte schema ID (spec §6.2).
  return buffer.length >= 5 && buffer[0] === CONFLUENT_MAGIC_BYTE
}

/** The 4-byte big-endian schema ID following the magic byte, for the detail view's schema info (spec §6.5). */
export function extractConfluentSchemaId(buffer: Buffer): number | null {
  if (!looksLikeConfluentAvro(buffer)) return null
  return buffer.readUInt32BE(1)
}

/** True if decoding as UTF-8 introduced few/no replacement chars or stray control bytes. */
function isPrintableText(text: string): boolean {
  if (text.length === 0) return true
  let badChars = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const isAllowedControl = code === 9 || code === 10 || code === 13 // tab, \n, \r
    const isOtherControl = code < 32 && !isAllowedControl
    if (isOtherControl || code === UTF8_REPLACEMENT_CHAR_CODE) badChars++
  }
  return badChars / text.length < 0.05
}

/** Exported so `kafka/decode/avro.ts` produces previews consistent with the JSON path. */
export function truncate(text: string, maxLength = 200): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
}

/**
 * Dispatch per spec §6.2: magic-byte sniff → JSON → printable text → hex
 * fallback. Every branch is caught — a decode failure must never throw into
 * the render loop.
 *
 * This function stays synchronous and never handles Avro itself — a schema
 * fetch is a network call, which can't happen inline during a render. The
 * real Avro decode (`kafka/decode/avro.ts`) runs eagerly at ingestion time in
 * `ConsumeTab`'s flush loop instead, and overwrites `BufferedMessage.decoded`
 * once it resolves. By the time this function runs against an Avro message,
 * that either already happened (this branch is never reached — `decoded` is
 * already set), or no schema registry is configured, in which case falling
 * through to the binary/hex preview below is the correct, intentional
 * fallback, not a bug.
 */
export function decodeMessage(buffer: Buffer | null): DecodedMessage {
  if (buffer === null || buffer.length === 0) {
    return { kind: "empty", preview: "<empty>" }
  }

  try {
    const text = buffer.toString("utf8")

    try {
      const parsed = JSON.parse(text)
      return { kind: "json", preview: truncate(JSON.stringify(parsed)), value: parsed }
    } catch {
      // Not JSON — fall through to the text/binary checks below.
    }

    if (isPrintableText(text)) {
      return { kind: "text", preview: truncate(text) }
    }

    return { kind: "binary", preview: toHexPreview(buffer) }
  } catch (err) {
    return { kind: "binary", preview: `⚠ decode error: ${(err as Error).message}` }
  }
}
