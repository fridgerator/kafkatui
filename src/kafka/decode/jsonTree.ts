/**
 * Pure tree model behind the message detail view's JSON browser
 * (`components/consume/JsonTreeView.tsx`). The old detail view flattened the
 * whole decoded value into one giant token array and rendered a `<span>` per
 * token — several seconds of layout for a few-hundred-KB payload. This models
 * the value as a collapsible tree instead, so the component only ever renders
 * the handful of rows in its viewport.
 *
 * Path scheme: root is `"$"`, an object child is `parent + "." + key`, an array
 * element is `parent + "[" + index + "]"`. Keys that themselves contain `.` or
 * `[` produce ambiguous paths — an accepted limitation; these are Kafka message
 * payloads, not arbitrary documents.
 */
import { theme } from "../../theme/monokai"

/** A container with more direct children than this is collapsed on open. */
export const MAX_EXPANDED_CHILDREN = 20
/** A container at or below this depth is collapsed on open regardless of size. */
export const MAX_EXPANDED_DEPTH = 6

export type JsonNodeKind = "primitive" | "object" | "array"

export interface PrimitiveToken {
  /** Display text — strings keep their surrounding quotes, as in JSON. */
  text: string
  color: string
}

export interface JsonNode {
  path: string
  parentPath: string | null
  depth: number
  /** Object key, or array index as a string, or `null` for the root. */
  keyLabel: string | null
  isArrayIndex: boolean
  kind: JsonNodeKind
  primitive?: PrimitiveToken
  childCount: number
  children: JsonNode[]
}

/** Colour a scalar by type, reusing the theme's syntax tokens. */
export function primitiveToken(value: unknown): PrimitiveToken {
  if (value === null) return { text: "null", color: theme.synNull }
  switch (typeof value) {
    case "string":
      return { text: JSON.stringify(value), color: theme.synString }
    case "number":
      return { text: String(value), color: theme.synNumber }
    case "boolean":
      return { text: String(value), color: theme.synBoolean }
    default:
      // undefined / bigint / function etc. can't appear in parsed JSON, but be safe.
      return { text: String(value), color: theme.fg }
  }
}

function buildNode(
  value: unknown,
  path: string,
  parentPath: string | null,
  depth: number,
  keyLabel: string | null,
  isArrayIndex: boolean,
): JsonNode {
  if (Array.isArray(value)) {
    const children = value.map((item, i) =>
      buildNode(item, `${path}[${i}]`, path, depth + 1, String(i), true),
    )
    return { path, parentPath, depth, keyLabel, isArrayIndex, kind: "array", childCount: children.length, children }
  }
  if (value !== null && typeof value === "object") {
    const children = Object.entries(value as Record<string, unknown>).map(([key, child]) =>
      buildNode(child, `${path}.${key}`, path, depth + 1, key, false),
    )
    return { path, parentPath, depth, keyLabel, isArrayIndex, kind: "object", childCount: children.length, children }
  }
  return {
    path,
    parentPath,
    depth,
    keyLabel,
    isArrayIndex,
    kind: "primitive",
    primitive: primitiveToken(value),
    childCount: 0,
    children: [],
  }
}

export function buildJsonTree(value: unknown): JsonNode {
  return buildNode(value, "$", null, 0, null, false)
}

/**
 * Paths to collapse on open: "auto-expand small, collapse large" — any non-root
 * container with more than `MAX_EXPANDED_CHILDREN` children, or at/below
 * `MAX_EXPANDED_DEPTH`. The root always stays expanded so something is visible.
 */
export function defaultCollapsed(root: JsonNode): Set<string> {
  const collapsed = new Set<string>()
  const walk = (node: JsonNode) => {
    if (node.childCount > 0 && node.parentPath !== null) {
      if (node.childCount > MAX_EXPANDED_CHILDREN || node.depth >= MAX_EXPANDED_DEPTH) {
        collapsed.add(node.path)
      }
    }
    node.children.forEach(walk)
  }
  walk(root)
  return collapsed
}

export interface JsonRow {
  path: string
  parentPath: string | null
  depth: number
  keyLabel: string | null
  isArrayIndex: boolean
  kind: JsonNodeKind
  primitiveText?: string
  primitiveColor?: string
  childCount: number
  hasChildren: boolean
  collapsed: boolean
}

/**
 * Depth-first list of the rows to display. Collapsed containers contribute one
 * row and their descendants are skipped entirely, so cost is O(visible rows),
 * not O(payload).
 */
export function flattenTree(root: JsonNode, collapsed: ReadonlySet<string>): JsonRow[] {
  const rows: JsonRow[] = []
  const visit = (node: JsonNode) => {
    const hasChildren = node.childCount > 0
    const isCollapsed = hasChildren && collapsed.has(node.path)
    rows.push({
      path: node.path,
      parentPath: node.parentPath,
      depth: node.depth,
      keyLabel: node.keyLabel,
      isArrayIndex: node.isArrayIndex,
      kind: node.kind,
      primitiveText: node.primitive?.text,
      primitiveColor: node.primitive?.color,
      childCount: node.childCount,
      hasChildren,
      collapsed: isCollapsed,
    })
    if (hasChildren && !isCollapsed) node.children.forEach(visit)
  }
  visit(root)
  return rows
}

/** `path -> parentPath` for every node, for walking ancestors of a search hit. */
export function parentIndex(root: JsonNode): Map<string, string | null> {
  const index = new Map<string, string | null>()
  const walk = (node: JsonNode) => {
    index.set(node.path, node.parentPath)
    node.children.forEach(walk)
  }
  walk(root)
  return index
}

/** Removes every ancestor of `path` from `collapsed`, returning a new set. */
export function expandAncestors(
  collapsed: ReadonlySet<string>,
  path: string,
  parents: ReadonlyMap<string, string | null>,
): Set<string> {
  const next = new Set(collapsed)
  let parent = parents.get(path) ?? null
  while (parent) {
    next.delete(parent)
    parent = parents.get(parent) ?? null
  }
  return next
}

/**
 * Paths of rows matching `query` (case-insensitive substring), in document
 * order. Matches object key names and scalar values; array indices are not
 * treated as keys.
 */
export function searchMatches(rows: readonly JsonRow[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: string[] = []
  for (const row of rows) {
    const keyHit = !row.isArrayIndex && row.keyLabel !== null && row.keyLabel.toLowerCase().includes(q)
    const valueHit = row.primitiveText !== undefined && row.primitiveText.toLowerCase().includes(q)
    if (keyHit || valueHit) out.push(row.path)
  }
  return out
}
