import { toHexPreview } from "./hexDump"

export type DecodedKind = "json" | "text" | "binary" | "empty"

export interface DecodedMessage {
  kind: DecodedKind
  /** Single-line, already-truncated string for the message list row. */
  preview: string
  value?: unknown
}

const CONFLUENT_MAGIC_BYTE = 0x0
const UTF8_REPLACEMENT_CHAR_CODE = 0xfffd

function looksLikeConfluentAvro(buffer: Buffer): boolean {
  // Magic byte + 4-byte schema ID (spec §6.2).
  return buffer.length >= 5 && buffer[0] === CONFLUENT_MAGIC_BYTE
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

function truncate(text: string, maxLength = 200): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
}

/**
 * Dispatch per spec §6.2: magic-byte sniff → JSON → printable text → hex
 * fallback. Every branch is caught — a decode failure must never throw into
 * the render loop.
 *
 * The magic-byte branch is a stub: phase 4 adds the real Avro decode there.
 * Until then, Avro messages correctly fall through to the binary/hex
 * preview — that's the right behavior for a decoder that doesn't know Avro
 * yet, not a bug.
 */
export function decodeMessage(buffer: Buffer | null): DecodedMessage {
  if (buffer === null || buffer.length === 0) {
    return { kind: "empty", preview: "<empty>" }
  }

  try {
    if (looksLikeConfluentAvro(buffer)) {
      // TODO(phase 4): decode via @kafkajs/confluent-schema-registry using the
      // 4-byte schema ID that follows the magic byte, then return { kind: "json", ... }.
    }

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
