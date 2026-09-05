import type { FilterValue, Op, ParsedFilter, PathSegment } from "./parseFilter"

/**
 * Walks a path against a value, existentially expanding at every `isArray`
 * segment (spec §6.4: "matches if any array element satisfies the
 * condition"). A shape mismatch (missing key, non-object where an object was
 * expected, non-array where `[]` was written) just yields no candidates —
 * never throws. One malformed message must not break filtering the rest of
 * the buffer.
 */
function resolvePath(value: unknown, path: PathSegment[], index: number): unknown[] {
  if (index === path.length) return [value]
  if (value === null || typeof value !== "object") return []

  const segment = path[index] as PathSegment
  const next = (value as Record<string, unknown>)[segment.key]

  if (segment.isArray) {
    if (!Array.isArray(next)) return []
    return next.flatMap((element) => resolvePath(element, path, index + 1))
  }
  return resolvePath(next, path, index + 1)
}

function valuesEqual(a: unknown, b: FilterValue): boolean {
  return a === b
}

/**
 * `contains` is type-dispatched on the resolved candidate (spec §6.4:
 * "substring, for strings; membership, for arrays") rather than needing a
 * separate "array mode" — see the phase 5 plan's research notes for why this
 * covers both `roles[] contains "admin"` (candidate is already a string,
 * thanks to the `[]` existential expansion) and a hypothetical
 * `roles contains "admin"` with no `[]` (candidate is the whole array).
 */
function compareOne(candidate: unknown, op: Op, target: FilterValue): boolean {
  switch (op) {
    case "=":
      return valuesEqual(candidate, target)
    case "!=":
      return !valuesEqual(candidate, target)
    case "contains":
      if (typeof candidate === "string" && typeof target === "string") {
        return candidate.toLowerCase().includes(target.toLowerCase())
      }
      if (Array.isArray(candidate)) {
        return candidate.some((element) => valuesEqual(element, target))
      }
      return false
    case ">":
    case "<":
    case ">=":
    case "<=":
      if (typeof candidate !== "number" || typeof target !== "number") return false
      if (op === ">") return candidate > target
      if (op === "<") return candidate < target
      if (op === ">=") return candidate >= target
      return candidate <= target
    case "~=":
      if (typeof candidate !== "string" || typeof target !== "string") return false
      try {
        return new RegExp(target).test(candidate)
      } catch {
        return false
      }
  }
}

/** True if any value the path resolves to (existentially, over any `[]` segments) satisfies the predicate. */
export function evaluateFilter(parsed: ParsedFilter, value: unknown): boolean {
  const candidates = resolvePath(value, parsed.path, 0)
  return candidates.some((candidate) => compareOne(candidate, parsed.op, parsed.value))
}
