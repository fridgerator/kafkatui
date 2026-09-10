/**
 * Helpers for the string-padded "tables" the TUI renders (Groups, Topics, and their
 * detail panes). Every column is built by fitting a value into a fixed number of
 * terminal columns so cells line up on every row.
 *
 * `.length` is used as the column measure: all inputs are ASCII except the trailing
 * "…" we add, which is one column wide, so character count equals display width here.
 */

/**
 * Fit `str` into exactly `width` columns: truncate with a trailing "…" when it is too
 * long, otherwise pad the end with spaces. Guarantees `result.length === width`.
 */
export function fitCell(str: string, width: number): string {
  if (width <= 0) return ""
  if (str.length > width) return str.slice(0, width - 1) + "…"
  return str.padEnd(width)
}

/**
 * Right-aligned variant for numeric columns: when `str` is too long the *front* is
 * dropped and a leading "…" added. Guarantees `result.length === width`.
 */
export function fitCellRight(str: string, width: number): string {
  if (width <= 0) return ""
  if (str.length > width) return "…" + str.slice(str.length - (width - 1))
  return str.padStart(width)
}
