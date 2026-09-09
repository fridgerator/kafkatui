import { describe, expect, test } from "bun:test"
import { theme } from "../../theme/monokai"
import {
  buildJsonTree,
  defaultCollapsed,
  expandAncestors,
  flattenTree,
  parentIndex,
  primitiveToken,
  searchMatches,
  MAX_EXPANDED_CHILDREN,
} from "./jsonTree"

const EMPTY = new Set<string>()

describe("primitiveToken", () => {
  test("colours by type and keeps string quotes", () => {
    expect(primitiveToken("hi")).toEqual({ text: '"hi"', color: theme.synString })
    expect(primitiveToken(42)).toEqual({ text: "42", color: theme.synNumber })
    expect(primitiveToken(true)).toEqual({ text: "true", color: theme.synBoolean })
    expect(primitiveToken(null)).toEqual({ text: "null", color: theme.synNull })
  })
})

describe("buildJsonTree", () => {
  test("models objects, arrays and primitives with paths and child counts", () => {
    const root = buildJsonTree({ a: 1, items: [{ sku: "X" }, { sku: "Y" }] })
    expect(root.path).toBe("$")
    expect(root.kind).toBe("object")
    expect(root.childCount).toBe(2)

    const items = root.children.find((c) => c.keyLabel === "items")!
    expect(items.kind).toBe("array")
    expect(items.path).toBe("$.items")
    expect(items.childCount).toBe(2)

    const firstSku = items.children[0]!.children[0]!
    expect(firstSku.path).toBe("$.items[0].sku")
    expect(firstSku.parentPath).toBe("$.items[0]")
    expect(firstSku.isArrayIndex).toBe(false)
    expect(items.children[0]!.isArrayIndex).toBe(true)
    expect(firstSku.primitive).toEqual({ text: '"X"', color: theme.synString })
  })
})

describe("defaultCollapsed", () => {
  test("collapses large containers, leaves small ones expanded, never the root", () => {
    const big = Object.fromEntries(Array.from({ length: MAX_EXPANDED_CHILDREN + 5 }, (_, i) => [`k${i}`, i]))
    const root = buildJsonTree({ small: { a: 1, b: 2 }, big })
    const collapsed = defaultCollapsed(root)
    expect(collapsed.has("$")).toBe(false)
    expect(collapsed.has("$.big")).toBe(true)
    expect(collapsed.has("$.small")).toBe(false)
  })

  test("collapses anything at or below the depth limit", () => {
    // depth: $ =0, l1=1 ... l6=6 → l6 collapsed even though it has one child
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: { leaf: 1 } } } } } } }
    const collapsed = defaultCollapsed(buildJsonTree(deep))
    expect(collapsed.has("$.l1.l2.l3.l4.l5")).toBe(false)
    expect(collapsed.has("$.l1.l2.l3.l4.l5.l6")).toBe(true)
  })
})

describe("flattenTree", () => {
  test("skips descendants of collapsed containers", () => {
    const root = buildJsonTree({ a: { b: { c: 1 } }, d: 2 })
    const all = flattenTree(root, EMPTY)
    expect(all.map((r) => r.path)).toEqual(["$", "$.a", "$.a.b", "$.a.b.c", "$.d"])

    const collapsed = flattenTree(root, new Set(["$.a"]))
    expect(collapsed.map((r) => r.path)).toEqual(["$", "$.a", "$.d"])
    expect(collapsed.find((r) => r.path === "$.a")!.collapsed).toBe(true)
    expect(collapsed.find((r) => r.path === "$.a")!.hasChildren).toBe(true)
  })
})

describe("searchMatches", () => {
  const rows = flattenTree(
    buildJsonTree({ customer: { address: { zip: "98101" } }, tags: ["zippy", "cold"] }),
    new Set<string>(),
  )

  test("empty query matches nothing", () => {
    expect(searchMatches(rows, "  ")).toEqual([])
  })

  test("matches key names and scalar values, case-insensitively", () => {
    expect(searchMatches(rows, "ZIP")).toEqual(["$.customer.address.zip", "$.tags[0]"])
  })

  test("does not treat array indices as keys", () => {
    // "0" would match the tags[0] index label if indices counted as keys
    expect(searchMatches(rows, "0")).toEqual(["$.customer.address.zip"]) // only the "98101" value
  })
})

describe("expandAncestors", () => {
  test("removes every ancestor of the path from the collapsed set", () => {
    const root = buildJsonTree({ a: { b: { c: { d: 1 } } } })
    const parents = parentIndex(root)
    const collapsed = new Set(["$.a", "$.a.b", "$.a.b.c", "$.other"])
    const next = expandAncestors(collapsed, "$.a.b.c.d", parents)
    expect([...next].sort()).toEqual(["$.other"])
  })
})
