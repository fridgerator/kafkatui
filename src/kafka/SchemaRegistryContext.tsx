import type { SchemaRegistry } from "@kafkajs/confluent-schema-registry"
import { createContext, useContext, type ReactNode } from "react"

const SchemaRegistryContext = createContext<SchemaRegistry | null>(null)

export function SchemaRegistryProvider({ client, children }: { client: SchemaRegistry | null; children: ReactNode }) {
  return <SchemaRegistryContext.Provider value={client}>{children}</SchemaRegistryContext.Provider>
}

/**
 * Unlike `useKafkaClient()`, `null` is a normal, expected result here — a
 * profile without `schemaRegistry` configured (spec §3) has no registry at
 * all, and callers (`ConsumeTab`) treat that the same as "not yet decoded,"
 * falling back to the existing binary/hex preview.
 */
export function useSchemaRegistry(): SchemaRegistry | null {
  return useContext(SchemaRegistryContext)
}
