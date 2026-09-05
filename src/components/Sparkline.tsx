/**
 * Unicode block sparkline (spec §7). First actually needed in phase 7 for
 * lag trend — earlier phases (Consume tab's throughput) deliberately used a
 * plain number instead of building this early.
 */
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/**
 * Pure and exported for direct testing. Scaled to the *window's own*
 * min/max, not a fixed 0-based scale — a flat history at any level should
 * render as a flat line at that level, not always collapse to the bottom
 * block the way a fixed scale would for a history that never touches 0.
 */
export function sparklineChars(values: number[]): string {
  if (values.length === 0) return ""

  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min

  return values
    .map((v) => {
      if (range === 0) return BLOCKS[Math.floor(BLOCKS.length / 2)]
      const level = Math.round(((v - min) / range) * (BLOCKS.length - 1))
      return BLOCKS[Math.max(0, Math.min(BLOCKS.length - 1, level))]
    })
    .join("")
}

interface SparklineProps {
  values: number[]
  fg?: string
}

export function Sparkline({ values, fg }: SparklineProps) {
  return <text fg={fg}>{sparklineChars(values)}</text>
}
