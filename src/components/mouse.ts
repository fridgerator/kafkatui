import type { MouseEvent } from "@opentui/core"

/**
 * Shared mouse-interaction helpers. opentui enables the mouse by default and forwards
 * `on*` props straight to the renderable, so components only need to attach handlers —
 * these keep the click/scroll semantics consistent across the list views.
 */

/**
 * Row-click semantics (spec: "click selects; click the selected row to open"): clicking a
 * row that is already selected means "open its detail view", any other row means "select it".
 */
export function rowClickAction<T>(clickedId: T, selectedId: T | null): "open" | "select" {
  return clickedId === selectedId ? "open" : "select"
}

/**
 * How many rows one wheel notch should move the selection by — negative for up, positive
 * for down, 0 for a non-scroll event. The list viewports follow the selection rather than
 * scrolling independently, so the wheel drives the same code path as the arrow keys, just
 * a few rows at a time.
 */
export function wheelSteps(e: MouseEvent, step = 3): number {
  const dir = e.scroll?.direction
  if (dir === "up") return -step
  if (dir === "down") return step
  return 0
}
