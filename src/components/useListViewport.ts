import type { BoxRenderable } from "@opentui/core"
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Pure: given the current viewport start, the index that must stay visible, the number of rows
 * that fit, and how many items exist in total, returns the (possibly adjusted) viewport start.
 * Scrolls just far enough to bring `index` into view (never re-centers), then clamps to the
 * valid `[0, itemCount - rowCount]` range — covers both a selection moving past either edge and
 * the list itself shrinking out from under an existing viewport (e.g. a search narrows it).
 */
export function computeViewportStart(current: number, index: number, rowCount: number, itemCount: number): number {
  let next = current
  if (index < next) next = index
  else if (index > next + rowCount - 1) next = index - rowCount + 1
  const maxStart = Math.max(0, itemCount - rowCount)
  return Math.max(0, Math.min(next, maxStart))
}

/**
 * Index-based counterpart to `ConsumeTab`'s manual `viewportStartSeq` windowing — that one is
 * seq/ring-buffer-specific (messages can be evicted from underneath a viewport); this is the
 * plain "N items, some fit on screen, keep the selected one visible" version shared by
 * `TopicsTab`/`GroupsTab`. Deliberately not OpenTUI's `<scrollbox>` — that free-scrolls
 * independently of any selection, whereas these lists need the viewport to follow arrow-key
 * selection instead.
 */
export function useListViewport(itemCount: number) {
  const boxRef = useRef<BoxRenderable>(null)
  const [rowCount, setRowCount] = useState(1)
  const [viewportStart, setViewportStart] = useState(0)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => setRowCount(Math.max(1, box.height))
    measure()
    box.onSizeChange = measure
    return () => {
      box.onSizeChange = undefined
    }
  }, [])

  // Re-clamp whenever the list or the available height changes (e.g. a search narrows the
  // results out from under the current scroll position).
  useEffect(() => {
    setViewportStart((v) => Math.max(0, Math.min(v, Math.max(0, itemCount - rowCount))))
  }, [itemCount, rowCount])

  const scrollToIndex = useCallback(
    (index: number) => {
      setViewportStart((v) => computeViewportStart(v, index, rowCount, itemCount))
    },
    [rowCount, itemCount],
  )

  return { boxRef, rowCount, viewportStart, scrollToIndex }
}
