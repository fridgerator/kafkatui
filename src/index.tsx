/**
 * Entrypoint (spec §10 lists this as `src/index.ts`; it is `.tsx` because it
 * mounts the root JSX element).
 *
 * Phase 1 takes no CLI arguments. `--config` / `--profile` parsing arrives in
 * phase 2 alongside the config loader.
 */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App } from "./app"
import { theme } from "./theme/monokai"

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  clearOnShutdown: true,
  targetFps: 30,
  backgroundColor: theme.bg,
})

createRoot(renderer).render(<App />)
