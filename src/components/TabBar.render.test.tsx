import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { TabBar } from "./TabBar"
import type { TabId } from "./TabBar"

/**
 * Mouse coverage: the tab strip is a plain box row, so clicking a tab must call `onSelect`
 * with that tab's id. The first tab (`[1] Consume`) sits at the very left edge, so x=1 is a
 * stable hit regardless of the later tabs' widths.
 */
test("clicking a tab calls onSelect with its id", async () => {
  const calls: TabId[] = []
  const h = await testRender(<TabBar activeTab="topics" onSelect={(id) => calls.push(id)} />, {
    width: 80,
    height: 3,
  })
  await h.flush()

  await act(async () => {
    await h.mockMouse.click(1, 0)
  })
  await h.flush()

  expect(calls).toEqual(["consume"])
})
