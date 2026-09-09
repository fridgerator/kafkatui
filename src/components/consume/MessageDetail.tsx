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
import { JsonTreeView } from "./JsonTreeView"

type ViewMode = "decoded" | "hex" | "base64"
const VIEW_CYCLE: ViewMode[] = ["decoded", "hex", "base64"]

interface MessageDetailProps {
  slot: RingBufferSlot<BufferedMessage>
  schemaRegistryConfig: SchemaRegistryConfig | undefined
  onClose: () => void
  /** True while the JSON tree's search input is focused — lets the tab suppress global keys. */
  onSearchingChange?: (searching: boolean) => void
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
 *
 * For decoded JSON the body is `JsonTreeView` (collapsible, virtualized, with
 * key/value search) — it owns its own navigation keys; this handler stands down
 * entirely while its search input is focused (`treeSearching`).
 */
export function MessageDetail({ slot, schemaRegistryConfig, onClose, onSearchingChange }: MessageDetailProps) {
  const renderer = useRenderer()
  const [view, setView] = useState<ViewMode>("decoded")
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [treeSearching, setTreeSearching] = useState(false)
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

  const isJsonTree = view === "decoded" && decoded.kind === "json" && decoded.value !== undefined

  /** Plain text for the current view — non-JSON display, and the `y` copy target for every view. */
  const plainViewText = useMemo(() => {
    if (view === "hex") return message.value ? toFullHexDump(message.value) : "(empty)"
    if (view === "base64") return message.value ? message.value.toString("base64") : "(empty)"
    if (decoded.kind === "json" && decoded.value !== undefined) return JSON.stringify(decoded.value, null, 2)
    if (decoded.kind === "text") return message.value?.toString("utf8") ?? decoded.preview
    return decoded.preview
  }, [view, decoded, message.value])

  useEffect(() => {
    onSearchingChange?.(treeSearching)
  }, [treeSearching, onSearchingChange])

  useKeyboard((key) => {
    // While the tree's search input has focus, let it own every key (its own
    // handler catches escape to leave search); don't cycle views or close here.
    if (treeSearching) return

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
      {isJsonTree ? (
        <JsonTreeView value={decoded.value} onSearchingChange={setTreeSearching} />
      ) : (
        <scrollbox focused style={{ flexGrow: 1 }}>
          <text>{plainViewText}</text>
        </scrollbox>
      )}
    </box>
  )
}
