import { describe, expect, test } from "bun:test"
import { toFullHexDump } from "./hexDump"

describe("toFullHexDump", () => {
  test("empty buffer", () => {
    expect(toFullHexDump(Buffer.alloc(0))).toBe("(empty)")
  })

  test("single short line: offset, hex, and ASCII gutter", () => {
    const dump = toFullHexDump(Buffer.from("Hi!"))
    expect(dump).toBe("00000000  48 69 21" + " ".repeat(47 - "48 69 21".length) + "  Hi!")
  })

  test("non-printable bytes render as '.' in the ASCII gutter", () => {
    const dump = toFullHexDump(Buffer.from([0x00, 0xff, 0x41]))
    expect(dump).toContain("00 ff 41")
    expect(dump).toContain("..A")
  })

  test("wraps to a new line every 16 bytes, with correct offsets", () => {
    const dump = toFullHexDump(Buffer.alloc(20, 0x41)) // 20 'A' bytes
    const lines = dump.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toStartWith("00000000")
    expect(lines[1]).toStartWith("00000010") // 16 in hex
    expect(lines[1]).toContain("AAAA") // remaining 4 bytes on the second line
  })
})
