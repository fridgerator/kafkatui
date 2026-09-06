import { describe, expect, test } from "bun:test"
import { computeViewportStart } from "./useListViewport"

describe("computeViewportStart", () => {
  test("index already within the window: viewport doesn't move", () => {
    expect(computeViewportStart(5, 7, 10, 100)).toBe(5)
  })

  test("index above the window: scrolls up to bring it to the top", () => {
    expect(computeViewportStart(10, 3, 10, 100)).toBe(3)
  })

  test("index below the window: scrolls down just enough to reveal it at the bottom", () => {
    // window [10, 19], index 25 with rowCount 10 -> new start puts 25 at the last row
    expect(computeViewportStart(10, 25, 10, 100)).toBe(16)
  })

  test("clamps to 0 when the computed start would go negative", () => {
    expect(computeViewportStart(0, 0, 10, 100)).toBe(0)
  })

  test("clamps to itemCount - rowCount when the list shrinks out from under the viewport", () => {
    // was scrolled to 90 in a 100-item list; the list shrinks to 20 items, rowCount stays 10
    expect(computeViewportStart(90, 15, 10, 20)).toBe(10)
  })

  test("rowCount >= itemCount: viewport always sits at 0", () => {
    expect(computeViewportStart(5, 2, 10, 5)).toBe(0)
  })

  test("empty list: viewport sits at 0 regardless of current/index", () => {
    expect(computeViewportStart(3, 0, 10, 0)).toBe(0)
  })

  test("hundreds of items: scrolling to the last index lands the viewport at the true end", () => {
    expect(computeViewportStart(0, 499, 20, 500)).toBe(480)
  })

  test("stepping one index at a time down a long list advances the viewport by one each time", () => {
    let start = 0
    for (let i = 0; i < 50; i++) {
      start = computeViewportStart(start, i, 10, 500)
    }
    // first 10 indices (0-9) fit in the initial window without moving it; index 10 onward
    // pushes the window forward by exactly one per step.
    expect(start).toBe(40)
  })
})
