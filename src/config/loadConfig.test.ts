import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConfigError, loadConfig } from "./loadConfig"

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
    expect(ringBufferSize).toBe(5000)
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
})
