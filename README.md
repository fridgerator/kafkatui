# kafka-tui

A modern, read-only Kafka debugging TUI for application developers. Built with
[OpenTUI](https://github.com/anomalyco/opentui) + React on [Bun](https://bun.sh).

Targets AWS MSK (IAM auth) but works against any Kafka cluster.

The full specification lives in [`docs/kafka-tui-plan.md`](docs/kafka-tui-plan.md).

## Status

**Phase 1 of 10 — scaffold.** The UI shell runs; nothing talks to Kafka yet.

| Phase | Scope | Status |
|------:|-------|--------|
| 1 | Tab shell, theme tokens, status/hint bars | ✅ done |
| 2 | Local Kafka stack (docker-compose + synthetic producer) | not started |
| 3 | Consume tab: ephemeral consumer, ring buffer, windowed list | not started |
| 4 | Avro + Confluent Schema Registry | not started |
| 5 | Search bar + `@filter:` query language | not started |
| 6 | Message detail view | not started |
| 7 | Consumer groups tab: lag, sparklines | not started |
| 8 | Topics tab: metadata + config | not started |
| 9 | MSK IAM auth | not started |
| 10 | Produce placeholder, NDJSON export, polish | not started |

## Requirements

- **Bun** ≥ 1.4 (`curl -fsSL https://bun.sh/install | bash`)
- A terminal with 256-color or truecolor support

## Getting started

```sh
bun install
bun run dev
```

### Keybindings

| Key | Action |
|---|---|
| `1` – `4` | Jump to tab |
| `Tab` / `Shift+Tab` | Cycle tabs |
| `q` / `Ctrl+C` | Quit |

Per-tab keys are listed in the hint bar at the bottom of the screen. Keys shown
there for unbuilt features are advertised but not yet wired up.

### Scripts

| Script | Purpose |
|---|---|
| `bun run dev` | Run the TUI |
| `bun run typecheck` | `tsc --noEmit` |

## Project layout

```
src/
├── index.tsx              entrypoint: createCliRenderer + createRoot
├── app.tsx                root component, tab routing, global keybindings
├── theme/monokai.ts       all color tokens (the only file with hex literals)
└── components/
    ├── StatusBar.tsx      profile, connection state, topic
    ├── TabBar.tsx         tab strip + TabId definitions
    ├── HintBar.tsx        context-sensitive keybinding hints
    ├── consume/           Consume tab (spec §6)
    ├── groups/            Consumer Groups tab
    ├── topics/            Topics / cluster metadata tab
    └── produce/           Produce placeholder (read-only in v1)
```

Dependency versions are pinned exactly. OpenTUI is pre-1.0 and ships frequently,
so upgrades should be deliberate rather than picked up by a range.

## Conventions

- **Colors** come from `src/theme/monokai.ts` only. No hex literals in components.
- **Flex children that must keep their size** need `flexShrink: 0`, and scrolling
  or clipping containers need `overflow: "hidden"`. Without both, OpenTUI shrinks
  children toward zero and they paint over each other on small terminals.
