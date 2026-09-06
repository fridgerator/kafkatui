import { theme } from "../theme/monokai"
import type { TabId } from "./TabBar"

export interface Hint {
  key: string
  label: string
}

/** Hints shown on every tab, appended after the tab-specific ones. */
const GLOBAL_HINTS: Hint[] = [
  { key: "1-4/⇥", label: "tab" },
  { key: "q", label: "quit" },
]

/**
 * Context-sensitive hints per tab (spec §7, k9s/lazygit convention).
 *
 * Phase 1 advertises only what actually works today plus the shape of what is
 * coming; keys listed here that are not yet wired are marked in the placeholder
 * panels rather than being silently dead.
 */
const TAB_HINTS: Record<TabId, Hint[]> = {
  consume: [
    { key: "t", label: "topic" },
    { key: "e", label: "latest/earliest" },
    { key: "↑↓", label: "scroll" },
    { key: "␣", label: "pause/resume" },
    { key: "c", label: "clear buffer" },
    { key: "/", label: "search" },
    { key: "@filter:", label: "query" },
    { key: "⏎", label: "inspect" },
    { key: "x", label: "export ndjson" },
    { key: "r", label: "raw view (in detail)" },
    { key: "y", label: "copy (in detail)" },
  ],
  groups: [
    { key: "↑↓", label: "select" },
    { key: "⏎", label: "details" },
    { key: "s", label: "sort by lag" },
    { key: "/", label: "search" },
  ],
  topics: [
    { key: "↑↓", label: "select" },
    { key: "⏎", label: "partitions & config" },
    { key: "/", label: "search" },
    { key: "r", label: "refresh" },
  ],
  produce: [
    { key: "↑↓", label: "field" },
    { key: "⏎", label: "edit / cycle" },
    { key: "esc", label: "cancel edit" },
    { key: "—", label: "send disabled (v1)" },
  ],
}

interface HintBarProps {
  activeTab: TabId
}

export function HintBar({ activeTab }: HintBarProps) {
  const hints = [...TAB_HINTS[activeTab], ...GLOBAL_HINTS]

  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        flexShrink: 0,
        backgroundColor: theme.hintBarBg,
        paddingLeft: 1,
        paddingRight: 1,
        gap: 2,
        // Without these, a terminal too narrow for every hint shrinks the hint
        // boxes toward zero width and they paint over each other. Keep them at
        // intrinsic width and clip the tail instead.
        overflow: "hidden",
      }}
    >
      {hints.map((hint) => (
        <box
          key={hint.key}
          style={{ flexDirection: "row", flexShrink: 0, backgroundColor: theme.hintBarBg }}
        >
          <text fg={theme.hintBarKey} bg={theme.hintBarBg}>
            {hint.key}
          </text>
          <text fg={theme.hintBarFg} bg={theme.hintBarBg}>
            {` ${hint.label}`}
          </text>
        </box>
      ))}
    </box>
  )
}
