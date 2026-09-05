import { describe, expect, test } from "bun:test"
import { decodeMessage } from "./decodeMessage"

describe("decodeMessage", () => {
  test("null value (tombstone) decodes as empty", () => {
    expect(decodeMessage(null)).toEqual({ kind: "empty", preview: "<empty>" })
  })

  test("empty buffer decodes as empty", () => {
    expect(decodeMessage(Buffer.alloc(0))).toEqual({ kind: "empty", preview: "<empty>" })
  })

  test("valid JSON decodes with the parsed value attached", () => {
    const result = decodeMessage(Buffer.from(JSON.stringify({ orderId: "abc", total: 12.5 })))
    expect(result.kind).toBe("json")
    expect(result.value).toEqual({ orderId: "abc", total: 12.5 })
  })

  test("plain text falls through to the text branch", () => {
    const result = decodeMessage(Buffer.from("2026-09-05T00:00:00Z [INFO] hello world"))
    expect(result.kind).toBe("text")
    expect(result.preview).toContain("hello world")
  })

  test("Confluent-wire-format Avro bytes fall back to binary/hex, not a crash (phase 4 fills this in)", () => {
    // magic byte 0x0 + 4-byte schema id + arbitrary non-UTF8 payload
    const buffer = Buffer.concat([Buffer.from([0x0, 0, 0, 0, 1]), Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02])])
    const result = decodeMessage(buffer)
    expect(result.kind).toBe("binary")
    expect(result.preview).toContain("bytes)")
  })

  test("arbitrary binary garbage never throws and falls back to binary", () => {
    const buffer = Buffer.from([0x80, 0x81, 0x82, 0x00, 0xff, 0xfe, 0x01, 0x02, 0x03, 0x04])
    expect(() => decodeMessage(buffer)).not.toThrow()
    expect(decodeMessage(buffer).kind).toBe("binary")
  })

  test("long text is truncated for the list-row preview", () => {
    const long = "x".repeat(500)
    const result = decodeMessage(Buffer.from(long))
    expect(result.preview.length).toBeLessThan(210)
    expect(result.preview.endsWith("…")).toBe(true)
  })
})
