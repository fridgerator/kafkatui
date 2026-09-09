import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { DEFAULT_RING_BUFFER_SIZE, type ClusterProfile, type KafkaTuiConfig } from "./types"

const DEFAULT_CONFIG_PATH = join(homedir(), ".kafka-tui", "config.yaml")

export class ConfigError extends Error {}

/** Raw values of the profile-shaping CLI flags (spec §3). All optional; each one
 * present overrides the matching field of the selected profile, and together
 * they can synthesize a whole profile with no config file at all. */
interface CliOverrides {
  brokers?: string
  authType?: string
  region?: string
  awsProfile?: string
  schemaRegistryUrl?: string
  schemaRegistryUsername?: string
  schemaRegistryPassword?: string
}

interface ParsedArgs extends CliOverrides {
  configPath?: string
  profileName?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {}

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--config":
        parsed.configPath = argv[++i]
        break
      case "--profile":
        parsed.profileName = argv[++i]
        break
      case "--brokers":
        parsed.brokers = argv[++i]
        break
      case "--auth-type":
        parsed.authType = argv[++i]
        break
      case "--region":
        parsed.region = argv[++i]
        break
      case "--aws-profile":
        parsed.awsProfile = argv[++i]
        break
      case "--schema-registry-url":
        parsed.schemaRegistryUrl = argv[++i]
        break
      case "--schema-registry-username":
        parsed.schemaRegistryUsername = argv[++i]
        break
      case "--schema-registry-password":
        parsed.schemaRegistryPassword = argv[++i]
        break
    }
  }

  return parsed
}

const DEFAULT_IAM_REGION = "us-east-1"

/**
 * Applies the profile-shaping CLI flags (spec §3) on top of `base` — the profile
 * selected from a config file, or `undefined` when there is no file. A passed
 * flag always wins over the file; an unset flag leaves the file's value alone.
 * Returns `undefined` only when there's nothing to build from (no file and no
 * `--brokers`); the caller turns that into the "no config" error.
 */
function applyCliOverrides(base: ClusterProfile | undefined, overrides: CliOverrides): ClusterProfile | undefined {
  if (!base && !overrides.brokers) return undefined

  const profile: ClusterProfile = base
    ? structuredClone(base)
    : { name: "cli", brokers: [], auth: { type: "none" } }

  if (overrides.brokers !== undefined) {
    profile.brokers = overrides.brokers
      .split(",")
      .map((b) => b.trim())
      .filter(Boolean)
  }

  const baseIam = base?.auth.type === "iam" ? base.auth : undefined
  if (overrides.authType === "iam") {
    profile.auth = {
      type: "iam",
      region: overrides.region ?? baseIam?.region ?? DEFAULT_IAM_REGION,
      profile: overrides.awsProfile ?? baseIam?.profile,
    }
  } else if (overrides.authType === "none") {
    profile.auth = { type: "none" }
  } else if (overrides.authType !== undefined) {
    // Anything other than none/iam: let assertClusterProfile produce the
    // canonical "invalid auth.type" message rather than a second variant here.
    profile.auth = { type: overrides.authType } as ClusterProfile["auth"]
  } else if (overrides.region !== undefined || overrides.awsProfile !== undefined) {
    if (profile.auth.type !== "iam") {
      throw new ConfigError("--region / --aws-profile only apply to --auth-type iam.")
    }
    if (overrides.region !== undefined) profile.auth.region = overrides.region
    if (overrides.awsProfile !== undefined) profile.auth.profile = overrides.awsProfile
  }

  const touchesSchemaRegistry =
    overrides.schemaRegistryUrl !== undefined ||
    overrides.schemaRegistryUsername !== undefined ||
    overrides.schemaRegistryPassword !== undefined
  if (touchesSchemaRegistry) {
    const url = overrides.schemaRegistryUrl ?? profile.schemaRegistry?.url
    if (!url) {
      throw new ConfigError(
        "--schema-registry-username / --schema-registry-password require --schema-registry-url " +
          "(or a profile that already sets schemaRegistry.url).",
      )
    }
    const username = overrides.schemaRegistryUsername ?? profile.schemaRegistry?.auth?.username
    const password = overrides.schemaRegistryPassword ?? profile.schemaRegistry?.auth?.password
    if ((username === undefined) !== (password === undefined)) {
      throw new ConfigError("Schema registry auth needs both a username and a password.")
    }
    profile.schemaRegistry = {
      url,
      auth: username !== undefined && password !== undefined ? { username, password } : undefined,
    }
  }

  return profile
}

/**
 * Per-profile shape checks, shared between file validation (every profile in the
 * file) and the final merged/synthesized profile that `loadConfig` returns — so
 * a CLI-built profile is held to exactly the same bar as a file-loaded one.
 */
function assertClusterProfile(p: {
  name?: unknown
  brokers?: unknown
  auth?: unknown
}): void {
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
    assertClusterProfile(profile as Record<string, unknown>)
  }
}

export interface LoadedConfig {
  config: KafkaTuiConfig
  profile: ClusterProfile
  ringBufferSize: number
}

export function loadConfig(
  argv: string[] = process.argv.slice(2),
  { defaultConfigPath = DEFAULT_CONFIG_PATH }: { defaultConfigPath?: string } = {},
): LoadedConfig {
  const { configPath: explicitPath, profileName, ...overrides } = parseArgs(argv)
  const configPath = explicitPath ?? defaultConfigPath
  const hasFile = existsSync(configPath)

  if (explicitPath && !hasFile) {
    throw new ConfigError(`Config file not found: ${configPath}`)
  }

  let fileConfig: KafkaTuiConfig | undefined
  let baseProfile: ClusterProfile | undefined
  let ringBufferSize = DEFAULT_RING_BUFFER_SIZE

  if (hasFile) {
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
    fileConfig = parsed
    ringBufferSize = fileConfig.ringBufferSize ?? DEFAULT_RING_BUFFER_SIZE

    const selectedName = profileName ?? fileConfig.defaultProfile
    const rawProfile = fileConfig.profiles.find((p) => p.name === selectedName)
    if (!rawProfile) {
      const available = fileConfig.profiles.map((p) => p.name).join(", ")
      throw new ConfigError(`Unknown profile "${selectedName}". Available profiles: ${available}`)
    }

    // Only the selected profile is interpolated. A config file may define other
    // profiles (e.g. for other environments/machines) whose secrets aren't set
    // here — that must not block startup for a profile that doesn't need them.
    baseProfile = interpolateEnv(rawProfile)
  }

  // CLI flags override the selected profile field-by-field, or — with no file —
  // synthesize a whole profile from scratch (spec §3).
  const profile = applyCliOverrides(baseProfile, overrides)
  if (!profile) {
    throw new ConfigError(
      `No config file at ${configPath}. Pass --config <path>, supply --brokers <list> ` +
        `(with --auth-type / --schema-registry-* as needed), or copy config.example.yaml there.`,
    )
  }

  assertClusterProfile(profile)

  const config = fileConfig ?? { profiles: [profile], defaultProfile: profile.name }
  return { config, profile, ringBufferSize }
}
