import { AssignerProtocol, Kafka } from "kafkajs"
import type { MemberDescription } from "kafkajs"
import { describe, expect, test } from "bun:test"
import { computeGroupSnapshot, fetchGroupSnapshots, isEphemeralGroup, listRealGroupIds } from "./groups"

describe("isEphemeralGroup", () => {
  test("matches this tool's own throwaway group ID shape", () => {
    expect(isEphemeralGroup("kafka-tui-9a37e4-32448")).toBe(true)
  })

  test("does not match a real group ID", () => {
    expect(isEphemeralGroup("my-app-consumers")).toBe(false)
    expect(isEphemeralGroup("kafka-tuiapp")).toBe(false) // similar but missing the "-" separator
    expect(isEphemeralGroup("my-kafka-tui-app")).toBe(false) // contains the prefix, but not at the start
  })
})

function fakeMember(clientId: string, host: string, assignment: Record<string, number[]>): MemberDescription {
  return {
    memberId: `${clientId}-member`,
    clientId,
    clientHost: host,
    memberAssignment: AssignerProtocol.MemberAssignment.encode({
      version: 1,
      assignment,
      userData: Buffer.alloc(0),
    }),
    memberMetadata: Buffer.alloc(0),
  }
}

describe("computeGroupSnapshot", () => {
  test("computes lag as logEndOffset - currentOffset per partition, and sums for the total", () => {
    const snapshot = computeGroupSnapshot(
      "my-group",
      "Stable",
      [],
      [{ topic: "orders.json", partitions: [{ partition: 0, offset: "100", metadata: null }] }],
      new Map([["orders.json", new Map([[0, 150]])]]),
    )
    expect(snapshot.partitionLags).toEqual([
      { topic: "orders.json", partition: 0, currentOffset: 100, logEndOffset: 150, lag: 50 },
    ])
    expect(snapshot.totalLag).toBe(50)
  })

  test("sums lag across multiple partitions and topics", () => {
    const snapshot = computeGroupSnapshot(
      "my-group",
      "Stable",
      [],
      [
        {
          topic: "orders.json",
          partitions: [
            { partition: 0, offset: "100", metadata: null },
            { partition: 1, offset: "200", metadata: null },
          ],
        },
        { topic: "logs.text", partitions: [{ partition: 0, offset: "10", metadata: null }] },
      ],
      new Map([
        [
          "orders.json",
          new Map([
            [0, 150],
            [1, 210],
          ]),
        ],
        ["logs.text", new Map([[0, 10]])],
      ]),
    )
    expect(snapshot.totalLag).toBe(50 + 10 + 0)
  })

  test("a partition with no committed offset (-1) reports null, not a wrong number", () => {
    const snapshot = computeGroupSnapshot(
      "my-group",
      "Stable",
      [],
      [{ topic: "orders.json", partitions: [{ partition: 0, offset: "-1", metadata: null }] }],
      new Map([["orders.json", new Map([[0, 500]])]]),
    )
    expect(snapshot.partitionLags[0]?.currentOffset).toBeNull()
    expect(snapshot.partitionLags[0]?.lag).toBeNull()
    expect(snapshot.totalLag).toBe(0) // null lag contributes 0, not NaN
  })

  test("lag never goes negative even if the committed offset is somehow ahead of the high-water mark", () => {
    const snapshot = computeGroupSnapshot(
      "my-group",
      "Stable",
      [],
      [{ topic: "orders.json", partitions: [{ partition: 0, offset: "500", metadata: null }] }],
      new Map([["orders.json", new Map([[0, 100]])]]), // stale/racy high-water mark below committed offset
    )
    expect(snapshot.partitionLags[0]?.lag).toBe(0)
  })

  test("missing high-water mark data defaults to 0 rather than throwing", () => {
    const snapshot = computeGroupSnapshot(
      "my-group",
      "Stable",
      [],
      [{ topic: "orders.json", partitions: [{ partition: 0, offset: "10", metadata: null }] }],
      new Map(), // no entry for orders.json at all
    )
    expect(snapshot.partitionLags[0]?.logEndOffset).toBe(0)
  })

  test("decodes real member assignments via AssignerProtocol's own encode/decode round-trip", () => {
    const member = fakeMember("my-app-1", "10.0.0.5", { "orders.json": [0, 1] })
    const snapshot = computeGroupSnapshot("my-group", "Stable", [member], [], new Map())
    expect(snapshot.members).toEqual([
      {
        memberId: "my-app-1-member",
        clientId: "my-app-1",
        host: "10.0.0.5",
        assignment: [{ topic: "orders.json", partitions: [0, 1] }],
      },
    ])
  })

  test("a garbage memberAssignment buffer decodes to an empty assignment instead of throwing", () => {
    const member: MemberDescription = {
      memberId: "bad-member",
      clientId: "bad-client",
      clientHost: "0.0.0.0",
      memberAssignment: Buffer.from([0xff, 0xff, 0xff]),
      memberMetadata: Buffer.alloc(0),
    }
    const snapshot = computeGroupSnapshot("my-group", "Stable", [member], [], new Map())
    expect(snapshot.members[0]?.assignment).toEqual([])
  })
})

