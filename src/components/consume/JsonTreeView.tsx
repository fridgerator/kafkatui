import { useKeyboard } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  buildJsonTree,
  defaultCollapsed,
  expandAncestors,
  flattenTree,
  parentIndex,
  searchMatches,
  type JsonRow,
} from "../../kafka/decode/jsonTree"
import { theme } from "../../theme/monokai"
import { wheelSteps } from "../mouse"
import { useListViewport } from "../useListViewport"

interface JsonTreeViewProps {
  value: unknown
  /** Bubbled up so the detail pane / tab can suppress global keys while typing. */
  onSearchingChange: (searching: boolean) => void
}

const EMPTY_COLLAPSE = new Set<string>()

/** `▾ ` / `▸ ` / two spaces so primitive rows still align under a caret column. */
export function caret(row: JsonRow): string {
  if (!row.hasChildren) return "  "
  return row.collapsed ? "▸ " : "▾ "
}

/** The `{`, `[`, `{…3}`, `[…128]` shown after a container's key. */
export function containerBrace(row: JsonRow): string {
  const open = row.kind === "array" ? "[" : "{"
  if (!row.collapsed) return open
  const close = row.kind === "array" ? "]" : "}"
  return `${open}…${row.childCount}${close}`
}

function keyLabelText(row: JsonRow): string {
  return row.keyLabel === null ? "" : `${row.keyLabel}: `
}

/** Plain single-line text of a row — used for search-hit highlighting. */
export function rowText(row: JsonRow): string {
  const indent = "  ".repeat(row.depth)
  const value = row.kind === "primitive" ? (row.primitiveText ?? "") : containerBrace(row)
  return `${indent}${caret(row)}${keyLabelText(row)}${value}`
}

export function JsonTreeView({ value, onSearchingChange }: JsonTreeViewProps) {
  const root = useMemo(() => buildJsonTree(value), [value])
  const parents = useMemo(() => parentIndex(root), [root])
  const allRows = useMemo(() => flattenTree(root, EMPTY_COLLAPSE), [root])

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => defaultCollapsed(root))
  useEffect(() => {
    setCollapsed(defaultCollapsed(root))
  }, [root])

  const visibleRows = useMemo(() => flattenTree(root, collapsed), [root, collapsed])

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchDraft, setSearchDraft] = useState("")
  const [committedQuery, setCommittedQuery] = useState("")
  const [matchCursor, setMatchCursor] = useState(0)
  const [pendingJump, setPendingJump] = useState<string | null>(null)

  const matches = useMemo(() => searchMatches(allRows, committedQuery), [allRows, committedQuery])
  const matchedPaths = useMemo(() => new Set(matches), [matches])

  const { boxRef, rowCount, viewportStart, scrollToIndex } = useListViewport(visibleRows.length)

  useEffect(() => {
    onSearchingChange(searching)
  }, [searching, onSearchingChange])

  // Keep the selection in range when the visible list changes under it.
  useEffect(() => {
    setSelectedIndex((i) => Math.max(0, Math.min(i, visibleRows.length - 1)))
  }, [visibleRows.length])

  useEffect(() => {
    scrollToIndex(selectedIndex)
  }, [selectedIndex, scrollToIndex])

  const toggleCollapse = useCallback((row: JsonRow) => {
    if (!row.hasChildren) return
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(row.path)) next.delete(row.path)
      else next.add(row.path)
      return next
    })
  }, [])

  /** Queue a jump to `path`: expand its ancestors now, select it once it's on screen. */
  const jumpTo = useCallback(
    (path: string) => {
      setCollapsed((c) => expandAncestors(c, path, parents))
      setPendingJump(path)
    },
    [parents],
  )

  useEffect(() => {
    if (pendingJump === null) return
    const idx = visibleRows.findIndex((r) => r.path === pendingJump)
    if (idx >= 0) {
      setSelectedIndex(idx)
      setPendingJump(null)
    }
  }, [pendingJump, visibleRows])

  // On a freshly committed query, jump to the first hit.
  const lastJumpedQuery = useRef<string | null>(null)
  useEffect(() => {
    if (!committedQuery || matches.length === 0) {
      lastJumpedQuery.current = committedQuery || null
      return
    }
    if (lastJumpedQuery.current === committedQuery) return
    lastJumpedQuery.current = committedQuery
    setMatchCursor(0)
    jumpTo(matches[0] as string)
  }, [committedQuery, matches, jumpTo])

  const commitSearch = useCallback((query: string) => {
    setCommittedQuery(query)
    setSearching(false)
  }, [])

  useKeyboard((key) => {
    if (searching) {
      // Committing happens through the <input>'s onSubmit, matching the Consume
      // tab's search box — here we only need to handle cancel.
      if (key.name === "escape") setSearching(false)
      return
    }

    const row = visibleRows[selectedIndex]

    switch (key.name) {
      case "/":
        setSearchDraft(committedQuery)
        setSearching(true)
        break
      case "up":
      case "k":
        setSelectedIndex((i) => Math.max(0, i - 1))
        break
      case "down":
      case "j":
        setSelectedIndex((i) => Math.min(visibleRows.length - 1, i + 1))
        break
      case "right":
      case "l":
        if (row?.hasChildren) {
          if (row.collapsed) toggleCollapse(row)
          else setSelectedIndex((i) => Math.min(visibleRows.length - 1, i + 1))
        }
        break
      case "left":
      case "h":
        if (row?.hasChildren && !row.collapsed) {
          toggleCollapse(row)
        } else if (row?.parentPath) {
          const idx = visibleRows.findIndex((r) => r.path === row.parentPath)
          if (idx >= 0) setSelectedIndex(idx)
        }
        break
      case "return":
      case "space":
        if (row) toggleCollapse(row)
        break
      case "g":
        setSelectedIndex(key.shift ? visibleRows.length - 1 : 0)
        break
      case "n": {
        if (matches.length === 0) break
        const next = key.shift
          ? (matchCursor - 1 + matches.length) % matches.length
          : (matchCursor + 1) % matches.length
        setMatchCursor(next)
        jumpTo(matches[next] as string)
        break
      }
      case "[":
        setCollapsed(() => {
          const next = new Set<string>()
          for (const r of allRows) if (r.hasChildren && r.path !== "$") next.add(r.path)
          return next
        })
        setSelectedIndex(0)
        break
      case "]":
        setCollapsed(EMPTY_COLLAPSE)
        break
    }
  })

  const windowRows = visibleRows.slice(viewportStart, viewportStart + rowCount)

  const status =
    matches.length > 0
      ? `${visibleRows.length} rows · match ${matchCursor + 1}/${matches.length}`
      : committedQuery
        ? `${visibleRows.length} rows · no matches`
        : `${visibleRows.length} rows`

  return (
    <box style={{ flexDirection: "column", flexGrow: 1, overflow: "hidden" }}>
      {(searching || committedQuery) && (
        <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 1, paddingLeft: 1, overflow: "hidden" }}>
          <text flexShrink={0} fg={theme.fgDim}>
            Find:
          </text>
          {searching ? (
            <input
              value={searchDraft}
              onInput={setSearchDraft}
              onSubmit={commitSearch as never}
              focused
              placeholder="key or value"
              style={{ flexGrow: 1 }}
            />
          ) : (
            <text flexGrow={1} truncate wrapMode="none" fg={theme.info}>
              {committedQuery}
            </text>
          )}
          <text flexShrink={0} fg={theme.fgDim}>
            {searching ? "⏎ find · esc cancel" : "n/N cycle · / edit"}
          </text>
        </box>
      )}

      <box
        ref={boxRef}
        onMouseScroll={(e) =>
          setSelectedIndex((i) => Math.max(0, Math.min(visibleRows.length - 1, i + wheelSteps(e))))
        }
        style={{ flexGrow: 1, flexDirection: "column", overflow: "hidden" }}
      >
        {windowRows.map((row, i) => {
          const idx = viewportStart + i
          return (
          <JsonTreeRow
            key={row.path}
            row={row}
            selected={idx === selectedIndex}
            matched={matchedPaths.has(row.path)}
            query={committedQuery}
            onPress={() => {
              setSelectedIndex(idx)
              if (row.hasChildren) toggleCollapse(row)
            }}
          />
          )
        })}
      </box>

      <box style={{ flexDirection: "row", height: 1, flexShrink: 0, gap: 2, paddingLeft: 1, overflow: "hidden" }}>
        <text flexShrink={0} fg={theme.fgDim}>
          {status}
        </text>
        <text flexShrink={0} fg={theme.fgDim} truncate wrapMode="none">
          ↑↓ move · →← fold · space toggle · / search
        </text>
      </box>
    </box>
  )
}

