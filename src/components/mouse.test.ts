import { describe, expect, test } from "bun:test"
import type { MouseEvent } from "@opentui/core"
import { rowClickAction, wheelSteps } from "./mouse"

describe("rowClickAction", () => {
  test("clicking the already-selected row opens", () => {
    expect(rowClickAction("g1", "g1")).toBe("open")
    expect(rowClickAction(7, 7)).toBe("open")
  })

  test("clicking any other row selects", () => {
    expect(rowClickAction("g2", "g1")).toBe("select")
    expect(rowClickAction("g1", null)).toBe("select")
  })
})

describe("wheelSteps", () => {
  const evt = (direction?: "up" | "down"): MouseEvent =>
    ({ scroll: direction ? { direction, delta: 1 } : undefined }) as MouseEvent

  test("scroll up is negative, scroll down is positive", () => {
    expect(wheelSteps(evt("up"))).toBe(-3)
    expect(wheelSteps(evt("down"))).toBe(3)
  })

  test("respects a custom step", () => {
    expect(wheelSteps(evt("down"), 1)).toBe(1)
  })

  test("a non-scroll event yields 0", () => {
    expect(wheelSteps(evt())).toBe(0)
  })
})
