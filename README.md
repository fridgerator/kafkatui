# kafka-tui

A modern, read-only Kafka debugging TUI for application developers. Built with
[OpenTUI](https://github.com/anomalyco/opentui) + React on [Bun](https://bun.sh).

Targets AWS MSK (IAM auth) but works against any Kafka cluster.

The full specification lives in [`docs/kafka-tui-plan.md`](docs/kafka-tui-plan.md).

## Status

**Phase 5 of 10 — search/filter bar.** One input, two modes: case-insensitive substring search, or a
structured `@filter:` nested-path query language, both live-as-you-type against the buffer.

| Phase | Scope | Status |
|------:|-------|--------|
| 1 | Tab shell, theme tokens, status/hint bars | ✅ done |
| 2 | Local Kafka stack (docker-compose + synthetic producer) | ✅ done |
| 3 | Consume tab: ephemeral consumer, ring buffer, windowed list | ✅ done |
| 4 | Avro + Confluent Schema Registry | ✅ done |
| 5 | Search bar + `@filter:` query language | ✅ done |
| 6 | Message detail view | not started |
| 7 | Consumer groups tab: lag, sparklines | not started |
| 8 | Topics tab: metadata + config | not started |
| 9 | MSK IAM auth | not started |
| 10 | Produce placeholder, NDJSON export, polish | not started |

## Requirements

- **Bun** ≥ 1.4 (`curl -fsSL https://bun.sh/install | bash`)
- A terminal with 256-color or truecolor support

## Getting started

Bring up the [local Kafka stack](#local-kafka-stack) first, then:

```sh
bun install
bun run dev -- --config config.example.yaml
```

`--config <path>` (default `~/.kafka-tui/config.yaml`) and `--profile <name>` (default: the config's
`defaultProfile`) select which cluster to connect to (spec §3). A bad config, unknown profile, or
missing `${ENV_VAR}` fails fast with a plain error on stderr before the TUI starts.

### Keybindings

| Key | Action |
|---|---|
| `1` – `4` | Jump to tab |
| `Tab` / `Shift+Tab` | Cycle tabs |
| `q` / `Ctrl+C` | Quit |

Per-tab keys are listed in the hint bar at the bottom of the screen. Keys shown
there for unbuilt features are advertised but not yet wired up. While a text
input is focused (e.g. Consume's topic field), the global shortcuts above
stand down so you can type freely — see [Conventions](#conventions).

**Consume tab:**

| Key | Action |
|---|---|
| `t` | Edit the topic name (starts blank; `Enter` connects, `Escape` cancels) |
| `e` | Toggle latest/earliest start position (applies on next connect) |
| `↑` / `↓` | Move selection; `↑` pauses the live tail, `↓` to the bottom resumes it |
| `Space` | Explicitly pause/resume following new messages |
| `c` | Clear the buffer without disconnecting |

Switching to another tab disconnects the ephemeral consumer; returning to Consume starts fresh
(re-enter the topic). This is a deliberate v1 simplification, not a bug — see the plan notes if you
want tails to persist across tabs.

**Avro decode**: `orders.avro` (or any topic with Confluent wire-format messages) decodes into the
same JSON-preview format as plain JSON topics, as long as the profile has `schemaRegistry` configured
(spec §3). Without one configured, or if the registry is unreachable, it falls back to a hex/binary
preview with a clear reason rather than crashing — a small circuit breaker stops hammering a dead
registry with an HTTP call per message after 5 consecutive failures, retrying again after 30s.

**Search / filter** — `/` opens the search box, prefilled with whatever's currently applied (refining
an existing search is the common case, unlike the topic field which always starts blank). It updates
live as you type; `Enter` commits, `Escape` reverts to whatever was last committed rather than
discarding a working query. Submitting an empty query clears filtering.

Plain text does a case-insensitive substring match against each message's full decoded body (not the
truncated list-row preview — a match past the 200-char display cutoff still counts). Text starting
with `@filter:` switches to a structured nested-path query:

```
@filter: items[].sku = "WIDGET-001"
@filter: customer.roles[] contains "admin"
@filter: metadata.retryCount > 3
```

`a.b.c` is a plain nested path; `a.b[].c` existentially matches if *any* element of array `a.b` has
that shape (works for arrays of objects and, by omitting the trailing key, arrays of scalars).
Operators: `=`, `!=`, `contains` (substring for a string candidate, membership for an array
candidate), `>`, `<`, `>=`, `<=`, and `~=` for a regex match. Values are double-quoted strings, bare
numbers, `true`/`false`, or `null`. **`AND`/`OR` chaining isn't supported yet** — one predicate per
query, per the spec's own allowance to defer it; a malformed or incomplete expression shows a clear
parse error and falls back to the unfiltered view rather than freezing on a stale one. `@filter:` only
ever matches JSON-decoded messages (including Avro, once decoded) — it's a no-op against plain text.

Enabling either search mode means the whole retained buffer gets decoded and scanned on every new
message (not just what's on screen) — the match count and "searching last N buffered" note in the
status line make that scope visible, matching spec §6.3's guidance for the ring buffer's own limits.

### Scripts

| Script | Purpose |
|---|---|
| `bun run dev` | Run the TUI |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Unit tests — ring buffer, decode dispatch, config loader, Avro (needs the local stack up; skips cleanly otherwise) |

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
`dev-local` profile in [`config.example.yaml`](config.example.yaml) exactly, so
`docker compose up -d` + `bun run dev -- --config config.example.yaml` is a working end-to-end loop
with zero AWS dependency. Any other Kafka client (`kcat -b localhost:9092 -t orders.json -C`, etc.)
can also point at those addresses directly.

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
├── index.tsx              entrypoint: loads config, builds the Kafka client, then boots the renderer
├── app.tsx                root component, tab routing, global keybindings (gated on inputActive)
├── theme/monokai.ts       all color tokens (the only file with hex literals)
├── config/
│   ├── types.ts           ClusterProfile / AuthConfig / KafkaTuiConfig (spec §3)
│   └── loadConfig.ts      --config/--profile flags, YAML parse, ${ENV_VAR} interpolation
├── kafka/
│   ├── types.ts           RawMessage, BufferedMessage, ConnectionState, getOrDecode(), getSearchableText()
│   ├── client.ts          createKafkaClient(profile) — "none" auth implemented, others stubbed
│   ├── KafkaClientContext.tsx       shared Kafka client instance for all tabs
│   ├── SchemaRegistryContext.tsx    shared SchemaRegistry instance, null if unconfigured
│   ├── consume.ts         ephemeral no-commit consumer wrapper
│   └── decode/
│       ├── decodeMessage.ts   sync dispatch: JSON → text → hex, never throws
│       ├── avro.ts            async Avro decode + circuit breaker (unit tested against the real registry)
│       └── hexDump.ts
├── buffer/
│   └── ringBuffer.ts      seq-anchored circular buffer (unit tested)
├── filter/
│   ├── parseFilter.ts     `@filter:` tokenizer + recursive-descent parser (unit tested)
│   └── evaluateFilter.ts  existential path resolution + operator dispatch (unit tested)
└── components/
    ├── StatusBar.tsx      profile, connection state, topic
    ├── TabBar.tsx         tab strip + TabId definitions
    ├── HintBar.tsx        context-sensitive keybinding hints
    ├── SearchBox.tsx      the search/filter input (mode + draft/commit state live in ConsumeTab)
    ├── consume/
    │   ├── ConsumeTab.tsx     owns the ring buffer, flush timer, viewport/selection state, live filtering
    │   ├── TopicBar.tsx       topic-name input + latest/earliest toggle
    │   └── MessageList.tsx    pure presentational, renders exactly rowCount rows, substring highlighting
    ├── groups/            Consumer Groups tab (placeholder — phase 7)
    ├── topics/            Topics / cluster metadata tab (placeholder — phase 8)
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
- **`useKeyboard` is one global subscription**, not scoped to whatever has
  `focused`. Any component with a text input must report that up via a lifted
  `inputActive`-style boolean so `app.tsx`'s global digit/Tab/`q` handler can
  stand down — otherwise typing into a field also switches tabs or quits.
- **A ring-buffer/list row must always render as exactly one terminal row.**
  Every message row needs `wrapMode: "none"` and `truncate` — the whole
  manual-windowing scheme (`rowCount` rows ↔ `rowCount` ring-buffer entries)
  silently breaks the moment one row wraps to two lines.
- **Measure available rows via `onSizeChange` on a ref, not hardcoded chrome
  arithmetic.** See `ConsumeTab.tsx` — robust to any future change in the
  surrounding StatusBar/TabBar/HintBar heights.
- **Decode work that needs I/O (Avro's schema fetch) can't happen inline in a
  render function.** It's kicked off eagerly in `ConsumeTab`'s flush-drain
  loop instead — still off the render path — with a synchronous `"pending"`
  placeholder set first, and the real result (plus a `tick` bump to
  re-render) applied when the promise resolves. `decodeMessage()` itself
  stays fully synchronous and pure.
- **Search/filter state must never appear in the consumer-connect effect's
  dependency array.** Typing a query re-renders `ConsumeTab`, but it must not
  disconnect and reconnect the consumer — the flush loop reads the current
  matcher through a ref (`matcherRef`, mirrored from state via its own
  effect), the same pattern already used for `followingRef`/`rowCountRef`.
- **Full-body search reads raw bytes or the decoded value, never
  `decoded.preview`.** The preview is truncated to 200 chars for the list
  row; searching against it would silently miss real matches past that
  point. See `getSearchableText()` in `kafka/types.ts`.
