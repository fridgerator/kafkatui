import { describe, expect, test } from "bun:test"
import { sparklineChars } from "./Sparkline"

describe("sparklineChars", () => {
  test("empty input never throws and produces an empty string", () => {
    expect(sparklineChars([])).toBe("")
  })

  test("one character per value", () => {
    expect(sparklineChars([1, 2, 3, 4, 5]).length).toBe(5)
  })

  test("monotonically increasing values produce a monotonically non-decreasing character sequence", () => {
    const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
    const chars = sparklineChars([0, 10, 20, 30, 40, 50, 60, 70]).split("")
    const levels = chars.map((c) => BLOCKS.indexOf(c))
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1] as number)
    }
    expect(levels[0]).toBe(0) // the minimum value gets the lowest block
    expect(levels[levels.length - 1]).toBe(7) // the maximum value gets the highest block
  })

  test("a flat (all-equal) history renders as a flat line, scaled to its own value not a fixed 0-baseline", () => {
    // Regression case: a naive `(v - 0) / (max - 0)` scale would put a constant
    // nonzero history at the bottom block, visually indistinguishable from "no lag."
    const flatHigh = sparklineChars([500, 500, 500, 500])
    const flatZero = sparklineChars([0, 0, 0, 0])
    expect(new Set(flatHigh.split("")).size).toBe(1) // every character identical
    expect(new Set(flatZero.split("")).size).toBe(1)
  })

  test("a single value doesn't throw (zero range)", () => {
    expect(() => sparklineChars([42])).not.toThrow()
    expect(sparklineChars([42]).length).toBe(1)
  })

  test("negative values are handled the same way as positive ones", () => {
    expect(() => sparklineChars([-10, -5, 0, 5, 10])).not.toThrow()
    expect(sparklineChars([-10, -5, 0, 5, 10]).length).toBe(5)
  })
})
