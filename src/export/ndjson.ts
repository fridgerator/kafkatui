import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { getOrDecode, type BufferedMessage } from "../kafka/types"

export interface NdjsonRecord {
  topic: string
  partition: number
  offset: string
  timestamp: string
  key: string | null
  headers: Record<string, string | string[]>
  value: unknown
  valueEncoding?: "base64"
}

function headerToString(value: Buffer | string | (Buffer | string)[] | undefined): string | string[] | null {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : v.toString("utf8")))
  return typeof value === "string" ? value : value.toString("utf8")
}

/**
 * Pure: one export record per buffered message, reusing the same decode boundary as the rest
 * of the app (`getOrDecode`). JSON/Avro keep their real parsed structure; text keeps its raw
 * string; anything else (binary, or an Avro message still `pending` decode) falls back to
 * base64 with an explicit `valueEncoding` flag rather than silently mangling bytes into a
 * lossy string.
 */
export function toNdjsonRecord(message: BufferedMessage): NdjsonRecord {
  const decoded = getOrDecode(message)
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(message.headers)) {
    const converted = headerToString(value)
    if (converted !== null) headers[name] = converted
  }

  const base = {
    topic: message.topic,
    partition: message.partition,
    offset: message.offset,
    timestamp: message.timestamp,
    key: message.key ? message.key.toString("utf8") : null,
    headers,
  }

  if (decoded.kind === "json" && decoded.value !== undefined) {
    return { ...base, value: decoded.value }
  }
  if (decoded.kind === "text") {
    return { ...base, value: message.value ? message.value.toString("utf8") : decoded.preview }
  }
  return {
    ...base,
    value: message.value ? message.value.toString("base64") : null,
    valueEncoding: "base64",
  }
}

/** Pure. One JSON object per line, trailing newline; empty input produces an empty string. */
export function toNdjson(messages: readonly BufferedMessage[]): string {
  if (messages.length === 0) return ""
  return `${messages.map((m) => JSON.stringify(toNdjsonRecord(m))).join("\n")}\n`
}

/**
 * Thin fs shell — mirrors `MessageDetail.tsx`'s `writeCopyFallbackFile` convention. Kafka topic
 * names are restricted to `[a-zA-Z0-9._-]` by the broker itself, so the filename needs no
 * sanitization. A random suffix (not just the timestamp) disambiguates back-to-back exports —
 * `Date.now()`/`toISOString()` resolution is coarser than JS's synchronous execution speed, so
 * two exports pressed in quick succession can otherwise get the exact same timestamp and silently
 * overwrite each other (confirmed empirically: two immediate `new Date().toISOString()` calls
 * produced identical strings).
 */
export function writeNdjsonExport(topic: string, messages: readonly BufferedMessage[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const suffix = randomBytes(3).toString("hex")
  const path = join(homedir(), ".kafka-tui", "exports", `${topic}-${stamp}-${suffix}.ndjson`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, toNdjson(messages), "utf8")
  return path
}
