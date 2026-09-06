import type { Kafka } from "kafkajs"
import type { ConnectionState, RawMessage } from "./types"

export type StartPosition = "earliest" | "latest" | { timestamp: number }

export interface StartConsumingOptions {
  kafka: Kafka
  topic: string
  startPosition: StartPosition
  onMessage: (message: RawMessage) => void
  onError: (error: Error) => void
  onStateChange: (state: ConnectionState) => void
}

export interface ConsumeHandle {
  stop: () => Promise<void>
}

function randomGroupId(): string {
  const random = Math.random().toString(16).slice(2, 8)
  return `kafka-tui-${random}-${process.pid}`
}

/**
 * Ephemeral, disposable tail: a throwaway consumer group that never commits
 * offsets (spec §6.1). kafkajs's public API has no groupless fetch primitive
 * — the raw Fetch protocol call is internal, not exported — so this is the
 * cleanest available approximation. The `kafka-tui-*` prefix lets the Groups
 * tab (phase 7) filter this out of its own listing rather than showing the
 * tool's own connections as if they were a real consumer group.
 */
export function startConsuming(options: StartConsumingOptions): ConsumeHandle {
  const { kafka, topic, startPosition, onMessage, onError, onStateChange } = options
  const consumer = kafka.consumer({ groupId: randomGroupId() })
  let stopped = false

  const fail = (error: Error) => {
    if (stopped) return
    onStateChange("failed")
    onError(error)
  }

  consumer.on(consumer.events.CRASH, ({ payload }) => fail(payload.error))

  // Seeking to a specific timestamp needs to know which partitions this consumer was actually
  // assigned, which isn't known until the group join completes — kafkajs's own documented
  // pattern for "start consuming from a specific point" is exactly this: listen for
  // `GROUP_JOIN`, then look up offsets and `seek()` before the fetch loop (registered by
  // `consumer.run()` right after group join settles) gets to them. Skips a partition entirely
  // when the returned offset is `"-1"` — Kafka's ListOffsets sentinel for "no message at or
  // after this timestamp exists yet in this partition" — leaving it at the subscribe-time
  // default (latest) is correct there, there's nothing to seek to.
  //
  // Verified against the real local broker (throwaway script, not committed) that this lands on
  // exactly the right message, not earliest/latest — but with a real, inherent latency: `run()`
  // resolving (which happens right after GROUP_JOIN) already dispatches a fetch at the
  // subscribe-time position before this handler's `await`s (admin connect + the offsets
  // round-trip) resolve, so `seek()` frequently arrives after that first fetch is already
  // in-flight. kafkajs/the broker only picks up the new position on the *next* fetch, which
  // for an otherwise-idle partition doesn't get dispatched until the first one's long-poll
  // (`maxWaitTimeInMs`, default 5s) times out. No wrong data is ever delivered in the meantime
  // (the stale-position fetch just legitimately finds nothing new and waits) — it's purely a
  // "connected" → first-message startup delay of up to ~5s specific to the timestamp option,
  // not a correctness issue.
  if (typeof startPosition === "object") {
    const { timestamp } = startPosition
    consumer.on(consumer.events.GROUP_JOIN, async ({ payload }) => {
      const assigned = new Set(payload.memberAssignment[topic] ?? [])
      if (assigned.size === 0) return
      const admin = kafka.admin()
      try {
        await admin.connect()
        const offsets = await admin.fetchTopicOffsetsByTimestamp(topic, timestamp)
        for (const { partition, offset } of offsets) {
          if (assigned.has(partition) && offset !== "-1") {
            consumer.seek({ topic, partition, offset })
          }
        }
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)))
      } finally {
        void admin.disconnect()
      }
    })
  }

  onStateChange("connecting")

  const run = async () => {
    try {
      await consumer.connect()
      if (stopped) return
      await consumer.subscribe({ topic, fromBeginning: startPosition === "earliest" })
      if (stopped) return
      onStateChange("connected")

      // `run()` resolves once the fetch loop is registered, not when it ends —
      // ongoing per-message/connection failures are caught by the CRASH
      // listener above instead of this try/catch.
      await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic: msgTopic, partition, message }) => {
          onMessage({
            topic: msgTopic,
            partition,
            offset: message.offset,
            key: message.key,
            value: message.value,
            headers: (message.headers ?? {}) as RawMessage["headers"],
            timestamp: message.timestamp,
            receivedAt: Date.now(),
          })
        },
      })
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)))
    }
  }

  void run()

  return {
    stop: async () => {
      stopped = true
      try {
        await consumer.disconnect()
      } catch {
        // Best-effort cleanup; nothing meaningful to do if disconnect itself fails.
      }
    },
  }
}
