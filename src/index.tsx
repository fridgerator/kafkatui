/**
 * Entrypoint (spec §10 lists this as `src/index.ts`; it is `.tsx` because it
 * mounts the root JSX element).
 *
 * `--config <path>` / `--profile <name>` (spec §3). Config is loaded and the
 * Kafka client constructed *before* the renderer starts, so a bad config
 * fails with a plain, readable error on stderr instead of the TUI booting
 * into a broken state.
 */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./app"
import { ConfigError, loadConfig } from "./config/loadConfig"
import { createKafkaClient } from "./kafka/client"
import { createSchemaRegistryClient } from "./kafka/decode/avro"
import { installProcessWarningLogger } from "./kafka/fileLogger"
import { theme } from "./theme/monokai"

// Before anything else: a raw Node process warning (e.g. a known kafkajs bug that emits
// `TimeoutNegativeWarning` on every connection) bypasses kafkajs's own logger entirely and
// prints straight to stderr by default, corrupting the full-screen TUI just like the console
// logging this redirects below. See fileLogger.ts's doc comment for the full explanation.
installProcessWarningLogger()

let loaded: ReturnType<typeof loadConfig>
try {
  loaded = loadConfig()
} catch (err) {
  const message = err instanceof ConfigError ? err.message : `Unexpected error loading config: ${err}`
  console.error(`kafka-tui: ${message}`)
  process.exit(1)
}

const { profile, ringBufferSize } = loaded
const kafka = createKafkaClient(profile)
const schemaRegistry = {
  client: createSchemaRegistryClient(profile.schemaRegistry),
  config: profile.schemaRegistry,
}

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  clearOnShutdown: true,
  targetFps: 30,
  backgroundColor: theme.bg,
})

createRoot(renderer).render(
  <App
    profileName={profile.name}
    kafka={kafka}
    schemaRegistry={schemaRegistry}
    ringBufferSize={ringBufferSize}
  />,
)
