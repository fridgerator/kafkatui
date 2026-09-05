import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { BufferedMessage } from "../kafka/types"
import { toNdjson, toNdjsonRecord, writeNdjsonExport } from "./ndjson"

function message(overrides: Partial<BufferedMessage> = {}): BufferedMessage {
  return {
    topic: "orders.json",
    partition: 0,
    offset: "42",
    key: null,
    value: null,
    headers: {},
    timestamp: "1700000000000",
    receivedAt: Date.now(),
    ...overrides,
  }
}

describe("toNdjsonRecord", () => {
  test("a JSON message keeps its real parsed value, no valueEncoding", () => {
    const value = Buffer.from(JSON.stringify({ orderId: "abc", qty: 2 }), "utf8")
    const record = toNdjsonRecord(message({ value }))
    expect(record.value).toEqual({ orderId: "abc", qty: 2 })
    expect(record.valueEncoding).toBeUndefined()
  })

  test("a text message keeps the raw utf8 string", () => {
    const value = Buffer.from("2026-09-05 ERROR something broke", "utf8")
    const record = toNdjsonRecord(message({ value }))
    expect(record.value).toBe("2026-09-05 ERROR something broke")
    expect(record.valueEncoding).toBeUndefined()
  })

  test("a binary (non-JSON, non-text) message falls back to base64 with valueEncoding set", () => {
    const value = Buffer.from([0x00, 0x01, 0xff, 0xfe])
    const record = toNdjsonRecord(message({ value }))
    expect(record.value).toBe(value.toString("base64"))
    expect(record.valueEncoding).toBe("base64")
  })

  test("an empty value is null, still base64-flagged rather than treated as JSON/text", () => {
    const record = toNdjsonRecord(message({ value: null }))
    expect(record.value).toBeNull()
    expect(record.valueEncoding).toBe("base64")
  })

  test("key is decoded as utf8, or null when absent", () => {
    expect(toNdjsonRecord(message({ key: Buffer.from("order-1", "utf8") })).key).toBe("order-1")
    expect(toNdjsonRecord(message({ key: null })).key).toBeNull()
  })

  test("headers: strings, buffers, and arrays are all converted to strings; undefined entries are dropped", () => {
    const record = toNdjsonRecord(
      message({
        headers: {
          "content-type": "application/json",
          "trace-id": Buffer.from("trace-abc", "utf8"),
          "multi": ["a", Buffer.from("b", "utf8")],
          "absent": undefined,
        },
      }),
    )
    expect(record.headers).toEqual({
      "content-type": "application/json",
      "trace-id": "trace-abc",
      multi: ["a", "b"],
    })
    expect(record.headers).not.toHaveProperty("absent")
  })

  test("partition/offset/timestamp/topic pass through unchanged", () => {
    const record = toNdjsonRecord(message({ topic: "logs.text", partition: 3, offset: "999", timestamp: "1700000001234" }))
    expect(record.topic).toBe("logs.text")
    expect(record.partition).toBe(3)
    expect(record.offset).toBe("999")
    expect(record.timestamp).toBe("1700000001234")
  })
})

describe("toNdjson", () => {
  test("empty input produces an empty string", () => {
    expect(toNdjson([])).toBe("")
  })

  test("joins records with newlines and ends with a trailing newline", () => {
    const messages = [message({ offset: "1" }), message({ offset: "2" })]
    const output = toNdjson(messages)
    const lines = output.split("\n")
    expect(lines).toHaveLength(3) // 2 records + trailing empty string from the final \n
    expect(lines[2]).toBe("")
    expect(JSON.parse(lines[0]!).offset).toBe("1")
    expect(JSON.parse(lines[1]!).offset).toBe("2")
  })
})

describe("writeNdjsonExport", () => {
  const exportsDir = join(homedir(), ".kafka-tui", "exports")
  const writtenPaths: string[] = []

  afterEach(() => {
    for (const path of writtenPaths.splice(0)) rmSync(path, { force: true })
  })

  test("creates ~/.kafka-tui/exports if needed and writes valid NDJSON", () => {
    const path = writeNdjsonExport("orders.json", [message({ offset: "1" }), message({ offset: "2" })])
    writtenPaths.push(path)

    expect(dirname(path)).toBe(exportsDir)
    expect(existsSync(path)).toBe(true)
    expect(path.startsWith(join(exportsDir, "orders.json-"))).toBe(true)
    expect(path.endsWith(".ndjson")).toBe(true)

    const lines = readFileSync(path, "utf8").trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).offset).toBe("1")
  })

  test("two exports in quick succession get distinct filenames (random suffix, not just the timestamp)", () => {
    const before = new Set(existsSync(exportsDir) ? readdirSync(exportsDir) : [])
    const pathA = writeNdjsonExport("orders.json", [message()])
    const pathB = writeNdjsonExport("orders.json", [message()])
    writtenPaths.push(pathA, pathB)

    expect(pathA).not.toBe(pathB)
    const after = readdirSync(exportsDir)
    expect(after.filter((f) => !before.has(f))).toHaveLength(2)
  })
})
