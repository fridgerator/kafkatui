# kafka-tui

A modern, read-only Kafka debugging TUI for application developers. Built with
[OpenTUI](https://github.com/anomalyco/opentui) + React on [Bun](https://bun.sh).

Targets AWS MSK (IAM auth) but works against any Kafka cluster.

The full specification lives in [`docs/kafka-tui-plan.md`](docs/kafka-tui-plan.md).

## Status

**All 10 planned phases are done.** The tool is feature-complete for v1: Consume, Consumer Groups, and
Topics tabs are fully live against a real broker; MSK IAM auth is implemented but ⚠️ **unverified
against a real MSK cluster** (see [MSK IAM auth](#msk-iam-auth) — this development environment had no
AWS credentials or MSK endpoint to test against); Produce is a genuinely inert, navigable form shell by
design (spec §1's own read-only non-goal for v1).

| Phase | Scope | Status |
|------:|-------|--------|
| 1 | Tab shell, theme tokens, status/hint bars | ✅ done |
| 2 | Local Kafka stack (docker-compose + synthetic producer) | ✅ done |
| 3 | Consume tab: ephemeral consumer, ring buffer, windowed list | ✅ done |
| 4 | Avro + Confluent Schema Registry | ✅ done |
| 5 | Search bar + `@filter:` query language | ✅ done |
| 6 | Message detail view | ✅ done |
| 7 | Consumer groups tab: lag, sparklines | ✅ done |
| 8 | Topics tab: metadata + config | ✅ done |
| 9 | MSK IAM auth | ✅ done (unverified against real MSK — see above) |
| 10 | Produce placeholder, NDJSON export, polish | ✅ done |

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

Per-tab keys are listed in the hint bar at the bottom of the screen. While a text input is focused
(e.g. Consume's topic field, or a Produce tab field being edited), the global shortcuts above stand
down so you can type freely — see [Conventions](#conventions).

**Consume tab:**

| Key | Action |
|---|---|
| `t` | Edit the topic name (starts blank; `Enter` connects, `Escape` cancels) |
| `e` | Toggle latest/earliest start position (applies on next connect) |
| `↑` / `↓` | Move selection; `↑` pauses the live tail, `↓` to the bottom resumes it |
| `Space` | Explicitly pause/resume following new messages |
| `c` | Clear the buffer without disconnecting |
| `x` | Export the current (filtered or full) buffer to NDJSON — see below |

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

**Message detail** — `Enter` on a selected message replaces the list with a full detail pane:
partition/offset/timestamp, the decoded key, decoded headers (`content-type`, `trace-id`, etc.), and
the payload as syntax-highlighted pretty-printed JSON where applicable (JSON's grammar is simple enough
that this is a small hand-rolled tokenizer rather than a heavier syntax-highlighting dependency — see
[Conventions](#conventions)). For Avro messages with a schema registry configured, the schema ID shows
immediately (read straight out of the wire bytes) and the subject/version fills in shortly after (a
live lookup against the registry's REST API — `SchemaRegistry`'s own client doesn't expose this
reverse lookup, so `kafka/decode/avro.ts` hits `GET /schemas/ids/{id}/versions` directly).

| Key | Action |
|---|---|
| `r` | Cycle the payload view: decoded → hex → base64 → decoded |
| `y` | Copy whatever's currently displayed to the clipboard |
| `Escape` | Close, return to the list |

Copy uses OSC 52 (if the terminal supports it — checked via `renderer.isOsc52Supported()`) or falls
back to writing `~/.kafka-tui/last-copy.txt`, per spec's own suggested fallback, with a status message
saying which happened. Copy always copies the *currently displayed* view, not always the raw bytes —
if you're looking at pretty JSON and hit `y`, you get that text; switch to the hex or base64 view first
if it's specifically the raw value you want.

Scrolling through a long payload works via the arrow keys, `j`/`k`, Page Up/Down, and Home/End — that's
OpenTUI's `<scrollbox>` handling it natively, not custom key-handling code here.

**Export to NDJSON** — `x` in the Consume tab's list view writes whatever's currently matching the
active search/filter (or the whole buffer, if none is active) to
`~/.kafka-tui/exports/<topic>-<timestamp>-<random>.ndjson`, one JSON object per line. Same
"act on what you're looking at" philosophy as `y` in the message detail view. Each line has
`topic`/`partition`/`offset`/`timestamp`/`key`/`headers`, and `value` — JSON and Avro messages keep
their real decoded structure there, plain text keeps its raw string, and anything else (binary, or an
Avro message whose registry lookup was still pending) falls back to base64 with an explicit
`valueEncoding: "base64"` field rather than silently mangling bytes into a lossy string.

**Consumer Groups tab** polls every 5 seconds and lists every real consumer group — `↑`/`↓` to select,
`Enter` to drill into members and a per-partition lag table, `Escape` to go back, `s` to toggle sorting
between lag-descending (the default, per spec's own "sort by lag to spot a stuck consumer") and
alphabetical. This tool's own Consume tab creates a throwaway `kafka-tui-<random>-<pid>` group every
time it connects (never committing offsets); those are filtered out of this list entirely rather than
cluttering it with the tool's own noise.

A group gets a `⚠ stuck` badge when its total lag has been nonzero and non-decreasing for the last 3
poll ticks (~15s) — deliberately a shorter window than the ~30-sample/2.5-minute history the sparklines
themselves show, so a genuinely stuck consumer gets flagged quickly rather than waiting for the full
trend window to fill. Switching away from the Groups tab stops polling and disconnects its admin
client entirely, the same as Consume tab's connection (see [Conventions](#conventions)) — coming back
starts fresh.

**Topics tab** lists every non-internal topic (name, partition count, replication factor) — `↑`/`↓` to
select, `Enter` to drill into a per-partition table (leader, ISR, replicas, earliest/latest offset,
message count, a live throughput sparkline) plus the full config panel, `Escape` to go back. Unlike
Groups, the list itself doesn't poll — partition count and replication factor are structural and don't
change mid-session, so switching tabs away and back is the implicit refresh; only the open detail's
topic polls, every 5 seconds, for offsets and throughput.

Internal topics (`__consumer_offsets`, `__transaction_state`, Confluent Schema Registry's `_schemas`)
are filtered out of the list — a named exclusion (`startsWith("__")` or exactly `_schemas`), not a
blanket "starts with underscore" rule, so a real user topic that happens to start with `_` still shows
up. A partition where fewer replicas are in-sync than assigned (`isr.length < replicas.length`) gets a
`⚠ under-replicated` flag in the partition table — spec §8 doesn't explicitly call this out, but it's
free on data the partition browser fetches anyway. (This single-broker local stack can't naturally
produce one; the flag's logic is verified at the unit level, not live.)

The config panel shows every entry `describeConfigs` returns (no curated allowlist) — non-default
entries first and in a distinct color, then the rest, since `isDefault: false` is a ready-made signal
for "an operator actually changed this" without hardcoding a list of "the configs that matter."

### MSK IAM auth

Set `auth.type: "iam"` on a profile (with `region`, and optionally a named `profile` for a non-default
AWS credential profile) to connect to a real MSK cluster. Under the hood, `src/kafka/client.ts` sets
`ssl: true` and `sasl: { mechanism: 'oauthbearer', oauthBearerProvider }`, where the provider comes
from `src/kafka/auth/mskIam.ts` — **not** kafkajs's built-in `sasl: { mechanism: 'aws' }`, which wants
static access keys and a broker-side LoginModule MSK doesn't run; confirmed by reading kafkajs's own
`awsIam.js` authenticator, not assumed from memory.

The token provider caches the signed token and only regenerates it once within 60 seconds of its fixed
15-minute expiry (kafkajs calls the provider fresh on every new connection's handshake, so without
caching, this app's poll-driven admin reconnects would hit AWS credential resolution far more than
necessary). Your config's `profile` field routes to a genuinely different signer function
(`generateAuthTokenFromProfile` vs. `generateAuthToken`) — see
[Conventions](#conventions) for why that split exists.

**⚠️ Not yet verified against a real MSK cluster.** This was built and unit-tested (`mskIam.test.ts`,
`client.test.ts`) with an injectable fake token source — no AWS credentials or MSK endpoint were
available in the development environment to test the actual SASL handshake, credential resolution, or
broker connectivity end-to-end. If something doesn't work against your cluster, the likely places to
look are: the exact broker port (MSK IAM is typically `9098`, not `9092`), IAM permissions for
`kafka-cluster:Connect` on the cluster/topics, and whether your credential chain (env vars, named
profile, SSO, instance role) resolves correctly outside this tool first (e.g. `aws sts
get-caller-identity`).

### Produce tab

A real, navigable, but genuinely inert form (spec §5 tab 4 — producing is an explicit v1 non-goal, per
spec §1). `↑`/`↓` moves focus between Topic/Key/Value/Partition strategy/Send — deliberately not `Tab`,
since `Tab` is already the app's global tab-switcher and claiming it here would trap you on this tab.
`Enter` on a text field opens it for editing (prefilled with its current value; `Escape` reverts
without committing); on the partition-strategy field it cycles through `Auto (default partitioner)` and
`Manual: partition 0..3`; on Send it shows the same "not yet implemented" message the tab's header
already states — a real, focusable, but inert control, not just decoration. This locks in the
interaction shape (not just the visual layout) for a future pass to wire up an actual producer without
redesigning the screen.

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

Each topic has 4 partitions and a random key per message, so there's real data for the Topics tab's
partition/throughput view and the `@filter:` nested-path examples.

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
│   ├── client.ts          createKafkaClient(profile) — "none" and "iam" implemented, sasl-scram/sasl-plain stubbed
│   ├── KafkaClientContext.tsx       shared Kafka client instance for all tabs
│   ├── SchemaRegistryContext.tsx    shared SchemaRegistry instance, null if unconfigured
│   ├── consume.ts         ephemeral no-commit consumer wrapper
│   ├── groups.ts          describeGroups/fetchOffsets orchestration + pure lag math (unit tested against the real broker)
│   ├── topics.ts          listTopics/fetchTopicMetadata/describeConfigs orchestration + isInternalTopic/isUnderReplicated (unit tested against the real broker)
│   ├── auth/
│   │   └── mskIam.ts      SASL/OAUTHBEARER token provider for MSK IAM auth — caching/early refresh, injectable token source (unit tested with a fake source; not yet tested against real MSK)
│   └── decode/
│       ├── decodeMessage.ts   sync dispatch: JSON → text → hex, never throws
│       ├── avro.ts            async Avro decode + circuit breaker (unit tested against the real registry)
│       └── hexDump.ts
├── buffer/
│   └── ringBuffer.ts      seq-anchored circular buffer (unit tested)
├── filter/
│   ├── parseFilter.ts     `@filter:` tokenizer + recursive-descent parser (unit tested)
│   └── evaluateFilter.ts  existential path resolution + operator dispatch (unit tested)
├── export/
│   └── ndjson.ts          toNdjsonRecord/toNdjson (pure) + writeNdjsonExport (thin fs shell, unit tested against the real ~/.kafka-tui/exports)
└── components/
    ├── StatusBar.tsx      profile, connection state, topic
    ├── TabBar.tsx         tab strip + TabId definitions
    ├── HintBar.tsx        context-sensitive keybinding hints
    ├── SearchBox.tsx      the search/filter input (mode + draft/commit state live in ConsumeTab)
    ├── Sparkline.tsx      sparklineChars() (pure, unit tested) + a thin <Sparkline> wrapper
    ├── consume/
    │   ├── ConsumeTab.tsx     owns the ring buffer, flush timer, viewport/selection state, live filtering
    │   ├── TopicBar.tsx       topic-name input + latest/earliest toggle
    │   ├── MessageList.tsx    pure presentational, renders exactly rowCount rows, substring highlighting
    │   └── MessageDetail.tsx  full pretty-print/hex/base64 view; owns its own useKeyboard (mount-scoped)
    ├── groups/
    │   ├── GroupsTab.tsx      owns the 5s poll, per-group/per-partition lag history, sort/select
    │   └── GroupDetail.tsx    members + per-partition lag table; owns its own useKeyboard (mount-scoped)
    ├── topics/
    │   ├── TopicsTab.tsx      lists non-internal topics; no polling (structural metadata, not lag)
    │   └── TopicDetail.tsx    partition table + config panel + throughput sparklines; owns its own useKeyboard (mount-scoped), 5s poll for the open topic only
    └── produce/
        └── ProduceTab.tsx     navigable but genuinely inert form shell (read-only in v1) — field focus/edit/cycle state machine, disabled Send

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
- **A component that's only ever mounted while its own mode is active can own
  its own `useKeyboard`, without a mode check inside it.** `MessageDetail` is
  the example — mounting/unmounting *is* the scope guard. Contrast with
  `TopicBar`/`SearchBox`, which are always mounted and need `ConsumeTab` to
  arbitrate their keys centrally via `mode`.
- **A pure grammar (JSON, in this case) is cheaper to hand-roll than to pull
  in a general-purpose highlighter for.** `MessageDetail`'s JSON
  tokenizer/highlighter is a small recursive function producing colored
  `<span>`s — no new dependency, versus OpenTUI's tree-sitter-backed `<code>`
  component, which needs a `syntaxStyle` and a grammar for something this
  simple and fully known ahead of time.
- **Split I/O-driven modules into a pure core + a thin async shell.**
  `groups.ts`'s `computeGroupSnapshot()` takes already-fetched data and does
  the lag math with no network calls at all, fully unit-testable with
  fabricated inputs; `fetchGroupSnapshots()` is the thin wrapper that makes
  the real `describeGroups`/`fetchOffsets`/`fetchTopicOffsets` calls and
  hands their results to it. Same split as `parseFilter`/`evaluateFilter`
  and the decode/network boundary in `avro.ts`.
- **A `deleteGroups()` call immediately after `consumer.disconnect()` can
  transiently fail** — confirmed empirically while cleaning up this phase's
  own test fixtures — before the group coordinator finishes processing the
  `LeaveGroup`. `groups.test.ts`'s cleanup retries once after a short delay
  rather than assuming the first attempt succeeded.
- **`aws-msk-iam-sasl-signer-js`'s `generateAuthToken({ region, awsProfileName })` silently
  ignores `awsProfileName`** — confirmed by reading the compiled package, not its README's type
  signature. A named credential profile only takes effect via the separate
  `generateAuthTokenFromProfile({ region, awsProfileName })` function. `mskIam.ts` branches on
  `auth.profile` to call the right one; passing a profile name as an option to the wrong function
  would silently fall back to the default credential chain instead of erroring.
