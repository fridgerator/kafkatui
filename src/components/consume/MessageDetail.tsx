import { useKeyboard, useRenderer } from "@opentui/react"
import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { useEffect, useMemo, useState } from "react"
import type { RingBufferSlot } from "../../buffer/ringBuffer"
import type { SchemaRegistryConfig } from "../../config/types"
import { fetchSchemaSubjectVersions } from "../../kafka/decode/avro"
import { decodeMessage, extractConfluentSchemaId } from "../../kafka/decode/decodeMessage"
import { toFullHexDump } from "../../kafka/decode/hexDump"
import { getOrDecode, type BufferedMessage } from "../../kafka/types"
import { theme } from "../../theme/monokai"

type ViewMode = "decoded" | "hex" | "base64"
const VIEW_CYCLE: ViewMode[] = ["decoded", "hex", "base64"]

interface MessageDetailProps {
  slot: RingBufferSlot<BufferedMessage>
  schemaRegistryConfig: SchemaRegistryConfig | undefined
  onClose: () => void
}

export interface JsonToken {
  text: string
  color?: string
}

/** JSON's grammar is simple and fully known ahead of time, so a small hand-rolled
 * tokenizer is simpler and dependency-free compared to OpenTUI's tree-sitter-backed
 * `<code>` component (which also requires a `syntaxStyle` prop) — see the phase 6 plan's
 * research notes. Reuses the syn* theme tokens defined since phase 1 for this exact purpose. */
function tokenizeJsonValue(value: unknown, indent: number, tokens: JsonToken[]): void {
  const pad = "  ".repeat(indent)
  const childPad = "  ".repeat(indent + 1)

  if (value === null) {
    tokens.push({ text: "null", color: theme.synNull })
  } else if (typeof value === "boolean") {
    tokens.push({ text: String(value), color: theme.synBoolean })
  } else if (typeof value === "number") {
    tokens.push({ text: String(value), color: theme.synNumber })
  } else if (typeof value === "string") {
    tokens.push({ text: JSON.stringify(value), color: theme.synString })
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      tokens.push({ text: "[]" })
      return
    }
    tokens.push({ text: "[\n" })
    value.forEach((item, i) => {
      tokens.push({ text: childPad })
      tokenizeJsonValue(item, indent + 1, tokens)
      tokens.push({ text: i < value.length - 1 ? ",\n" : "\n" })
    })
    tokens.push({ text: `${pad}]` })
  } else if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      tokens.push({ text: "{}" })
      return
    }
    tokens.push({ text: "{\n" })
    entries.forEach(([key, val], i) => {
      tokens.push({ text: childPad })
      tokens.push({ text: JSON.stringify(key), color: theme.synKey })
      tokens.push({ text: ": " })
      tokenizeJsonValue(val, indent + 1, tokens)
      tokens.push({ text: i < entries.length - 1 ? ",\n" : "\n" })
    })
    tokens.push({ text: `${pad}}` })
  } else {
    tokens.push({ text: String(value) })
  }
}

/** Wraps the mutate-an-array-in-place tokenizer for direct unit testing. */
export function tokenizeJson(value: unknown): JsonToken[] {
  const tokens: JsonToken[] = []
  tokenizeJsonValue(value, 0, tokens)
  return tokens
}

export function decodeHeaderValue(value: Buffer | string | (Buffer | string)[] | undefined): string {
  if (value === undefined) return "(none)"
  if (Array.isArray(value)) return value.map(decodeHeaderValue).join(", ")
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value
  return decodeMessage(buffer).preview
}

/** Exported for a direct unit test — exercising this via the full app would require
 * monkey-patching `renderer.isOsc52Supported()`, which reports `true` in the test harness. */
export function writeCopyFallbackFile(text: string): string {
  const path = join(homedir(), ".kafka-tui", "last-copy.txt")
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, "utf8")
  return path
}

/**
 * Owns its own `useKeyboard` for `r`/`y`/`escape` rather than routing through
 * `ConsumeTab`'s central handler the way `TopicBar`/`SearchBox` do — those are
 * always mounted and need `ConsumeTab` to arbitrate between browse-mode keys
 * and edit-mode keys via `mode`. This component only ever *exists* in the tree
 * while detail mode is active (`ConsumeTab` conditionally renders it), so
 * mounting is already the scope guard; no mode check needed here.
 */
