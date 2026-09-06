import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { LogEntry, logCreator } from "kafkajs"

/**
 * kafkajs's default logger writes straight to stdout/stderr via `console.*` — inside this app's
 * full-screen TUI, every line it prints repaints garbage over the rendered frame (spec is
 * silent on this since kafkajs was originally wired up with `logLevel.NOTHING`, but that only
 * suppresses output as long as nothing overrides it — kafkajs itself lets `KAFKAJS_LOG_LEVEL`
 * *unconditionally* override the level passed at construction time (see
 * `node_modules/kafkajs/src/loggers/index.js`'s `evaluateLogLevel`), so an ambient env var on
 * the user's machine can and does unlock console output regardless of what this app configures).
 *
 * Redirecting to a file rather than continuing to suppress: `logLevel.NOTHING` was silently
 * throwing away real diagnostics (auth failures, broker disconnects) that are exactly what
 * you'd want when a connection is misbehaving. A file under `~/.kafka-tui/logs/` — this
 * project's existing convention for all persistent state (`config.yaml`, `exports/`,
 * `last-copy.txt`) — keeps that information available without ever touching the terminal.
 */
export function kafkaLogFilePath(at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-")
  return join(homedir(), ".kafka-tui", "logs", `kafka-tui-${stamp}.log`)
}

// One file per process run, not per call — every caller that omits `path` below (both the
// kafkajs log creator and the stray-process-warning logger) needs to land in the same file, so
// the timestamp is pinned the first time anything asks, not recomputed per call.
let sharedPath: string | undefined
function getSharedLogFilePath(): string {
  if (!sharedPath) sharedPath = kafkaLogFilePath()
  return sharedPath
}

function appendLine(path: string, fields: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  try {
    appendFileSync(path, `${JSON.stringify(fields)}\n`, "utf8")
  } catch {
    // Best-effort — losing a log line is far better than crashing the TUI, and silently
    // falling back to stdout would recreate the exact problem this module exists to avoid.
  }
}

const LEVEL_LABELS: Record<number, string> = { 1: "ERROR", 2: "WARN", 4: "INFO", 5: "DEBUG" }

/**
 * Thin fs shell producing kafkajs's own line shape (see `loggers/console.js`) — same JSON
 * fields, just appended to `path` instead of passed to `console.*` — so existing expectations
 * about kafkajs's log format (grepping for `"level":"ERROR"`, etc.) still hold.
 */
export function createFileLogCreator(path: string = getSharedLogFilePath()): logCreator {
  return () => (entry: LogEntry) => {
    const prefix = entry.namespace ? `[${entry.namespace}] ` : ""
    appendLine(path, {
      level: LEVEL_LABELS[entry.level] ?? entry.level,
      ...entry.log,
      message: `${prefix}${entry.log.message}`,
    })
  }
}

/**
 * kafkajs isn't the only source of stray terminal output: a known kafkajs bug (a negative
 * timeout computed in its request-queue throttle check, `network/requestQueue/index.js`'s
 * `scheduleCheckPendingRequests`) makes Node emit a raw `TimeoutNegativeWarning` on every
 * connection — via `process.emitWarning`, entirely bypassing kafkajs's own logger/logCreator,
 * so `createFileLogCreator` above can't catch it. Node's default behavior for any `"warning"`
 * event is to print it straight to stderr *in addition to* whatever listeners are registered, so
 * adding a listener alone doesn't stop it — this only stops once the default listener is removed
 * first (a well-established pattern; e.g. npm does the same to keep its own output clean).
 *
 * Scoped to just this one event, not a blanket `console.*` override — nothing else in this
 * app's dependency tree writes to the terminal directly (verified: no other dependency calls
 * `console.*`), so a general override isn't needed and would risk swallowing something else.
 */
export function installProcessWarningLogger(path: string = getSharedLogFilePath()): void {
  process.removeAllListeners("warning")
  process.on("warning", (warning: Error) => {
    appendLine(path, {
      level: "WARN",
      timestamp: new Date().toISOString(),
      message: `[process] ${warning.name}: ${warning.message}`,
      stack: warning.stack,
    })
  })
}
