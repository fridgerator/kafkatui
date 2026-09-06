/**
 * Pure. Parses the consumer config modal's "start from timestamp" field into epoch
 * milliseconds, or `null` if unparseable. Two accepted shapes:
 *
 *  - All digits: treated as epoch milliseconds directly (a power-user shortcut, and
 *    what `admin.fetchTopicOffsetsByTimestamp` wants anyway).
 *  - `YYYY-MM-DD` optionally followed by `[T ]HH:mm[:ss[.sss]]` and optionally a
 *    trailing `Z` or `±HH:MM`/`±HHMM` offset.
 *
 * The label on this field promises UTC, so an offset-less date-*time* is deliberately
 * interpreted as UTC via `Date.UTC` rather than delegating to bare `Date.parse` —
 * per spec, `Date.parse` treats an offset-less date-time as *local* time (only a
 * date-only string like "2026-09-06" is UTC by default), which would silently
 * contradict the label depending on the host machine's timezone. Once an explicit
 * offset or `Z` is present, native parsing is spec-guaranteed deterministic, so that
 * case delegates to it directly rather than reimplementing offset arithmetic.
 */
export function parseTimestampInput(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed)
    return Number.isSafeInteger(ms) && ms >= 0 ? ms : null
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/,
  )
  if (!match) return null
  const [, year, month, day, hour, minute, second, ms, offset] = match

  if (offset) {
    const millis = (ms ?? "0").padEnd(3, "0")
    const iso = `${year}-${month}-${day}T${hour ?? "00"}:${minute ?? "00"}:${second ?? "00"}.${millis}${offset}`
    const parsed = Date.parse(iso)
    return Number.isNaN(parsed) ? null : parsed
  }

  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? "0"),
    Number(minute ?? "0"),
    Number(second ?? "0"),
    Number((ms ?? "0").padEnd(3, "0")),
  )
  return Number.isNaN(utcMs) ? null : utcMs
}
