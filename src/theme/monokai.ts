/**
 * Monokai-inspired theme tokens (spec §7).
 *
 * This is the ONLY module in the project allowed to contain hex literals.
 * Components must reference semantic tokens (`theme.error`), never the raw
 * palette (`palette.pink`) and never a hex code, so the palette can be
 * retuned or a light variant added without touching component code.
 */

/** Raw Monokai palette. Not exported — components use the semantic tokens below. */
const palette = {
  black: "#1E1F1C",
  background: "#272822",
  backgroundAlt: "#2F302A",
  selection: "#49483E",
  comment: "#75715E",
  foreground: "#F8F8F2",
  pink: "#F92672",
  green: "#A6E22E",
  yellow: "#E6DB74",
  blue: "#66D9EF",
  orange: "#FD971F",
  purple: "#AE81FF",
} as const

export const theme = {
  // Surfaces
  bg: palette.background,
  bgPanel: palette.backgroundAlt,
  bgInset: palette.black,
  bgSelected: palette.selection,

  // Text
  fg: palette.foreground,
  fgDim: palette.comment,
  fgInverted: palette.background,

  // Semantic state
  accent: palette.pink,
  error: palette.pink,
  success: palette.green,
  warning: palette.yellow,
  info: palette.blue,

  // Syntax roles, used by the JSON pretty-printer and message list (phase 3+)
  synKey: palette.blue,
  synString: palette.yellow,
  synNumber: palette.orange,
  synBoolean: palette.purple,
  synNull: palette.comment,

  // Chrome
  border: palette.comment,
  borderFocused: palette.blue,

  statusBarBg: palette.black,
  statusBarFg: palette.foreground,

  tabActiveBg: palette.background,
  tabActiveFg: palette.blue,
  tabInactiveBg: palette.black,
  tabInactiveFg: palette.comment,

  hintBarBg: palette.black,
  hintBarFg: palette.comment,
  hintBarKey: palette.yellow,

  // Connection indicator (spec §5 status bar: green/red/yellow dot)
  connected: palette.green,
  connecting: palette.yellow,
  disconnected: palette.comment,
  failed: palette.pink,
} as const

export type Theme = typeof theme
