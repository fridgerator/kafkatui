import { Kafka } from "kafkajs"
import { describe, expect, test } from "bun:test"
import {
  fetchTopicDetail,
  fetchTopicOverviews,
  isInternalTopic,
  isUnderReplicated,
  sortConfigs,
  type TopicConfigEntry,
} from "./topics"

describe("isInternalTopic", () => {
  test("matches Kafka's own double-underscore internal topics", () => {
    expect(isInternalTopic("__consumer_offsets")).toBe(true)
    expect(isInternalTopic("__transaction_state")).toBe(true)
  })

  test("matches Confluent Schema Registry's specific internal topic", () => {
    expect(isInternalTopic("_schemas")).toBe(true)
  })

  test("does not match a real user topic, even one starting with a single underscore", () => {
    expect(isInternalTopic("orders.json")).toBe(false)
    expect(isInternalTopic("_my_custom_topic")).toBe(false) // single underscore, not the specific "_schemas" name
  })
})

describe("isUnderReplicated", () => {
  test("false when every replica is in sync", () => {
    expect(isUnderReplicated({ isr: [1, 2, 3], replicas: [1, 2, 3] })).toBe(false)
  })

  test("true when fewer replicas are in sync than assigned", () => {
    expect(isUnderReplicated({ isr: [1], replicas: [1, 2, 3] })).toBe(true)
  })

  test("a single-replica (replication factor 1) partition is never under-replicated by itself", () => {
    expect(isUnderReplicated({ isr: [1], replicas: [1] })).toBe(false)
  })
})

describe("sortConfigs", () => {
  function entry(name: string, isDefault: boolean): TopicConfigEntry {
    return { name, value: "x", isDefault }
  }

  test("non-default entries sort before default ones", () => {
    const sorted = sortConfigs([entry("z-default", true), entry("a-nondefault", false)])
    expect(sorted.map((e) => e.name)).toEqual(["a-nondefault", "z-default"])
  })

  test("alphabetical within each group", () => {
    const sorted = sortConfigs([
      entry("zzz", false),
      entry("aaa", false),
      entry("mmm", true),
      entry("bbb", true),
    ])
    expect(sorted.map((e) => e.name)).toEqual(["aaa", "zzz", "bbb", "mmm"])
  })

  test("does not mutate the input array", () => {
    const input = [entry("b", true), entry("a", false)]
    const originalOrder = input.map((e) => e.name)
    sortConfigs(input)
    expect(input.map((e) => e.name)).toEqual(originalOrder)
  })
})

// `describe.skipIf`'s condition is evaluated synchronously at collection time — before any
// `beforeAll` hook would get a chance to run — so the reachability probe has to be a
// top-level await, same pattern as avro.test.ts/groups.test.ts.
const BROKER = "localhost:9092"
let brokerAvailable = false
try {
  const probe = new Kafka({ clientId: "topics-test-probe", brokers: [BROKER], logLevel: 1 })
  const admin = probe.admin()
  await admin.connect()
  await admin.disconnect()
  brokerAvailable = true
} catch {
  brokerAvailable = false
}
if (!brokerAvailable) {
  console.warn(
    `\ntopics.test.ts: broker not reachable at ${BROKER} — skipping the live suite. ` +
      `Run \`docker compose -f docker/docker-compose.yml up -d\` to enable it.\n`,
  )
}

describe.skipIf(!brokerAvailable)("topics.ts (against the real local broker)", () => {
  const kafka = new Kafka({ clientId: "topics-test", brokers: [BROKER], logLevel: 1 })

  test("fetchTopicOverviews lists the real topics with correct partition count, filtering out internal ones", async () => {
    const admin = kafka.admin()
    await admin.connect()
    try {
      const overviews = await fetchTopicOverviews(admin)
      const byName = new Map(overviews.map((o) => [o.name, o]))

      expect(byName.get("orders.json")?.partitionCount).toBe(4)
      expect(byName.get("orders.avro")?.partitionCount).toBe(4)
      expect(byName.get("logs.text")?.partitionCount).toBe(4)
      expect(byName.get("orders.json")?.replicationFactor).toBe(1) // single-broker local stack

      expect(overviews.some((o) => isInternalTopic(o.name))).toBe(false)
      expect(byName.has("__consumer_offsets")).toBe(false)
    } finally {
      await admin.disconnect()
    }
  }, 15000)

  test("fetchTopicDetail returns real partition metadata, offsets, and a non-empty config list", async () => {
    const admin = kafka.admin()
    await admin.connect()
    try {
      const detail = await fetchTopicDetail(admin, "orders.json")
      expect(detail).not.toBeNull()
      expect(detail?.name).toBe("orders.json")
      expect(detail?.partitions.length).toBe(4)

      for (const p of detail?.partitions ?? []) {
        expect(p.replicas.length).toBeGreaterThan(0)
        expect(p.latestOffset).toBeGreaterThanOrEqual(p.earliestOffset)
        expect(p.messageCount).toBe(p.latestOffset - p.earliestOffset)
        expect(p.underReplicated).toBe(false) // single, healthy broker
      }

      expect(detail?.configs.length).toBeGreaterThan(10) // confirmed live: ~33 real entries
      const minIsr = detail?.configs.find((c) => c.name === "min.insync.replicas")
      expect(minIsr).toBeDefined()
      // Confirmed live during research: this is a real, non-default value on this stack.
      expect(minIsr?.isDefault).toBe(false)
      // Non-default entries must sort first.
      const firstDefaultIndex = detail?.configs.findIndex((c) => c.isDefault) ?? -1
      const lastNonDefaultIndex = (detail?.configs.length ?? 0) - 1 - [...(detail?.configs ?? [])].reverse().findIndex((c) => !c.isDefault)
      expect(lastNonDefaultIndex).toBeLessThan(firstDefaultIndex === -1 ? Infinity : firstDefaultIndex)
    } finally {
      await admin.disconnect()
    }
  }, 15000)

  test("fetchTopicDetail returns null (never throws) for a topic that doesn't exist", async () => {
    const admin = kafka.admin()
    await admin.connect()
    try {
      const detail = await fetchTopicDetail(admin, "this-topic-does-not-exist-12345")
      expect(detail).toBeNull()
    } finally {
      await admin.disconnect()
    }
  }, 15000)
})
