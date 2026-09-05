import { SchemaRegistry } from "@kafkajs/confluent-schema-registry"
import type { SchemaRegistryConfig } from "../../config/types"
import { toHexPreview } from "./hexDump"
import { truncate, type DecodedMessage } from "./decodeMessage"

/** `null` when the profile has no `schemaRegistry` configured (spec §3). */
export function createSchemaRegistryClient(config: SchemaRegistryConfig | undefined): SchemaRegistry | null {
  if (!config) return null
  // mappersmith's `Auth` type (used by SchemaRegistryAPIClientArgs) declares an index
  // signature our named `SchemaRegistryAuth` interface doesn't, so passing it directly
  // fails structural assignability — rebuilding as a literal satisfies it.
  const auth = config.auth ? { username: config.auth.username, password: config.auth.password } : undefined
  return new SchemaRegistry({ host: config.url, auth })
}

interface SchemaSubjectVersion {
  subject: string
  version: number
}

const schemaSubjectVersionCache = new Map<string, SchemaSubjectVersion[]>()

function basicAuthHeader(config: SchemaRegistryConfig): Record<string, string> {
  if (!config.auth) return {}
  const encoded = Buffer.from(`${config.auth.username}:${config.auth.password}`).toString("base64")
  return { Authorization: `Basic ${encoded}` }
}

/**
 * `SchemaRegistry`'s client only supports subject+version → ID, not the
 * reverse — this hits Confluent's REST API directly for "given this ID, what
 * subject/version is it" (spec §6.5). Verified against a real registry
 * (`GET /schemas/ids/{id}/versions` → `[{subject, version}]`) rather than
 * assumed from Confluent's docs. Never throws: a network failure or 404 (a
 * schema ID with no registered subject, unusual but possible) just yields
 * `null` — this is supplementary detail-view info, not something that should
 * block the rest of the pane from rendering.
 */
export async function fetchSchemaSubjectVersions(
  config: SchemaRegistryConfig,
  schemaId: number,
): Promise<SchemaSubjectVersion[] | null> {
  const cacheKey = `${config.url}:${schemaId}`
  const cached = schemaSubjectVersionCache.get(cacheKey)
  if (cached) return cached

  try {
    const res = await fetch(`${config.url}/schemas/ids/${schemaId}/versions`, {
      headers: basicAuthHeader(config),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const versions = (await res.json()) as SchemaSubjectVersion[]
    schemaSubjectVersionCache.set(cacheKey, versions)
    return versions
  } catch {
    return null
  }
}

const CIRCUIT_BREAKER_THRESHOLD = 5
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000

/**
 * `SchemaRegistry`'s own cache (confirmed in its `dist/cache.js`) only stores
 * successful schema lookups — a systemically unreachable registry would
 * otherwise retry an HTTP call on every single Avro message, at whatever the
 * topic's throughput is (phase 3 measured bursts over 150 msgs/sec). This
 * breaker is local to one `SchemaRegistry` instance's decode calls, not part
 * of the registry client itself.
 */
class AvroCircuitBreaker {
  private consecutiveFailures = 0
  private openUntil = 0

  isOpen(): boolean {
    return Date.now() < this.openUntil
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
    this.openUntil = 0
  }

  recordFailure(): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS
    }
  }
}

const breakers = new WeakMap<SchemaRegistry, AvroCircuitBreaker>()

function breakerFor(registry: SchemaRegistry): AvroCircuitBreaker {
  let breaker = breakers.get(registry)
  if (!breaker) {
    breaker = new AvroCircuitBreaker()
    breakers.set(registry, breaker)
  }
  return breaker
}

/**
 * Decodes Confluent wire-format Avro (spec §6.2). Never throws — every
 * failure becomes a `binary`-kind result with the hex fallback, same
 * contract as `decodeMessage()`'s other branches.
 */
export async function decodeAvroMessage(registry: SchemaRegistry, buffer: Buffer): Promise<DecodedMessage> {
  const breaker = breakerFor(registry)

  if (breaker.isOpen()) {
    return {
      kind: "binary",
      preview: `⚠ schema registry unreachable (retrying later) — ${toHexPreview(buffer)}`,
    }
  }

  try {
    const value = await registry.decode(buffer)
    breaker.recordSuccess()
    return { kind: "json", preview: truncate(JSON.stringify(value)), value }
  } catch (err) {
    breaker.recordFailure()
    return {
      kind: "binary",
      preview: `⚠ avro decode error: ${(err as Error).message} — ${toHexPreview(buffer)}`,
    }
  }
}
