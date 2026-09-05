/**
 * Config schema (spec §3). All four auth types are modeled here so the schema
 * is complete now, but only `none` is implemented in `kafka/client.ts` —
 * `iam` lands in phase 9, `sasl-scram`/`sasl-plain` are unassigned in the spec's
 * build phases and stay unimplemented until asked for.
 */

export interface NoAuth {
  type: "none"
}

export interface IamAuth {
  type: "iam"
  region: string
  /** Optional named AWS profile; omit to use the default credential chain. */
  profile?: string
}

export interface SaslScramAuth {
  type: "sasl-scram"
  username: string
  password: string
}

export interface SaslPlainAuth {
  type: "sasl-plain"
  username: string
  password: string
}

export type AuthConfig = NoAuth | IamAuth | SaslScramAuth | SaslPlainAuth

export interface SchemaRegistryAuth {
  username: string
  password: string
}

export interface SchemaRegistryConfig {
  url: string
  auth?: SchemaRegistryAuth
}

export interface ClusterProfile {
  name: string
  brokers: string[]
  auth: AuthConfig
  schemaRegistry?: SchemaRegistryConfig
}

export interface KafkaTuiConfig {
  profiles: ClusterProfile[]
  defaultProfile: string
  /** Ring buffer capacity for the Consume tab (spec §6.3 "N configurable"). */
  ringBufferSize?: number
}

export const DEFAULT_RING_BUFFER_SIZE = 5000
