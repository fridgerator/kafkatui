import { describe, expect, test } from "bun:test"
import { evaluateFilter } from "./evaluateFilter"
import { parseFilter } from "./parseFilter"

function matches(query: string, value: unknown): boolean {
  return evaluateFilter(parseFilter(query), value)
}

describe("evaluateFilter", () => {
  test("simple nested key path", () => {
    const value = { metadata: { retryCount: 5 } }
    expect(matches("metadata.retryCount > 3", value)).toBe(true)
    expect(matches("metadata.retryCount > 10", value)).toBe(false)
  })

  test("existential match over an array of objects (spec example shape)", () => {
    const order = { items: [{ sku: "WIDGET-001" }, { sku: "GADGET-042" }] }
    expect(matches('items[].sku = "WIDGET-001"', order)).toBe(true)
    expect(matches('items[].sku = "NOPE"', order)).toBe(false)
  })

  test("array-of-scalars: [] expands to per-element string candidates, contains does substring", () => {
    const customer = { roles: ["customer", "admin"] }
    expect(matches('roles[] contains "admin"', customer)).toBe(true)
    expect(matches('roles[] contains "adm"', customer)).toBe(true) // substring, not exact
    expect(matches('roles[] contains "superadmin"', customer)).toBe(false)
  })

  test("contains on a whole array (no []) does membership, not substring", () => {
    const customer = { roles: ["customer", "admin"] }
    // No `[]` here — the whole `roles` array is the single candidate, so `contains`
    // dispatches to membership (exact-value match), not substring-within-string.
    expect(matches('roles contains "admin"', customer)).toBe(true)
    expect(matches('roles contains "adm"', customer)).toBe(false)
  })

  test("equality on string, number, boolean, null", () => {
    expect(matches('a = "x"', { a: "x" })).toBe(true)
    expect(matches("a = 3", { a: 3 })).toBe(true)
    expect(matches("a = true", { a: true })).toBe(true)
    expect(matches("a = null", { a: null })).toBe(true)
    expect(matches('a = "x"', { a: "y" })).toBe(false)
  })

  test("!= is the negation of =", () => {
    expect(matches('a != "y"', { a: "x" })).toBe(true)
    expect(matches('a != "x"', { a: "x" })).toBe(false)
  })

  test("numeric comparisons", () => {
    expect(matches("a > 3", { a: 4 })).toBe(true)
    expect(matches("a < 3", { a: 2 })).toBe(true)
    expect(matches("a >= 3", { a: 3 })).toBe(true)
    expect(matches("a <= 3", { a: 3 })).toBe(true)
    expect(matches("a > 3", { a: 3 })).toBe(false)
  })

  test("numeric operators never match non-numeric candidates", () => {
    expect(matches('a > 3', { a: "not a number" })).toBe(false)
  })

  test("contains substring match is case-insensitive", () => {
    expect(matches('headers.contentType contains "JSON"', { headers: { contentType: "application/json" } })).toBe(
      true,
    )
  })

  test("regex operator ~=", () => {
    expect(matches('a ~= "^WIDGET-"', { a: "WIDGET-001" })).toBe(true)
    expect(matches('a ~= "^GADGET-"', { a: "WIDGET-001" })).toBe(false)
  })

  test("an invalid regex pattern fails closed (no match), never throws", () => {
    expect(() => matches('a ~= "("', { a: "anything" })).not.toThrow()
    expect(matches('a ~= "("', { a: "anything" })).toBe(false)
  })

  test("missing key resolves to no candidates, no match, no throw", () => {
    expect(matches("a.b.c = 1", { a: {} })).toBe(false)
    expect(matches("a.b.c = 1", {})).toBe(false)
  })

  test("path expects an array but the value isn't one — no match, no throw", () => {
    expect(matches('a[].b = 1', { a: "not an array" })).toBe(false)
  })

  test("path expects an object but hits a scalar — no match, no throw", () => {
    expect(matches("a.b = 1", { a: 5 })).toBe(false)
  })

  test("path applied to null/primitive root value never throws", () => {
    expect(matches("a = 1", null)).toBe(false)
    expect(matches("a = 1", "just a string")).toBe(false)
    expect(matches("a = 1", 42)).toBe(false)
  })

  test("multiple array segments in one path (deep existential nesting)", () => {
    const value = { orders: [{ items: [{ sku: "A" }] }, { items: [{ sku: "B" }] }] }
    expect(matches("orders[].items[].sku = \"B\"", value)).toBe(true)
    expect(matches("orders[].items[].sku = \"C\"", value)).toBe(false)
  })
})
