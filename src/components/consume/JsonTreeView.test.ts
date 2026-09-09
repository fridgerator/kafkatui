import { describe, expect, test } from "bun:test"
import { buildJsonTree, flattenTree } from "../../kafka/decode/jsonTree"
import { caret, containerBrace, rowText } from "./JsonTreeView"

const rows = (value: unknown, collapsed: string[] = []) =>
  flattenTree(buildJsonTree(value), new Set(collapsed))

describe("caret", () => {
  test("expanded / collapsed / primitive", () => {
    const [root, , items] = rows({ items: [1, 2] })
    expect(caret(root!)).toBe("▾ ")
    const collapsedItems = rows({ items: [1, 2] }, ["$.items"])[1]!
    expect(caret(collapsedItems)).toBe("▸ ")
    expect(caret(items!)).toBe("  ") // the primitive 1
  })
})

describe("containerBrace", () => {
  test("open brace when expanded, summary when collapsed", () => {
    const arr = rows({ items: [1, 2, 3] })[1]!
    expect(containerBrace(arr)).toBe("[")
    const collapsedArr = rows({ items: [1, 2, 3] }, ["$.items"])[1]!
    expect(containerBrace(collapsedArr)).toBe("[…3]")
    const collapsedObj = rows({ a: { x: 1, y: 2 } }, ["$.a"])[1]!
    expect(containerBrace(collapsedObj)).toBe("{…2}")
  })
})

describe("rowText", () => {
  test("indents by depth and shows key + value", () => {
    const list = rows({ customer: { zip: "98101" } })
    const zip = list.find((r) => r.path === "$.customer.zip")!
    // depth 2 → 4 spaces indent + 2-space caret column + "key: " + value
    expect(rowText(zip)).toBe(`      zip: "98101"`)
  })

  test("a search hit's offset lines up with rowText", () => {
    const zip = rows({ customer: { zip: "98101" } }).find((r) => r.path === "$.customer.zip")!
    const text = rowText(zip)
    expect(text.toLowerCase().indexOf("98101")).toBeGreaterThan(0)
  })
})
