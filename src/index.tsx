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
import { theme } from "./theme/monokai"

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
