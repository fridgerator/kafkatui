import { AssignerProtocol } from "kafkajs"
import type { Admin, ConsumerGroupState, FetchOffsetsPartition, MemberDescription } from "kafkajs"

/**
 * Every ConsumeTab connection creates a throwaway `kafka-tui-<random>-<pid>`
 * group that never commits offsets (spec §6.1, phase 3's `consume.ts`).
 * `admin.listGroups()` can't distinguish these from real groups by
 * `protocolType` — both report `"consumer"` — so filtering is by ID prefix.
 */
const EPHEMERAL_GROUP_PREFIX = "kafka-tui-"

export function isEphemeralGroup(groupId: string): boolean {
  return groupId.startsWith(EPHEMERAL_GROUP_PREFIX)
}

export interface GroupMemberInfo {
  memberId: string
  clientId: string
  host: string
  assignment: { topic: string; partitions: number[] }[]
}

export interface PartitionLag {
  topic: string
  partition: number
  /** `null` when the group has never committed an offset for this partition — not the same as 0. */
  currentOffset: number | null
  logEndOffset: number
  /** `null` iff `currentOffset` is `null`; never negative otherwise. */
  lag: number | null
}

export interface GroupSnapshot {
  groupId: string
  state: ConsumerGroupState
  members: GroupMemberInfo[]
  partitionLags: PartitionLag[]
  totalLag: number
}

/** `MemberDescription.memberAssignment` is the raw consumer-protocol wire format, not a ready map. */
function decodeMemberAssignment(buffer: Buffer): { topic: string; partitions: number[] }[] {
  try {
    const decoded = AssignerProtocol.MemberAssignment.decode(buffer)
    if (!decoded) return []
    return Object.entries(decoded.assignment).map(([topic, partitions]) => ({ topic, partitions }))
  } catch {
    return []
  }
}

/**
 * Pure: takes already-fetched admin data and produces a snapshot. Never
 * throws — a malformed member assignment or missing high-water mark just
 * degrades that one field rather than failing the whole group.
 */
export function computeGroupSnapshot(
  groupId: string,
  state: ConsumerGroupState,
  members: MemberDescription[],
  offsetsByTopic: Array<{ topic: string; partitions: FetchOffsetsPartition[] }>,
  highWaterMarks: Map<string, Map<number, number>>,
): GroupSnapshot {
  const memberInfos: GroupMemberInfo[] = members.map((m) => ({
    memberId: m.memberId,
    clientId: m.clientId,
    host: m.clientHost,
    assignment: decodeMemberAssignment(m.memberAssignment),
  }))

  const partitionLags: PartitionLag[] = []
  for (const { topic, partitions } of offsetsByTopic) {
    for (const p of partitions) {
      const committed = Number(p.offset)
      const logEndOffset = highWaterMarks.get(topic)?.get(p.partition) ?? 0
      const currentOffset = committed >= 0 ? committed : null
      const lag = currentOffset === null ? null : Math.max(0, logEndOffset - currentOffset)
      partitionLags.push({ topic, partition: p.partition, currentOffset, logEndOffset, lag })
    }
  }

  const totalLag = partitionLags.reduce((sum, p) => sum + (p.lag ?? 0), 0)

  return { groupId, state, members: memberInfos, partitionLags, totalLag }
}

/** Real consumer groups only — ephemeral tool-internal groups filtered out (see `isEphemeralGroup`). */
export async function listRealGroupIds(admin: Admin): Promise<string[]> {
  try {
    const { groups } = await admin.listGroups()
    return groups.filter((g) => g.protocolType === "consumer" && !isEphemeralGroup(g.groupId)).map((g) => g.groupId)
  } catch {
    return []
  }
}

/**
 * The async I/O shell around `computeGroupSnapshot`: one batched
 * `describeGroups` for every group, one `fetchOffsets` per group and one
 * `fetchTopicOffsets` per unique topic across all groups (both
 * parallelized and de-duplicated), never throwing — a group that errors
 * mid-fetch is just missing from this poll tick's results, not a crash.
 */
export async function fetchGroupSnapshots(admin: Admin, groupIds: string[]): Promise<Map<string, GroupSnapshot>> {
  const results = new Map<string, GroupSnapshot>()
  if (groupIds.length === 0) return results

  let described: Awaited<ReturnType<Admin["describeGroups"]>>["groups"]
  try {
    described = (await admin.describeGroups(groupIds)).groups
  } catch {
    return results
  }

  const offsetsPerGroup = await Promise.all(
    groupIds.map(async (groupId) => {
      try {
        return { groupId, offsets: await admin.fetchOffsets({ groupId }) }
      } catch {
        return { groupId, offsets: [] as Array<{ topic: string; partitions: FetchOffsetsPartition[] }> }
      }
    }),
  )
  const offsetsByGroup = new Map(offsetsPerGroup.map((o) => [o.groupId, o.offsets]))

  const uniqueTopics = [...new Set(offsetsPerGroup.flatMap((o) => o.offsets.map((t) => t.topic)))]
  const highWaterMarks = new Map<string, Map<number, number>>()
  await Promise.all(
    uniqueTopics.map(async (topic) => {
      try {
        const offsets = await admin.fetchTopicOffsets(topic)
        highWaterMarks.set(topic, new Map(offsets.map((o) => [o.partition, Number(o.high)])))
      } catch {
        highWaterMarks.set(topic, new Map())
      }
    }),
  )

  for (const group of described) {
    try {
      const offsetsByTopic = offsetsByGroup.get(group.groupId) ?? []
      results.set(
        group.groupId,
        computeGroupSnapshot(group.groupId, group.state, group.members, offsetsByTopic, highWaterMarks),
      )
    } catch {
      // Skip this group's snapshot for this poll tick rather than failing the batch.
    }
  }

  return results
}
