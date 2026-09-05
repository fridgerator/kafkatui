import { ConfigResourceTypes } from "kafkajs"
import type { Admin, PartitionMetadata } from "kafkajs"

/**
 * `__` is Kafka's own universal internal-topic convention (`__consumer_offsets`,
 * `__transaction_state`, etc.); `_schemas` is Confluent Schema Registry's specific,
 * well-known topic. A blanket `startsWith("_")` would risk hiding a real user topic
 * that happens to start with an underscore, so this is a named exclusion, not a rule.
 */
export function isInternalTopic(name: string): boolean {
  return name.startsWith("__") || name === "_schemas"
}

/** Spec §8 never explicitly lists this, but it's free on data the partition browser already fetches. */
export function isUnderReplicated(partition: Pick<PartitionMetadata, "isr" | "replicas">): boolean {
  return partition.isr.length < partition.replicas.length
}

export interface TopicOverview {
  name: string
  partitionCount: number
  replicationFactor: number
}

/** List-level: names + partition counts only, no config/offset detail — cheap, since the list doesn't need it. */
export async function fetchTopicOverviews(admin: Admin): Promise<TopicOverview[]> {
  try {
    const allTopics = await admin.listTopics()
    const topics = allTopics.filter((t) => !isInternalTopic(t))
    if (topics.length === 0) return []

    const { topics: metadata } = await admin.fetchTopicMetadata({ topics })
    return metadata.map((t) => ({
      name: t.name,
      partitionCount: t.partitions.length,
      // Assumes uniform replication across partitions, true for the overwhelming majority
      // of real topics — a topic-level overview isn't the place for a per-partition range.
      replicationFactor: t.partitions[0]?.replicas.length ?? 0,
    }))
  } catch {
    return []
  }
}

export interface PartitionInfo {
  partitionId: number
  leader: number
  replicas: number[]
  isr: number[]
  underReplicated: boolean
  earliestOffset: number
  latestOffset: number
  messageCount: number
}

export interface TopicConfigEntry {
  name: string
  value: string
  isDefault: boolean
}

export interface TopicDetail {
  name: string
  partitions: PartitionInfo[]
  configs: TopicConfigEntry[]
}

/** Non-default configs first (spec's "why is X different from Y" framing), then alphabetical within each group. */
export function sortConfigs(entries: TopicConfigEntry[]): TopicConfigEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Metadata + config + offsets for one topic, all real admin calls but returned
 * already shaped for direct rendering — never throws, `null` on any failure
 * (topic deleted between list and open, admin error, etc.).
 */
export async function fetchTopicDetail(admin: Admin, topic: string): Promise<TopicDetail | null> {
  try {
    const [metaResult, configResult, offsets] = await Promise.all([
      admin.fetchTopicMetadata({ topics: [topic] }),
      admin.describeConfigs({
        resources: [{ type: ConfigResourceTypes.TOPIC, name: topic }],
        includeSynonyms: false,
      }),
      admin.fetchTopicOffsets(topic),
    ])

    const topicMeta = metaResult.topics[0]
    if (!topicMeta) return null

    const offsetsByPartition = new Map(offsets.map((o) => [o.partition, o]))

    const partitions: PartitionInfo[] = [...topicMeta.partitions]
      .sort((a, b) => a.partitionId - b.partitionId)
      .map((p) => {
        const offset = offsetsByPartition.get(p.partitionId)
        const earliestOffset = offset ? Number(offset.low) : 0
        const latestOffset = offset ? Number(offset.high) : 0
        return {
          partitionId: p.partitionId,
          leader: p.leader,
          replicas: p.replicas,
          isr: p.isr,
          underReplicated: isUnderReplicated(p),
          earliestOffset,
          latestOffset,
          messageCount: Math.max(0, latestOffset - earliestOffset),
        }
      })

    const configEntries: TopicConfigEntry[] = (configResult.resources[0]?.configEntries ?? []).map((c) => ({
      name: c.configName,
      value: c.configValue,
      isDefault: c.isDefault,
    }))

    return { name: topic, partitions, configs: sortConfigs(configEntries) }
  } catch {
    return null
  }
}