// `describe.skipIf`'s condition is evaluated synchronously at collection time — before any
// `beforeAll` hook would get a chance to run — so the reachability probe has to be a
// top-level await, same pattern as avro.test.ts.
const BROKER = "localhost:9092"
let brokerAvailable = false
try {
  const probe = new Kafka({ clientId: "groups-test-probe", brokers: [BROKER], logLevel: 1 })
  const admin = probe.admin()
  await admin.connect()
  await admin.disconnect()
  brokerAvailable = true
} catch {
  brokerAvailable = false
}
if (!brokerAvailable) {
  console.warn(
    `\ngroups.test.ts: broker not reachable at ${BROKER} — skipping the live suite. ` +
      `Run \`docker compose -f docker/docker-compose.yml up -d\` to enable it.\n`,
  )
}

describe.skipIf(!brokerAvailable)("fetchGroupSnapshots (against the real local broker)", () => {
  test("a real, throwaway consumer group is discoverable and reports sensible lag", async () => {
    const kafka = new Kafka({ clientId: "groups-test", brokers: [BROKER], logLevel: 1 })
    const admin = kafka.admin()
    await admin.connect()

    const groupId = `phase7-test-group-${crypto.randomUUID()}`
    const consumer = kafka.consumer({ groupId })
    await consumer.connect()
    await consumer.subscribe({ topic: "orders.json", fromBeginning: true })

    let committed = false
    await new Promise<void>((resolve) => {
      consumer
        .run({
          autoCommit: true,
          autoCommitInterval: 200,
          eachMessage: async () => {
            committed = true
          },
        })
        .catch(() => {})
      const timeout = setTimeout(resolve, 8000)
      const check = setInterval(() => {
        if (committed) {
          clearTimeout(timeout)
          clearInterval(check)
          setTimeout(resolve, 500) // let the auto-commit interval actually fire
        }
      }, 100)
    })

    try {
      const groupIds = await listRealGroupIds(admin)
      expect(groupIds).toContain(groupId)
      expect(groupIds.some(isEphemeralGroup)).toBe(false)

      const snapshots = await fetchGroupSnapshots(admin, [groupId])
      const snapshot = snapshots.get(groupId)
      expect(snapshot).toBeDefined()
      expect(snapshot?.state).toBe("Stable")
      expect(snapshot?.members.length).toBeGreaterThan(0)
      expect(snapshot?.members[0]?.clientId).toBe("groups-test")
      expect(snapshot?.partitionLags.length).toBeGreaterThan(0)
      // Every lag value must be a non-negative number, never null (a real commit happened) or NaN.
      for (const p of snapshot?.partitionLags ?? []) {
        if (p.currentOffset !== null) {
          expect(p.lag).toBeGreaterThanOrEqual(0)
        }
      }
    } finally {
      await consumer.disconnect()
      // This test creates a real (non-ephemeral) group, unlike ConsumeTab's own throwaway
      // `kafka-tui-*` groups — those aren't specially expired by Kafka either, so leaving this
      // one behind would accumulate exactly the kind of stale-group clutter (and false "stuck"
      // badges once nothing is consuming it anymore) this phase's own dev-loop testing hit.
      // A delete immediately after disconnect() can transiently fail — confirmed empirically —
      // before the coordinator finishes processing the LeaveGroup, so retry once after a beat.
      const deleted = await admin
        .deleteGroups([groupId])
        .then(() => true)
        .catch(() => false)
      if (!deleted) {
        await new Promise((r) => setTimeout(r, 1000))
        await admin.deleteGroups([groupId]).catch(() => {})
      }
      await admin.disconnect()
    }
  }, 20000)
})
