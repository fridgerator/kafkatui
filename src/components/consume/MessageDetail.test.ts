import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { theme } from "../../theme/monokai"
import { decodeHeaderValue, tokenizeJson, writeCopyFallbackFile } from "./MessageDetail"

describe("tokenizeJson", () => {
  test("colors strings, numbers, booleans, and null with the theme's syntax tokens", () => {
    const tokens = tokenizeJson({ a: "x", b: 1, c: true, d: null })
    const colorFor = (text: string) => tokens.find((t) => t.text === text)?.color
    expect(colorFor('"x"')).toBe(theme.synString)
    expect(colorFor("1")).toBe(theme.synNumber)
    expect(colorFor("true")).toBe(theme.synBoolean)
    expect(colorFor("null")).toBe(theme.synNull)
    expect(colorFor('"a"')).toBe(theme.synKey)
  })

  test("produces valid, re-parseable JSON when concatenated", () => {
    const value = { orderId: "abc", items: [{ sku: "X", qty: 2 }], tags: [] as string[] }
    const tokens = tokenizeJson(value)
    const text = tokens.map((t) => t.text).join("")
    expect(JSON.parse(text)).toEqual(value)
  })

  test("indents nested structures with two spaces per level", () => {
    const tokens = tokenizeJson({ a: { b: 1 } })
    const text = tokens.map((t) => t.text).join("")
    expect(text).toContain('{\n  "a": {\n    "b": 1\n  }\n}')
  })

  test("empty arrays and objects render inline, not expanded", () => {
    const tokens = tokenizeJson({ arr: [], obj: {} })
    const text = tokens.map((t) => t.text).join("")
    expect(text).toContain('"arr": []')
    expect(text).toContain('"obj": {}')
  })
})

describe("decodeHeaderValue", () => {
  test("undefined renders as a placeholder, not a crash", () => {
    expect(decodeHeaderValue(undefined)).toBe("(none)")
  })

  test("a string header value round-trips through decodeMessage", () => {
    expect(decodeHeaderValue("application/json")).toBe("application/json")
  })

  test("a Buffer header value decodes the same way", () => {
    expect(decodeHeaderValue(Buffer.from("trace-abc", "utf8"))).toBe("trace-abc")
  })

  test("an array of header values joins each decoded element", () => {
    expect(decodeHeaderValue(["a", Buffer.from("b")])).toBe("a, b")
  })
})

describe("writeCopyFallbackFile", () => {
  const path = join(homedir(), ".kafka-tui", "last-copy.txt")

  afterEach(() => {
    rmSync(path, { force: true })
  })

  test("creates the ~/.kafka-tui directory if it doesn't exist and writes the text", () => {
    const returnedPath = writeCopyFallbackFile("hello from the fallback path")
    expect(returnedPath).toBe(path)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, "utf8")).toBe("hello from the fallback path")
  })

  test("overwrites on repeated calls rather than appending", () => {
    writeCopyFallbackFile("first")
    writeCopyFallbackFile("second")
    expect(readFileSync(path, "utf8")).toBe("second")
  })
})
