import { expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { JsonTreeView } from "./JsonTreeView"

/**
 * Integration coverage for what the pure tests can't show: a few-hundred-KB
 * payload renders promptly (no multi-second layout stall), and fold + search
 * work against a real renderer. Input is wrapped in `act()` so the reconciler
 * flushes the resulting state updates before `captureCharFrame()`.
 */
test("renders a large payload promptly, folds large nodes, and searches keys/values", async () => {
  const big = {
    orderId: "abc-123",
    customer: { address: { zip: "98101", city: "Seattle" } },
    lineItems: Array.from({ length: 2000 }, (_, i) => ({ sku: `SKU-${i}`, qty: i, lot: `lot-${i}` })),
  }

  const started = performance.now()
  const h = await testRender(<JsonTreeView value={big} onSearchingChange={() => {}} />, {
    width: 100,
    height: 30,
  })
  await h.flush()
  const elapsedMs = performance.now() - started

  // The old tokenizer took several seconds on a payload this size; the tree only
  // ever builds ~30 visible rows. Generous ceiling — a stall check, not a benchmark.
  expect(elapsedMs).toBeLessThan(1500)

  const frame = h.captureCharFrame()
  expect(frame).toContain("orderId")
  expect(frame).toMatch(/lineItems:\s*\[…2000\]/) // 2000 children → auto-collapsed
  expect(frame).toContain("Seattle") // small nested object stays expanded

  // Search jumps to a value match and reports the count.
  await act(async () => {
    h.mockInput.pressKey("/")
  })
  await act(async () => {
    await h.mockInput.typeText("98101")
    h.mockInput.pressEnter()
  })
  await h.flush()

  const searched = h.captureCharFrame()
  expect(searched).toContain('zip: "98101"')
  expect(searched).toMatch(/match 1\/1/)
})

test("n cycles between matches even when they're already visible", async () => {
  const value = { alpha: { tag: "red" }, beta: { tag: "red" }, gamma: { note: "green" } }
  const h = await testRender(<JsonTreeView value={value} onSearchingChange={() => {}} />, {
    width: 80,
    height: 20,
  })
  await h.flush()

  await act(async () => {
    h.mockInput.pressKey("/")
  })
  await act(async () => {
    await h.mockInput.typeText("red")
    h.mockInput.pressEnter()
  })
  await h.flush()
  expect(h.captureCharFrame()).toMatch(/match 1\/2/)

  await act(async () => {
    h.mockInput.pressKey("n")
  })
  await h.flush()
  expect(h.captureCharFrame()).toMatch(/match 2\/2/)

  await act(async () => {
    h.mockInput.pressKey("n")
  })
  await h.flush()
  expect(h.captureCharFrame()).toMatch(/match 1\/2/) // wrapped around
})

test("expands a collapsed node with the right-arrow key", async () => {
  const value = { items: Array.from({ length: 100 }, (_, i) => `item-${i}`) }
  const h = await testRender(<JsonTreeView value={value} onSearchingChange={() => {}} />, {
    width: 80,
    height: 20,
  })
  await h.flush()
  expect(h.captureCharFrame()).toMatch(/items:\s*\[…100\]/)

  // Selection starts on the root; ↓ to "items", → to expand it.
  await act(async () => {
    h.mockInput.pressArrow("down")
  })
  await act(async () => {
    h.mockInput.pressArrow("right")
  })
  await h.flush()

  const frame = h.captureCharFrame()
  expect(frame).toContain('"item-0"')
  expect(frame).not.toMatch(/\[…100\]/)
})