interface JsonTreeRowProps {
  row: JsonRow
  selected: boolean
  matched: boolean
  query: string
  onPress?: () => void
}

function JsonTreeRow({ row, selected, matched, query, onPress }: JsonTreeRowProps) {
  const bg = selected ? theme.bgSelected : matched ? theme.bgPanel : undefined
  const line = rowText(row)

  // On a search hit, render the whole line as plain text with the match slice
  // inverted — same technique as MessageList's MessageRow. Type colours are
  // dropped on that one row, which is an acceptable trade for a clear hit marker.
  if (matched && query.trim()) {
    const lower = line.toLowerCase()
    const at = lower.indexOf(query.trim().toLowerCase())
    if (at >= 0) {
      const end = at + query.trim().length
      return (
        <text onMouseDown={onPress} truncate wrapMode="none" bg={bg} style={{ height: 1, flexShrink: 0 }}>
          <span fg={theme.fg}>{line.slice(0, at)}</span>
          <span fg={theme.fgInverted} bg={theme.warning}>
            {line.slice(at, end)}
          </span>
          <span fg={theme.fg}>{line.slice(end)}</span>
        </text>
      )
    }
  }

  const indent = "  ".repeat(row.depth) + caret(row)
  const caretColor = row.hasChildren ? theme.fgDim : theme.fg

  return (
    <text onMouseDown={onPress} truncate wrapMode="none" bg={bg} style={{ height: 1, flexShrink: 0 }}>
      <span fg={caretColor}>{indent}</span>
      {row.keyLabel !== null && (
        <span fg={row.isArrayIndex ? theme.fgDim : theme.synKey}>{keyLabelText(row)}</span>
      )}
      {row.kind === "primitive" ? (
        <span fg={row.primitiveColor ?? theme.fg}>{row.primitiveText ?? ""}</span>
      ) : (
        <span fg={theme.fgDim}>{containerBrace(row)}</span>
      )}
    </text>
  )
}
