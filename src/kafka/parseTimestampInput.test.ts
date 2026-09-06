import { describe, expect, test } from "bun:test"
import { parseTimestampInput } from "./parseTimestampInput"

describe("parseTimestampInput", () => {
  test("empty or whitespace-only input is null", () => {
    expect(parseTimestampInput("")).toBeNull()
    expect(parseTimestampInput("   ")).toBeNull()
  })

  test("all-digits is treated as epoch milliseconds", () => {
    expect(parseTimestampInput("1730000000000")).toBe(1730000000000)
    expect(parseTimestampInput(" 0 ")).toBe(0)
  })

  test("date-only is midnight UTC", () => {
    expect(parseTimestampInput("2026-09-06")).toBe(Date.UTC(2026, 8, 6, 0, 0, 0, 0))
  })

  test("date+time with no offset is UTC, not local time", () => {
    // Deliberately compared against Date.UTC, not `new Date(...)`, so this assertion would
    // fail on a machine in a non-UTC timezone if the implementation ever regressed to using
    // bare Date.parse for the offset-less case.
    expect(parseTimestampInput("2026-09-06T12:30:45")).toBe(Date.UTC(2026, 8, 6, 12, 30, 45, 0))
  })

  test("date+time with a space separator (no offset) is also UTC", () => {
    expect(parseTimestampInput("2026-09-06 12:30:45")).toBe(Date.UTC(2026, 8, 6, 12, 30, 45, 0))
  })

  test("a trailing Z is UTC (same result as no offset, since the label already promises UTC)", () => {
    expect(parseTimestampInput("2026-09-06T12:30:45Z")).toBe(Date.UTC(2026, 8, 6, 12, 30, 45, 0))
  })

  test("milliseconds are respected", () => {
    expect(parseTimestampInput("2026-09-06T12:30:45.123Z")).toBe(Date.UTC(2026, 8, 6, 12, 30, 45, 123))
  })

  test("an explicit non-UTC offset is honored, not overridden", () => {
    // 12:00 at +02:00 is 10:00 UTC.
    expect(parseTimestampInput("2026-09-06T12:00:00+02:00")).toBe(Date.UTC(2026, 8, 6, 10, 0, 0, 0))
    // Same, without the colon in the offset.
    expect(parseTimestampInput("2026-09-06T12:00:00+0200")).toBe(Date.UTC(2026, 8, 6, 10, 0, 0, 0))
    // A negative offset.
    expect(parseTimestampInput("2026-09-06T12:00:00-05:00")).toBe(Date.UTC(2026, 8, 6, 17, 0, 0, 0))
  })

  test("hour:minute with no seconds", () => {
    expect(parseTimestampInput("2026-09-06T12:30Z")).toBe(Date.UTC(2026, 8, 6, 12, 30, 0, 0))
  })

  test("garbage input is null", () => {
    expect(parseTimestampInput("not a date")).toBeNull()
    expect(parseTimestampInput("2026/09/06")).toBeNull()
  })

  test("a negative number string is not accepted as epoch millis", () => {
    expect(parseTimestampInput("-100")).toBeNull()
  })
})
