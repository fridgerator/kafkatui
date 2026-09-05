import { describe, expect, test } from "bun:test"
import { FilterParseError, parseFilter } from "./parseFilter"

describe("parseFilter", () => {
  test("simple nested key path", () => {
    expect(parseFilter('metadata.retryCount > 3')).toEqual({
      path: [
        { key: "metadata", isArray: false },
        { key: "retryCount", isArray: false },
      ],
      op: ">",
      value: 3,
    })
  })

  test("existential array-of-objects path (spec example)", () => {
    expect(parseFilter('my.nested[].key = "my little pony"')).toEqual({
      path: [
        { key: "my", isArray: false },
        { key: "nested", isArray: true },
        { key: "key", isArray: false },
      ],
      op: "=",
      value: "my little pony",
    })
  })

  test("array-of-scalars path with trailing [] and no further key (spec example)", () => {
    expect(parseFilter('user.roles[] contains "admin"')).toEqual({
      path: [
        { key: "user", isArray: false },
        { key: "roles", isArray: true },
      ],
      op: "contains",
      value: "admin",
    })
  })

  test("headers.contentType equality (spec example)", () => {
    expect(parseFilter('headers.contentType = "application/json"')).toEqual({
      path: [
        { key: "headers", isArray: false },
        { key: "contentType", isArray: false },
      ],
      op: "=",
      value: "application/json",
    })
  })

  const operators: Array<[string, import("./parseFilter").Op]> = [
    ["=", "="],
    ["!=", "!="],
    ["contains", "contains"],
    [">", ">"],
    ["<", "<"],
    [">=", ">="],
    ["<=", "<="],
    ["~=", "~="],
  ]
  for (const [text, op] of operators) {
    test(`operator "${text}" parses`, () => {
      const result = parseFilter(`a ${text} 1`)
      expect(result.op).toBe(op)
    })
  }

  test("negative and decimal numbers", () => {
    expect(parseFilter("a > -3.5").value).toBe(-3.5)
    expect(parseFilter("a > 42").value).toBe(42)
  })

  test("boolean and null literals", () => {
    expect(parseFilter("a = true").value).toBe(true)
    expect(parseFilter("a = false").value).toBe(false)
    expect(parseFilter("a = null").value).toBe(null)
  })

  test("string with escaped quotes and backslashes", () => {
    expect(parseFilter('a = "say \\"hi\\""').value).toBe('say "hi"')
    expect(parseFilter('a = "back\\\\slash"').value).toBe("back\\slash")
  })

  test("tolerates extra whitespace everywhere", () => {
    expect(parseFilter('  a . b [ ] . c   =   "x"  ')).toEqual({
      path: [
        { key: "a", isArray: false },
        { key: "b", isArray: true },
        { key: "c", isArray: false },
      ],
      op: "=",
      value: "x",
    })
  })

  test("multiple array segments in one path", () => {
    expect(parseFilter('a[].b[].c = 1')).toEqual({
      path: [
        { key: "a", isArray: true },
        { key: "b", isArray: true },
        { key: "c", isArray: false },
      ],
      op: "=",
      value: 1,
    })
  })

  describe("errors", () => {
    test("empty input", () => {
      expect(() => parseFilter("")).toThrow(FilterParseError)
    })

    test("missing operator", () => {
      expect(() => parseFilter("a.b")).toThrow(FilterParseError)
    })

    test("missing value", () => {
      expect(() => parseFilter("a = ")).toThrow(FilterParseError)
    })

    test("unterminated string", () => {
      expect(() => parseFilter('a = "unterminated')).toThrow(/[Uu]nterminated/)
    })

    test("unknown operator word", () => {
      expect(() => parseFilter("a matches 1")).toThrow(FilterParseError)
    })

    test("AND chaining reports a clear 'not supported yet', not a generic parse failure", () => {
      expect(() => parseFilter('a = 1 AND b = 2')).toThrow(/AND\/OR chaining isn't supported yet/)
    })

    test("stray unclosed bracket", () => {
      expect(() => parseFilter("a[ = 1")).toThrow(FilterParseError)
    })

    test("unexpected character", () => {
      expect(() => parseFilter("a % 1")).toThrow(FilterParseError)
    })

    test("error carries a source position", () => {
      try {
        parseFilter("a = ")
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(FilterParseError)
        expect((err as InstanceType<typeof FilterParseError>).position).toBeGreaterThanOrEqual(0)
      }
    })
  })
})
