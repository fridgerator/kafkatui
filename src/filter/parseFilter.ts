/**
 * Parser for the `@filter:` query language (spec §6.4). Handles exactly one
 * predicate — AND/OR chaining is deferred per the spec's own permission to
 * treat it as v1.1 if it adds too much complexity.
 *
 *   my.nested[].key = "my little pony"
 *   user.roles[] contains "admin"
 *   metadata.retryCount > 3
 */

export interface PathSegment {
  key: string
  /** True when this segment was written as `key[]` — existential over the array's elements. */
  isArray: boolean
}

export type Op = "=" | "!=" | "contains" | ">" | "<" | ">=" | "<=" | "~="

export type FilterValue = string | number | boolean | null

export interface ParsedFilter {
  path: PathSegment[]
  op: Op
  value: FilterValue
}

export class FilterParseError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message)
  }
}

type Token =
  | { type: "ident"; value: string; pos: number }
  | { type: "dot"; pos: number }
  | { type: "lbracket"; pos: number }
  | { type: "rbracket"; pos: number }
  | { type: "op"; value: Op; pos: number }
  | { type: "string"; value: string; pos: number }
  | { type: "number"; value: number; pos: number }
  | { type: "bool"; value: boolean; pos: number }
  | { type: "null"; pos: number }
  | { type: "eof"; pos: number }

const IDENT_START = /[A-Za-z_]/
const IDENT_CONT = /[A-Za-z0-9_]/
const DIGIT = /[0-9]/
const WHITESPACE = /\s/

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  const len = input.length
  let i = 0

  while (i < len && WHITESPACE.test(input[i] as string)) i++

  while (i < len) {
    const ch = input[i] as string

    if (ch === ".") {
      tokens.push({ type: "dot", pos: i })
      i++
    } else if (ch === "[") {
      tokens.push({ type: "lbracket", pos: i })
      i++
    } else if (ch === "]") {
      tokens.push({ type: "rbracket", pos: i })
      i++
    } else if (ch === '"') {
      const start = i
      i++
      let value = ""
      while (i < len && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < len && (input[i + 1] === '"' || input[i + 1] === "\\")) {
          value += input[i + 1]
          i += 2
        } else {
          value += input[i]
          i++
        }
      }
      if (i >= len) throw new FilterParseError("Unterminated string", start)
      i++ // closing quote
      tokens.push({ type: "string", value, pos: start })
    } else if (DIGIT.test(ch) || (ch === "-" && DIGIT.test(input[i + 1] ?? ""))) {
      const result = readNumberToken(input, i)
      tokens.push(result.token)
      i = result.end
    } else if (input.slice(i, i + 2) === ">=" || input.slice(i, i + 2) === "<=" || input.slice(i, i + 2) === "!=" || input.slice(i, i + 2) === "~=") {
      tokens.push({ type: "op", value: input.slice(i, i + 2) as Op, pos: i })
      i += 2
    } else if (ch === "=" || ch === ">" || ch === "<") {
      tokens.push({ type: "op", value: ch as Op, pos: i })
      i++
    } else if (IDENT_START.test(ch)) {
      const start = i
      let j = i
      while (j < len && IDENT_CONT.test(input[j] as string)) j++
      const word = input.slice(start, j)
      i = j
      if (word === "true") tokens.push({ type: "bool", value: true, pos: start })
      else if (word === "false") tokens.push({ type: "bool", value: false, pos: start })
      else if (word === "null") tokens.push({ type: "null", pos: start })
      else if (word === "contains") tokens.push({ type: "op", value: "contains", pos: start })
      else tokens.push({ type: "ident", value: word, pos: start })
    } else if (WHITESPACE.test(ch)) {
      i++
    } else {
      throw new FilterParseError(`Unexpected character ${JSON.stringify(ch)}`, i)
    }

    while (i < len && WHITESPACE.test(input[i] as string)) i++
  }

  tokens.push({ type: "eof", pos: len })
  return tokens
}

function readNumberToken(input: string, start: number): { token: Token; end: number } {
  let j = start
  if (input[j] === "-") j++
  while (j < input.length && DIGIT.test(input[j] as string)) j++
  if (input[j] === "." && DIGIT.test(input[j + 1] ?? "")) {
    j++
    while (j < input.length && DIGIT.test(input[j] as string)) j++
  }
  const raw = input.slice(start, j)
  return { token: { type: "number", value: Number(raw), pos: start }, end: j }
}

function describeToken(tok: Token): string {
  switch (tok.type) {
    case "eof":
      return "end of input"
    case "ident":
      return `field name "${tok.value}"`
    case "string":
      return `string "${tok.value}"`
    case "number":
      return `number ${tok.value}`
    case "bool":
      return `boolean ${tok.value}`
    case "null":
      return "null"
    case "op":
      return `operator "${tok.value}"`
    case "dot":
      return "'.'"
    case "lbracket":
      return "'['"
    case "rbracket":
      return "']'"
  }
}

/** Parses one `@filter:` predicate (the text after the `@filter:` prefix, already trimmed or not). */
export function parseFilter(input: string): ParsedFilter {
  const tokens = tokenize(input)
  let pos = 0
  const peek = () => tokens[pos] as Token
  const advance = () => tokens[pos++] as Token

  const path: PathSegment[] = []
  const first = advance()
  if (first.type !== "ident") {
    throw new FilterParseError(`Expected a field name, got ${describeToken(first)}`, first.pos)
  }
  let currentKey = first.value

  for (;;) {
    let isArray = false
    if (peek().type === "lbracket") {
      advance()
      const closing = advance()
      if (closing.type !== "rbracket") {
        throw new FilterParseError("Expected ']' after '['", closing.pos)
      }
      isArray = true
    }
    path.push({ key: currentKey, isArray })

    if (peek().type === "dot") {
      advance()
      const ident = advance()
      if (ident.type !== "ident") {
        throw new FilterParseError(`Expected a field name after '.', got ${describeToken(ident)}`, ident.pos)
      }
      currentKey = ident.value
      continue
    }
    break
  }

  const opTok = advance()
  if (opTok.type !== "op") {
    throw new FilterParseError(
      `Expected an operator (=, !=, contains, >, <, >=, <=, ~=), got ${describeToken(opTok)}`,
      opTok.pos,
    )
  }

  const valueTok = advance()
  let value: FilterValue
  if (valueTok.type === "string") value = valueTok.value
  else if (valueTok.type === "number") value = valueTok.value
  else if (valueTok.type === "bool") value = valueTok.value
  else if (valueTok.type === "null") value = null
  else {
    throw new FilterParseError(
      `Expected a value (string, number, true/false, or null), got ${describeToken(valueTok)}`,
      valueTok.pos,
    )
  }

  const trailing = peek()
  if (trailing.type !== "eof") {
    throw new FilterParseError(
      `Unexpected input after the predicate at position ${trailing.pos} (AND/OR chaining isn't supported yet)`,
      trailing.pos,
    )
  }

  return { path, op: opTok.value, value }
}
