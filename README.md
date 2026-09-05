# kafka-tui

A modern, read-only Kafka debugging TUI for application developers. Built with
[OpenTUI](https://github.com/anomalyco/opentui) + React on [Bun](https://bun.sh).

Targets AWS MSK (IAM auth) but works against any Kafka cluster.

The full specification lives in [`docs/kafka-tui-plan.md`](docs/kafka-tui-plan.md).

## Status

**Phase 2 of 10 — local Kafka stack.** The local dev stack runs and is producing real data; the TUI
still doesn't talk to Kafka yet (that's phase 3).

| Phase | Scope | Status |
|------:|-------|--------|
| 1 | Tab shell, theme tokens, status/hint bars | ✅ done |
| 2 | Local Kafka stack (docker-compose + synthetic producer) | ✅ done |
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

## Local Kafka stack

A single-node KRaft-mode Kafka broker, a Confluent Schema Registry, and a synthetic producer that
continuously writes realistic nested "order" data to three topics, one encoding each:

| Topic | Encoding | Notes |
|---|---|---|
| `orders.json` | JSON | nested `items[].sku`, `customer.address.zip`, `customer.roles[]` |
| `orders.avro` | Confluent wire-format Avro | same shape, schema registered as `orders.avro-value` |
| `logs.text` | plain text | log-line style messages, exercises the non-JSON decode fallback |

Each topic has 4 partitions and a random key per message, so there's real data for the partition-skew
view (phase 8) and the `@filter:` nested-path examples (phase 5) once those land.

```sh
docker compose -f docker/docker-compose.yml up -d
```

This exposes the broker at `localhost:9092` and the registry at `localhost:8081` — matching the
`dev-local` profile in [`config.example.yaml`](config.example.yaml) exactly, so once phase 3's config
loader exists, `docker compose up` + `bun run dev --profile dev-local` is a working end-to-end loop
with zero AWS dependency. Until then, point any Kafka client (`kcat -b localhost:9092 -t orders.json
-C`, etc.) directly at those addresses to poke around.

Produce rate is tunable — copy [`.env.example`](.env.example) to `.env` next to
`docker/docker-compose.yml` to change it. By default it produces ~5 msgs/sec/topic, with a 5-second
burst to ~100+ msgs/sec/topic once a minute, meant to stress-test phase 3's ring buffer once it exists.

```sh
docker compose -f docker/docker-compose.yml logs -f producer   # watch it run
docker compose -f docker/docker-compose.yml down -v            # tear down, including volumes
```

**Known harmless log noise**, both from `kafkajs` itself (last published 2023, predates Bun) rather
than anything in this repo: a one-time `TimeoutNegativeWarning` on startup (a real bug in kafkajs's
`requestQueue.scheduleCheckPendingRequests`, which computes a negative `setTimeout` delay when nothing
is actually throttled — Bun/Node just fire it immediately, so it's inert), and an `ERROR`-level
"Topic creation errors" log line on container restart when the topics already exist (kafkajs's
`admin.createTopics` already handles `TOPIC_ALREADY_EXISTS` internally and returns `false` rather than
throwing — the connection layer just logs the raw broker response first).

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

docker/
├── docker-compose.yml     broker + schema registry + producer
└── producer/              synthetic producer (own package.json/lockfile, own container)
    └── src/
        ├── produce.ts     topic creation, schema registration, the three send loops
        └── schema.ts      Avro schema + shared nested payload generator
```

Dependency versions are pinned exactly. OpenTUI is pre-1.0 and ships frequently,
so upgrades should be deliberate rather than picked up by a range.

## Conventions

- **Colors** come from `src/theme/monokai.ts` only. No hex literals in components.
- **Flex children that must keep their size** need `flexShrink: 0`, and scrolling
  or clipping containers need `overflow: "hidden"`. Without both, OpenTUI shrinks
  children toward zero and they paint over each other on small terminals.
