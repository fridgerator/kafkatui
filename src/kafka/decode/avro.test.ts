import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry"
import { describe, expect, test } from "bun:test"
import { decodeAvroMessage } from "./avro"

const REGISTRY_URL = "http://localhost:8081"

// `describe.skipIf`'s condition is evaluated synchronously at collection time —
// before any `beforeAll` hook would get a chance to run — so the reachability
// probe has to be a top-level await, not a beforeAll.
let registryAvailable = false
try {
  const res = await fetch(`${REGISTRY_URL}/subjects`, { signal: AbortSignal.timeout(2000) })
  registryAvailable = res.ok
} catch {
  registryAvailable = false
}
if (!registryAvailable) {
  console.warn(
    `\navro.test.ts: schema registry not reachable at ${REGISTRY_URL} — skipping. ` +
      `Run \`docker compose -f docker/docker-compose.yml up -d\` to enable this suite.\n`,
  )
}

describe.skipIf(!registryAvailable)("decodeAvroMessage (against a real local schema registry)", () => {
  const registry = new SchemaRegistry({ host: REGISTRY_URL })

  const testSchema = {
    type: "record",
    name: "AvroTestDecodeMessage",
    namespace: "com.kafkatui.test",
    fields: [
      { name: "id", type: "string" },
      { name: "count", type: "int" },
    ],
  }

  test("round-trips a real Avro-encoded message back to JSON", async () => {
    const { id } = await registry.register(
      { type: SchemaType.AVRO, schema: JSON.stringify(testSchema) },
      { subject: "avro-test-decode-message-value" },
    )
    const payload = { id: "abc-123", count: 42 }
    const encoded = await registry.encode(id, payload)

    const result = await decodeAvroMessage(registry, encoded)

    expect(result.kind).toBe("json")
    expect(result.value).toEqual(payload)
    expect(result.preview).toContain("abc-123")
  })

  test("an unregistered schema ID falls back to binary, never throws", async () => {
    // Confluent wire format: magic byte 0x0 + 4-byte big-endian schema ID + payload.
    const bogus = Buffer.concat([Buffer.from([0x0, 0xff, 0xff, 0xff, 0xfe]), Buffer.from([1, 2, 3, 4])])

    const result = await decodeAvroMessage(registry, bogus)

    expect(result.kind).toBe("binary")
    expect(result.preview).toContain("avro decode error")
  })

  test("circuit breaker trips after repeated failures against an unreachable registry", async () => {
    // Port 1 is reserved/unlisted — connections fail fast (no hang) rather than timing out.
    const deadRegistry = new SchemaRegistry({ host: "http://127.0.0.1:1" })
    const buffer = Buffer.concat([Buffer.from([0x0, 0, 0, 0, 1]), Buffer.from([1, 2, 3])])

    const first = await decodeAvroMessage(deadRegistry, buffer)
    expect(first.kind).toBe("binary")
    expect(first.preview).toContain("avro decode error")

    let lastResult = first
    for (let i = 0; i < 5; i++) {
      lastResult = await decodeAvroMessage(deadRegistry, buffer)
    }

    expect(lastResult.preview).toContain("schema registry unreachable")
  })
})
