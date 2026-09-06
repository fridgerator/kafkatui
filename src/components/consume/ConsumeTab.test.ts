import { describe, expect, test } from "bun:test"
import { cappedEndSeq } from "./ConsumeTab"

describe("cappedEndSeq", () => {
  test("following (pausedAtSeq null): unconstrained — just viewportStartSeq + rowCount - 1", () => {
    expect(cappedEndSeq(100, 20, null)).toBe(119)
  })

  test("paused, screen already full at pause time: cap is above the raw end, so it's a no-op", () => {
    // Paused with 500 messages already existing when the raw window only needs up to 119.
    expect(cappedEndSeq(100, 20, 500)).toBe(119)
  })

  test("paused before a full screen accumulated: cap holds the window back from backfilling", () => {
    // This is the actual bug: only 105 messages existed when pausing began (seq 0..104), but
    // the raw window would want up to 119 — the cap must keep it at 104, not silently grow to
    // 119 as more messages arrive after the pause.
    expect(cappedEndSeq(100, 20, 104)).toBe(104)
  })

  test("paused exactly at the raw end: cap equals the raw end, changes nothing", () => {
    expect(cappedEndSeq(100, 20, 119)).toBe(119)
  })

  test("paused with nothing yet buffered past the viewport start", () => {
    expect(cappedEndSeq(100, 20, 100)).toBe(100)
  })
})
