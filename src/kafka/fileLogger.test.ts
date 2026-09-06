import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { logLevel } from "kafkajs"
import { createFileLogCreator, installProcessWarningLogger, kafkaLogFilePath } from "./fileLogger"

describe("kafkaLogFilePath", () => {
  test("lives under ~/.kafka-tui/logs and has no ':' or '.' in the timestamp portion", () => {
    const path = kafkaLogFilePath(new Date("2026-09-05T23:41:59.860Z"))
    expect(path).toBe(join(homedir(), ".kafka-tui", "logs", "kafka-tui-2026-09-05T23-41-59-860Z.log"))
  })

  test("two calls at different instants produce different paths", () => {
    const a = kafkaLogFilePath(new Date("2026-09-05T00:00:00.000Z"))
    const b = kafkaLogFilePath(new Date("2026-09-05T00:00:00.001Z"))
    expect(a).not.toBe(b)
  })
})

describe("createFileLogCreator", () => {
  const dir = join(homedir(), ".kafka-tui", "logs-test")
  const path = join(dir, "test.log")

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("creates the directory if missing and writes a kafkajs-shaped JSON line", () => {
    expect(existsSync(dir)).toBe(false)
    const logFn = createFileLogCreator(path)(logLevel.INFO)

    logFn({
      namespace: "kafka",
      level: logLevel.INFO,
      label: "INFO",
      log: { timestamp: "2026-09-05T23:41:59.860Z", message: "Broker connected" },
    })

    const lines = readFileSync(path, "utf8").trim().split("\n")
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed).toEqual({
      level: "INFO",
      timestamp: "2026-09-05T23:41:59.860Z",
      message: "[kafka] Broker connected",
    })
  })

  test("appends rather than overwriting across multiple entries", () => {
    const logFn = createFileLogCreator(path)(logLevel.ERROR)
    logFn({ namespace: "a", level: logLevel.ERROR, label: "ERROR", log: { timestamp: "t1", message: "first" } })
    logFn({ namespace: "b", level: logLevel.WARN, label: "WARN", log: { timestamp: "t2", message: "second" } })

    const lines = readFileSync(path, "utf8").trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).message).toBe("[a] first")
    expect(JSON.parse(lines[1]!).message).toBe("[b] second")
  })

  test("an entry with no namespace has no bracket prefix", () => {
    const logFn = createFileLogCreator(path)(logLevel.INFO)
    logFn({ namespace: "", level: logLevel.INFO, label: "INFO", log: { timestamp: "t", message: "plain" } })
    expect(JSON.parse(readFileSync(path, "utf8").trim()).message).toBe("plain")
  })

  test("a write failure is swallowed, not thrown", () => {
    // Pointing "path" at something that already exists as a directory makes appendFileSync
    // fail (EISDIR) — this should be dropped silently rather than crash the caller (kafkajs).
    mkdirSync(path, { recursive: true })
    const logFn = createFileLogCreator(path)(logLevel.INFO)
    expect(() =>
      logFn({ namespace: "x", level: logLevel.INFO, label: "INFO", log: { timestamp: "t", message: "m" } }),
    ).not.toThrow()
  })
})

describe("installProcessWarningLogger", () => {
  const dir = join(homedir(), ".kafka-tui", "logs-test")
  const path = join(dir, "warnings.log")
  // Node registers its own default stderr-printing listener for "warning" at startup;
  // installProcessWarningLogger replaces the whole listener set, so every test here must put
  // the original set back afterwards or every later test in this same `bun test` process would
  // run with default warning printing permanently gone.
  const originalListeners = process.listeners("warning")

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    process.removeAllListeners("warning")
    for (const listener of originalListeners) process.on("warning", listener as (...a: unknown[]) => void)
  })

  test("removes the default listener and logs warnings to file instead of printing them", () => {
    installProcessWarningLogger(path)
    expect(process.listeners("warning")).toHaveLength(1)

    process.emitWarning("something odd", "TestWarning")
    // emitWarning dispatches on the next tick, not synchronously.
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        const parsed = JSON.parse(readFileSync(path, "utf8").trim())
        expect(parsed.level).toBe("WARN")
        expect(parsed.message).toBe("[process] TestWarning: something odd")
        resolve()
      })
    })
  })
})
