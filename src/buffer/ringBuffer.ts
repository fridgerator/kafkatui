/**
 * Fixed-capacity circular buffer with a monotonically increasing sequence
 * number per entry (spec §6.3: "ring buffer of the last N raw messages").
 *
 * Callers (viewport/selection state) anchor to `seq`, never to array
 * position — a slot's array index changes meaning every time the buffer
 * wraps, but a `seq` always refers to the same logical entry for as long as
 * it's retained. This is what keeps scroll position and selection stable
 * while new messages evict old ones out from under a paused view.
 */

export interface RingBufferSlot<T> {
  seq: number
  value: T
}

export class RingBuffer<T> {
  private readonly capacity: number
  private slots: (RingBufferSlot<T> | undefined)[]
  private nextSeq = 0
  private latestSeq = -1

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("RingBuffer capacity must be positive")
    this.capacity = capacity
    this.slots = new Array(capacity)
  }

  getCapacity(): number {
    return this.capacity
  }

  /** -1 when empty. */
  get newestSeq(): number {
    return this.latestSeq
  }

  /** Only meaningful when non-empty; callers should check `size > 0` first. */
  get oldestSeq(): number {
    if (this.latestSeq < 0) return 0
    return Math.max(0, this.latestSeq - this.capacity + 1)
  }

  get size(): number {
    if (this.latestSeq < 0) return 0
    return this.latestSeq - this.oldestSeq + 1
  }

  push(value: T): RingBufferSlot<T> {
    const seq = this.nextSeq++
    const slot: RingBufferSlot<T> = { seq, value }
    this.slots[seq % this.capacity] = slot
    this.latestSeq = seq
    return slot
  }

  getBySeq(seq: number): RingBufferSlot<T> | undefined {
    if (this.latestSeq < 0 || seq < this.oldestSeq || seq > this.latestSeq) return undefined
    return this.slots[seq % this.capacity]
  }

  /** Inclusive range, silently clamped to what's actually still retained. */
  getRange(startSeq: number, endSeq: number): RingBufferSlot<T>[] {
    if (this.latestSeq < 0 || endSeq < startSeq) return []
    const from = Math.max(startSeq, this.oldestSeq)
    const to = Math.min(endSeq, this.latestSeq)
    const result: RingBufferSlot<T>[] = []
    for (let seq = from; seq <= to; seq++) {
      const slot = this.slots[seq % this.capacity]
      if (slot) result.push(slot)
    }
    return result
  }

  /** Drops all entries without resetting capacity (spec §6.3: "clear the buffer without disconnecting"). */
  clear(): void {
    this.slots = new Array(this.capacity)
    this.nextSeq = 0
    this.latestSeq = -1
  }
}
