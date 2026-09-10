import { describe, expect, test } from "bun:test"
import { fitCell, fitCellRight } from "./tableCell"

describe("fitCell", () => {
  test("pads a shorter string to the full width, left-aligned", () => {
    expect(fitCell("abc", 6)).toBe("abc   ")
  })

  test("leaves an exact-width string untouched", () => {
    expect(fitCell("abcdef", 6)).toBe("abcdef")
  })

  test("truncates a longer string with a trailing ellipsis, keeping the exact width", () => {
    expect(fitCell("abcdefghij", 6)).toBe("abcde…")
    expect(fitCell("abcdefghij", 6).length).toBe(6)
  })

  test("width 1 yields a single character", () => {
    expect(fitCell("", 1)).toBe(" ")
    expect(fitCell("x", 1)).toBe("x")
    expect(fitCell("xyz", 1)).toBe("…")
  })

  test("empty string pads to width", () => {
    expect(fitCell("", 4)).toBe("    ")
  })

  test("non-positive width yields an empty string", () => {
    expect(fitCell("abc", 0)).toBe("")
  })
})

describe("fitCellRight", () => {
  test("right-pads a shorter string", () => {
    expect(fitCellRight("42", 5)).toBe("   42")
  })

  test("leaves an exact-width string untouched", () => {
    expect(fitCellRight("12345", 5)).toBe("12345")
  })

  test("drops the front of a longer string with a leading ellipsis, keeping the exact width", () => {
    expect(fitCellRight("1234567", 5)).toBe("…4567")
    expect(fitCellRight("1234567", 5).length).toBe(5)
  })

  test("non-positive width yields an empty string", () => {
    expect(fitCellRight("abc", 0)).toBe("")
  })
})
