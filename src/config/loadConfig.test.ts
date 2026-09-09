import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigError, loadConfig } from "./loadConfig"
import { DEFAULT_RING_BUFFER_SIZE } from "./types"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kafka-tui-config-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeConfig(contents: string): string {
  const path = join(dir, "config.yaml")
  writeFileSync(path, contents)
  return path
}

describe("loadConfig", () => {
  test("loads the default profile", () => {
    const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth:
      type: none
defaultProfile: dev-local
`)
    const { profile, ringBufferSize } = loadConfig(["--config", path])
    expect(profile.name).toBe("dev-local")
    expect(profile.brokers).toEqual(["localhost:9092"])
    expect(ringBufferSize).toBe(DEFAULT_RING_BUFFER_SIZE)
  })

  test("--profile overrides defaultProfile", () => {
    const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: none }
  - name: other
    brokers: [other:9092]
    auth: { type: none }
defaultProfile: dev-local
`)
    const { profile } = loadConfig(["--config", path, "--profile", "other"])
    expect(profile.name).toBe("other")
  })

  test("unknown --profile fails with the list of available profiles", () => {
    const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: none }
defaultProfile: dev-local
`)
    expect(() => loadConfig(["--config", path, "--profile", "nope"])).toThrow(/Available profiles: dev-local/)
  })

  test("missing config file fails fast with ConfigError", () => {
    expect(() => loadConfig(["--config", join(dir, "does-not-exist.yaml")])).toThrow(ConfigError)
  })

  test("invalid YAML fails fast", () => {
    const path = writeConfig("profiles: [this is not: valid: yaml")
    expect(() => loadConfig(["--config", path])).toThrow(ConfigError)
  })

  test("invalid auth.type is rejected", () => {
    const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: bogus }
defaultProfile: dev-local
`)
    expect(() => loadConfig(["--config", path])).toThrow(/invalid `auth.type`/)
  })

  test("env var interpolation resolves ${VAR} for the selected profile", () => {
    process.env.KAFKA_TUI_TEST_USER = "alice"
    const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: none }
    schemaRegistry:
      url: http://localhost:8081
      auth:
        username: \${KAFKA_TUI_TEST_USER}
        password: hunter2
defaultProfile: dev-local
`)
    const { profile } = loadConfig(["--config", path])
    expect(profile.schemaRegistry?.auth?.username).toBe("alice")
    delete process.env.KAFKA_TUI_TEST_USER
  })

  test("a missing env var only fails startup if the SELECTED profile actually references it", () => {
    // Regression case: config.example.yaml's unused staging-msk profile references
    // ${SCHEMA_REGISTRY_USER}/${SCHEMA_REGISTRY_PASS}. Loading dev-local must not
    // require those to be set just because some other, unused profile mentions them.
    const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: none }
  - name: staging-msk
    brokers: [broker:9098]
    auth: { type: iam, region: us-east-1 }
    schemaRegistry:
      url: https://example.com
      auth:
        username: \${DEFINITELY_NOT_SET_VAR}
        password: \${ALSO_NOT_SET}
defaultProfile: dev-local
`)
    const { profile } = loadConfig(["--config", path])
    expect(profile.name).toBe("dev-local")
  })

  test("a missing env var DOES fail startup when the selected profile references it", () => {
    const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: none }
    schemaRegistry:
      url: http://localhost:8081
      auth:
        username: \${DEFINITELY_NOT_SET_VAR}
        password: x
defaultProfile: dev-local
`)
    expect(() => loadConfig(["--config", path])).toThrow(/DEFINITELY_NOT_SET_VAR/)
  })

  describe("CLI flag overrides (no config file needed)", () => {
    // Point the default config path at a file that doesn't exist, so these
    // exercise the genuine "no file anywhere" path without depending on whether
    // the machine running the tests has a real ~/.kafka-tui/config.yaml.
    const noFile = () => ({ defaultConfigPath: join(dir, "no-such-config.yaml") })

    test("--brokers alone synthesizes a `cli` profile with none auth", () => {
      const { profile } = loadConfig(["--brokers", "a:9092, b:9092"], noFile())
      expect(profile.name).toBe("cli")
      expect(profile.brokers).toEqual(["a:9092", "b:9092"])
      expect(profile.auth).toEqual({ type: "none" })
    })

    test("no config file and no --brokers fails with a message naming --brokers", () => {
      expect(() => loadConfig([], noFile())).toThrow(/--brokers/)
    })

    test("--auth-type iam without --region defaults region to us-east-1", () => {
      const { profile } = loadConfig(["--brokers", "b:9098", "--auth-type", "iam"], noFile())
      expect(profile.auth).toEqual({ type: "iam", region: "us-east-1", profile: undefined })
    })

    test("--region and --aws-profile flow into iam auth", () => {
      const { profile } = loadConfig(
        ["--brokers", "b:9098", "--auth-type", "iam", "--region", "eu-west-1", "--aws-profile", "staging"],
        noFile(),
      )
      expect(profile.auth).toEqual({ type: "iam", region: "eu-west-1", profile: "staging" })
    })

    test("--schema-registry-url plus username/password builds schemaRegistry auth", () => {
      const { profile } = loadConfig(
        [
          "--brokers", "a:9092",
          "--schema-registry-url", "https://sr.example.com",
          "--schema-registry-username", "alice",
          "--schema-registry-password", "hunter2",
        ],
        noFile(),
      )
      expect(profile.schemaRegistry).toEqual({
        url: "https://sr.example.com",
        auth: { username: "alice", password: "hunter2" },
      })
    })

    test("schema registry credentials without a URL fail fast", () => {
      expect(() =>
        loadConfig(["--brokers", "a:9092", "--schema-registry-username", "alice"], noFile()),
      ).toThrow(/--schema-registry-url/)
    })

    test("--auth-type with an unknown value is rejected", () => {
      expect(() => loadConfig(["--brokers", "a:9092", "--auth-type", "bogus"], noFile())).toThrow(
        /invalid `auth.type`/,
      )
    })

    test("an explicit --config that doesn't exist still fails fast", () => {
      expect(() => loadConfig(["--config", join(dir, "nope.yaml"), "--brokers", "a:9092"])).toThrow(
        /Config file not found/,
      )
    })
  })

  describe("CLI flag overrides on top of a config file", () => {
    test("--brokers overrides the selected profile but leaves schemaRegistry intact", () => {
      const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: none }
    schemaRegistry:
      url: http://localhost:8081
defaultProfile: dev-local
`)
      const { profile } = loadConfig(["--config", path, "--brokers", "override:9092"])
      expect(profile.name).toBe("dev-local")
      expect(profile.brokers).toEqual(["override:9092"])
      expect(profile.schemaRegistry).toEqual({ url: "http://localhost:8081", auth: undefined })
    })

    test("--region alone refines an existing iam profile", () => {
      const path = writeConfig(`
profiles:
  - name: msk
    brokers: [b:9098]
    auth: { type: iam, region: us-east-1 }
defaultProfile: msk
`)
      const { profile } = loadConfig(["--config", path, "--region", "eu-west-1"])
      expect(profile.auth).toEqual({ type: "iam", region: "eu-west-1", profile: undefined })
    })

    test("--region on a non-iam profile is rejected", () => {
      const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: none }
defaultProfile: dev-local
`)
      expect(() => loadConfig(["--config", path, "--region", "eu-west-1"])).toThrow(/--auth-type iam/)
    })

    test("schema registry credential flags merge onto the profile's existing url", () => {
      const path = writeConfig(`
profiles:
  - name: dev-local
    brokers: [localhost:9092]
    auth: { type: none }
    schemaRegistry:
      url: http://localhost:8081
defaultProfile: dev-local
`)
      const { profile } = loadConfig([
        "--config", path,
        "--schema-registry-username", "alice",
        "--schema-registry-password", "hunter2",
      ])
      expect(profile.schemaRegistry).toEqual({
        url: "http://localhost:8081",
        auth: { username: "alice", password: "hunter2" },
      })
    })
  })
})
