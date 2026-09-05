/**
 * Synthetic producer for the local dev stack (spec §9). Creates three topics,
 * one encoding each, and produces to all of them continuously:
 *
 *   orders.json  — nested JSON, matches the @filter: examples in spec §6.4
 *   orders.avro  — same shape, Confluent wire-format Avro
 *   logs.text    — plain text log lines
 *
 * Rate is env-driven with a periodic burst window, so phase 3's ring
 * buffer/throttle has something real to stress-test later.
 */
import { Kafka, logLevel, type Message } from "kafkajs"
import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry"
import { ORDER_AVRO_SCHEMA, randomCustomerId, randomLogLine, randomOrderEvent } from "./schema"

const TOPICS = {
  json: "orders.json",
  avro: "orders.avro",
  text: "logs.text",
} as const
const PARTITIONS_PER_TOPIC = 4

const brokers = (process.env.KAFKA_BROKERS ?? "localhost:9092").split(",")
const schemaRegistryUrl = process.env.SCHEMA_REGISTRY_URL ?? "http://localhost:8081"

const baseRate = Number(process.env.RATE_MSGS_PER_SEC ?? 5)
const burstEnabled = (process.env.BURST_ENABLED ?? "true") === "true"
const burstRate = Number(process.env.BURST_RATE_MSGS_PER_SEC ?? 200)
const burstIntervalMs = Number(process.env.BURST_INTERVAL_MS ?? 60_000)
const burstDurationMs = Number(process.env.BURST_DURATION_MS ?? 5_000)

const kafka = new Kafka({ clientId: "kafka-tui-synthetic-producer", brokers, logLevel: logLevel.WARN })
const producer = kafka.producer()
const admin = kafka.admin()
const registry = new SchemaRegistry({ host: schemaRegistryUrl })

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True if `now` falls inside a recurring burst window of `burstDurationMs` every `burstIntervalMs`. */
function inBurstWindow(now: number): boolean {
  if (!burstEnabled) return false
  return now % burstIntervalMs < burstDurationMs
}

function currentRate(now: number): number {
  return inBurstWindow(now) ? burstRate : baseRate
}

async function ensureTopics(): Promise<void> {
  await admin.createTopics({
    waitForLeaders: true,
    topics: Object.values(TOPICS).map((topic) => ({
      topic,
      numPartitions: PARTITIONS_PER_TOPIC,
      replicationFactor: 1,
    })),
  })
}

async function registerOrderSchema(): Promise<number> {
  const { id } = await registry.register(
    { type: SchemaType.AVRO, schema: JSON.stringify(ORDER_AVRO_SCHEMA) },
    { subject: `${TOPICS.avro}-value` },
  )
  return id
}

function traceHeaders(contentType: string): Record<string, string> {
  return { "content-type": contentType, "trace-id": crypto.randomUUID() }
}

async function produceOnce(avroSchemaId: number): Promise<void> {
  const customerId = randomCustomerId()
  const order = randomOrderEvent(customerId)

  const jsonMessage: Message = {
    key: customerId,
    value: JSON.stringify(order),
    headers: traceHeaders("application/json"),
  }
  const avroMessage: Message = {
    key: customerId,
    value: await registry.encode(avroSchemaId, order),
    headers: traceHeaders("application/avro"),
  }
  const textMessage: Message = {
    key: customerId,
    value: randomLogLine(),
    headers: traceHeaders("text/plain"),
  }

  await producer.sendBatch({
    topicMessages: [
      { topic: TOPICS.json, messages: [jsonMessage] },
      { topic: TOPICS.avro, messages: [avroMessage] },
      { topic: TOPICS.text, messages: [textMessage] },
    ],
  })
}

async function main(): Promise<void> {
  console.log(`[producer] connecting to ${brokers.join(",")}, schema registry ${schemaRegistryUrl}`)
  await admin.connect()
  await ensureTopics()
  const avroSchemaId = await registerOrderSchema()
  console.log(`[producer] topics ready, orders.avro schema id ${avroSchemaId}`)

  await producer.connect()

  let sentSinceLastLog = 0
  let lastLogAt = Date.now()
  let wasBursting = false

  // The summary window resets on every burst/base transition (rather than a
  // fixed interval) so a printed rate always describes one homogeneous
  // window — otherwise a line straddling a transition blends both rates and
  // reports something that matches neither its "burst" nor "base" label.
  const logSummary = (now: number, label: string) => {
    const elapsedSec = (now - lastLogAt) / 1000
    if (elapsedSec > 0) {
      console.log(`[producer] ~${(sentSinceLastLog / elapsedSec).toFixed(1)} msgs/sec/topic (${label})`)
    }
    sentSinceLastLog = 0
    lastLogAt = now
  }

  for (;;) {
    const now = Date.now()
    const bursting = inBurstWindow(now)
    if (bursting !== wasBursting) {
      logSummary(now, wasBursting ? "burst" : "base")
      console.log(bursting ? "[producer] burst window starting" : "[producer] burst window ended")
      wasBursting = bursting
    } else if (now - lastLogAt >= 5_000) {
      logSummary(now, bursting ? "burst" : "base")
    }

    await produceOnce(avroSchemaId)
    sentSinceLastLog += 1

    await sleep(1000 / currentRate(now))
  }
}

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[producer] received ${signal}, shutting down`)
  await Promise.allSettled([producer.disconnect(), admin.disconnect()])
  process.exit(0)
}
process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))

main().catch((err) => {
  console.error("[producer] fatal error", err)
  process.exit(1)
})
