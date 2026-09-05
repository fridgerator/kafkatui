import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { DEFAULT_RING_BUFFER_SIZE, type ClusterProfile, type KafkaTuiConfig } from "./types"

const DEFAULT_CONFIG_PATH = join(homedir(), ".kafka-tui", "config.yaml")

export class ConfigError extends Error {}

function parseArgs(argv: string[]): { configPath?: string; profileName?: string } {
  let configPath: string | undefined
  let profileName: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--config") {
      configPath = argv[++i]
    } else if (arg === "--profile") {
      profileName = argv[++i]
    }
  }

  return { configPath, profileName }
}

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)\}/g

/** Recursively replaces `${ENV_VAR}` in every string value (spec §3). Missing vars fail fast. */
function interpolateEnv<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(ENV_VAR_PATTERN, (match, name: string) => {
      const envValue = process.env[name]
      if (envValue === undefined) {
        throw new ConfigError(`Config references \${${name}}, but that environment variable is not set.`)
      }
      return envValue
    }) as T
  }
  if (Array.isArray(value)) {
    return value.map(interpolateEnv) as T
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = interpolateEnv(val)
    }
    return result as T
  }
  return value
}

function assertConfigShape(raw: unknown): asserts raw is KafkaTuiConfig {
  if (raw === null || typeof raw !== "object") {
    throw new ConfigError("Config file must contain a YAML mapping at the top level.")
  }
  const candidate = raw as Record<string, unknown>
  if (!Array.isArray(candidate.profiles) || candidate.profiles.length === 0) {
    throw new ConfigError("Config must define a non-empty `profiles` list.")
  }
  if (typeof candidate.defaultProfile !== "string") {
    throw new ConfigError("Config must set `defaultProfile` to the name of one of the `profiles`.")
  }
  for (const profile of candidate.profiles) {
    if (typeof profile !== "object" || profile === null) {
      throw new ConfigError("Each entry in `profiles` must be a mapping.")
    }
    const p = profile as Record<string, unknown>
    if (typeof p.name !== "string" || p.name.length === 0) {
      throw new ConfigError("Every profile needs a non-empty `name`.")
    }
    if (!Array.isArray(p.brokers) || p.brokers.length === 0 || !p.brokers.every((b) => typeof b === "string")) {
      throw new ConfigError(`Profile "${p.name}" needs a non-empty \`brokers\` list of strings.`)
    }
    const auth = p.auth as Record<string, unknown> | undefined
    const authType = auth?.type
    if (authType !== "none" && authType !== "iam" && authType !== "sasl-scram" && authType !== "sasl-plain") {
      throw new ConfigError(
        `Profile "${p.name}" has an invalid \`auth.type\` (got ${JSON.stringify(authType)}); ` +
          `expected one of: none, iam, sasl-scram, sasl-plain.`,
      )
    }
  }
}

export interface LoadedConfig {
  config: KafkaTuiConfig
  profile: ClusterProfile
  ringBufferSize: number
}

export function loadConfig(argv: string[] = process.argv.slice(2)): LoadedConfig {
  const { configPath: explicitPath, profileName } = parseArgs(argv)
  const configPath = explicitPath ?? DEFAULT_CONFIG_PATH

  if (!existsSync(configPath)) {
    throw new ConfigError(
      explicitPath
        ? `Config file not found: ${configPath}`
        : `No config file at ${configPath}. Pass --config <path>, or copy config.example.yaml there.`,
    )
  }

  let rawText: string
  try {
    rawText = readFileSync(configPath, "utf8")
  } catch (err) {
    throw new ConfigError(`Could not read config file ${configPath}: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = parseYaml(rawText)
  } catch (err) {
    throw new ConfigError(`Config file ${configPath} is not valid YAML: ${(err as Error).message}`)
  }

  // Shape validation runs on the raw config, before interpolation — a `${VAR}`
  // placeholder is still a valid string either way, so this doesn't need env vars.
  assertConfigShape(parsed)
  const config = parsed

  const selectedName = profileName ?? config.defaultProfile
  const rawProfile = config.profiles.find((p) => p.name === selectedName)
  if (!rawProfile) {
    const available = config.profiles.map((p) => p.name).join(", ")
    throw new ConfigError(`Unknown profile "${selectedName}". Available profiles: ${available}`)
  }

  // Only the selected profile is interpolated. A config file may define other
  // profiles (e.g. for other environments/machines) whose secrets aren't set
  // here — that must not block startup for a profile that doesn't need them.
  const profile = interpolateEnv(rawProfile)

  return { config, profile, ringBufferSize: config.ringBufferSize ?? DEFAULT_RING_BUFFER_SIZE }
}