export function MessageDetail({ slot, schemaRegistryConfig, onClose }: MessageDetailProps) {
  const renderer = useRenderer()
  const [view, setView] = useState<ViewMode>("decoded")
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [subjectVersions, setSubjectVersions] = useState<{ subject: string; version: number }[] | null>(null)

  const message = slot.value
  // Reads the same live, mutable, memoized field row rendering does — if this message's
  // Avro decode was still "pending" when Enter was pressed, this picks up the resolved
  // value for free the next time ConsumeTab's tick bump re-renders this component; no
  // separate polling needed here (decision 2).
  const decoded = getOrDecode(message)
  const schemaId = message.value ? extractConfluentSchemaId(message.value) : null

  useEffect(() => {
    setCopyStatus(null)
  }, [view])

  useEffect(() => {
    setSubjectVersions(null)
    if (schemaId === null || !schemaRegistryConfig) return
    let cancelled = false
    void fetchSchemaSubjectVersions(schemaRegistryConfig, schemaId).then((result) => {
      if (!cancelled) setSubjectVersions(result)
    })
    return () => {
      cancelled = true
    }
  }, [schemaId, schemaRegistryConfig])

  const keyText = decodeMessage(message.key).preview

  const prettyJsonTokens = useMemo(() => {
    if (decoded.kind !== "json" || decoded.value === undefined) return null
    return tokenizeJson(decoded.value)
  }, [decoded])

  /** Plain text for the current view — used for both non-JSON display and the copy target. */
  const plainViewText = useMemo(() => {
    if (view === "hex") return message.value ? toFullHexDump(message.value) : "(empty)"
    if (view === "base64") return message.value ? message.value.toString("base64") : "(empty)"
    if (prettyJsonTokens) return JSON.stringify(decoded.value, null, 2)
    if (decoded.kind === "text") return message.value?.toString("utf8") ?? decoded.preview
    return decoded.preview
  }, [view, decoded, message.value, prettyJsonTokens])

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose()
    } else if (key.name === "r") {
      setView((v) => VIEW_CYCLE[(VIEW_CYCLE.indexOf(v) + 1) % VIEW_CYCLE.length] as ViewMode)
    } else if (key.name === "y") {
      // "Copy what you see" (decision 3) — spec's "raw value" copy is what the hex/base64
      // views are for; the decoded view's copy is the more useful full pretty JSON instead.
      if (renderer.isOsc52Supported() && renderer.copyToClipboardOSC52(plainViewText)) {
        setCopyStatus("✓ copied to clipboard (OSC 52)")
        return
      }
      try {
        const path = writeCopyFallbackFile(plainViewText)
        setCopyStatus(`Clipboard unsupported — wrote to ${path}`)
      } catch (err) {
        setCopyStatus(`Copy failed: ${(err as Error).message}`)
      }
    }
  })

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>{`Partition: ${message.partition}`}</text>
        <text fg={theme.fgDim}>{`Offset: ${message.offset}`}</text>
        <text fg={theme.fgDim}>{`Timestamp: ${new Date(Number(message.timestamp)).toISOString()}`}</text>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>Key:</text>
        <text fg={theme.info} truncate wrapMode="none">
          {keyText}
        </text>
      </box>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        <text fg={theme.fgDim}>Headers:</text>
        <text fg={theme.fg} truncate wrapMode="none">
          {Object.keys(message.headers).length === 0
            ? "(none)"
            : Object.entries(message.headers)
                .map(([key, value]) => `${key}=${decodeHeaderValue(value)}`)
                .join("  ")}
        </text>
      </box>
      {schemaId !== null && (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
          <text fg={theme.fgDim}>{`Schema ID: ${schemaId}`}</text>
          <text fg={theme.fgDim}>
            {subjectVersions === null
              ? "(subject/version unavailable)"
              : `Subject: ${subjectVersions.map((v) => `${v.subject} v${v.version}`).join(", ")}`}
          </text>
        </box>
      )}
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1 }}>
        {VIEW_CYCLE.map((v) => (
          <text key={v} fg={v === view ? theme.accent : theme.fgDim}>
            {v === view ? `[${v}]` : v}
          </text>
        ))}
        {copyStatus && (
          <text fg={theme.success} truncate wrapMode="none">
            {copyStatus}
          </text>
        )}
      </box>
      <scrollbox focused style={{ flexGrow: 1 }}>
        <text>{prettyJsonTokens && view === "decoded" ? renderTokens(prettyJsonTokens) : plainViewText}</text>
      </scrollbox>
    </box>
  )
}

function renderTokens(tokens: JsonToken[]) {
  return tokens.map((token, i) => (
    <span key={i} fg={token.color ?? theme.fg}>
      {token.text}
    </span>
  ))
}
