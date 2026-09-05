import type { Kafka } from "kafkajs"
import type { ConnectionState, RawMessage } from "./types"

export interface StartConsumingOptions {
  kafka: Kafka
  topic: string
  fromBeginning: boolean
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
  const { kafka, topic, fromBeginning, onMessage, onError, onStateChange } = options
  const consumer = kafka.consumer({ groupId: randomGroupId() })
  let stopped = false

  const fail = (error: Error) => {
    if (stopped) return
    onStateChange("failed")
    onError(error)
  }

  consumer.on(consumer.events.CRASH, ({ payload }) => fail(payload.error))

  onStateChange("connecting")

  const run = async () => {
    try {
      await consumer.connect()
      if (stopped) return
      await consumer.subscribe({ topic, fromBeginning })
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
