import type { SchemaRegistry } from "@kafkajs/confluent-schema-registry"
import { createContext, useContext, type ReactNode } from "react"
import type { SchemaRegistryConfig } from "../config/types"

export interface SchemaRegistryHandle {
  client: SchemaRegistry | null
  /** The raw config, alongside the constructed client — `avro.ts`'s subject/version lookup
   * (spec §6.5) hits Confluent's REST API directly, which needs the url/auth `SchemaRegistry`'s
   * own client class doesn't expose, rather than the client instance itself. */
  config: SchemaRegistryConfig | undefined
}

const SchemaRegistryContext = createContext<SchemaRegistryHandle>({ client: null, config: undefined })

export function SchemaRegistryProvider({ value, children }: { value: SchemaRegistryHandle; children: ReactNode }) {
  return <SchemaRegistryContext.Provider value={value}>{children}</SchemaRegistryContext.Provider>
}

/**
 * Unlike `useKafkaClient()`, a `null` client is a normal, expected result
 * here — a profile without `schemaRegistry` configured (spec §3) has no
 * registry at all, and callers (`ConsumeTab`) treat that the same as "not
 * yet decoded," falling back to the existing binary/hex preview.
 */
export function useSchemaRegistry(): SchemaRegistryHandle {
  return useContext(SchemaRegistryContext)
}
