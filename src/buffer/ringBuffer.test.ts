import { describe, expect, test } from "bun:test"
import { RingBuffer } from "./ringBuffer"

describe("RingBuffer", () => {
  test("starts empty", () => {
    const buf = new RingBuffer<string>(3)
    expect(buf.size).toBe(0)
    expect(buf.newestSeq).toBe(-1)
    expect(buf.getBySeq(0)).toBeUndefined()
  })

  test("assigns monotonic seq and retrieves by seq before wrapping", () => {
    const buf = new RingBuffer<string>(5)
    const a = buf.push("a")
    const b = buf.push("b")
    expect(a.seq).toBe(0)
    expect(b.seq).toBe(1)
    expect(buf.size).toBe(2)
    expect(buf.oldestSeq).toBe(0)
    expect(buf.newestSeq).toBe(1)
    expect(buf.getBySeq(0)?.value).toBe("a")
    expect(buf.getBySeq(1)?.value).toBe("b")
  })

  test("evicts the oldest entry once capacity is exceeded", () => {
    const buf = new RingBuffer<number>(3)
    buf.push(0)
    buf.push(1)
    buf.push(2)
    buf.push(3) // evicts seq 0
    expect(buf.size).toBe(3)
    expect(buf.oldestSeq).toBe(1)
    expect(buf.newestSeq).toBe(3)
    expect(buf.getBySeq(0)).toBeUndefined()
    expect(buf.getBySeq(1)?.value).toBe(1)
    expect(buf.getBySeq(3)?.value).toBe(3)
  })

  test("a seq number is never reused for a different value after wrapping", () => {
    // Regression case for the classic circular-buffer bug: slot index seq % capacity
    // gets reused, but getBySeq must not return the stale occupant of that slot.
    const buf = new RingBuffer<string>(2)
    buf.push("a") // seq 0 -> slot 0
    buf.push("b") // seq 1 -> slot 1
    buf.push("c") // seq 2 -> slot 0, evicts "a"
    expect(buf.getBySeq(0)).toBeUndefined()
    expect(buf.getBySeq(2)?.value).toBe("c")
  })

  test("getRange clamps to the retained window", () => {
    const buf = new RingBuffer<number>(3)
    for (let i = 0; i < 5; i++) buf.push(i) // retains seq 2,3,4
    const range = buf.getRange(0, 10)
    expect(range.map((s) => s.seq)).toEqual([2, 3, 4])
  })

  test("getRange returns [] for a window entirely before the retained range (the self-heal case)", () => {
    const buf = new RingBuffer<number>(3)
    for (let i = 0; i < 10; i++) buf.push(i) // retains seq 7,8,9
    // Simulates a paused viewport that fell behind oldestSeq while the buffer kept filling.
    expect(buf.getRange(0, 2)).toEqual([])
  })

  test("clear() resets size and seq numbering without changing capacity", () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    buf.clear()
    expect(buf.size).toBe(0)
    expect(buf.getCapacity()).toBe(3)
    const next = buf.push(99)
    expect(next.seq).toBe(0)
  })
})
