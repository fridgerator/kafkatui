# Kafka TUI — Project Plan

A modern, read-only Kafka debugging TUI for application developers, built with
OpenTUI + React, targeting AWS MSK (IAM auth) but usable against any Kafka
cluster. This document is the spec to hand to Claude Code to scaffold and
build the project.

---

## 1. Goals & Non-Goals

**Goals (v1, read-only):**
- Consume messages from a topic without creating a consumer group (no offset
  commits, ephemeral position only)
- Decode JSON, Avro (via Confluent Schema Registry), and raw text/bytes
- Fast, memory-safe rendering of high-throughput topics via a windowed/lazy
  buffer
- One search box supporting both raw substring search and a structured
  `@filter:` query language for nested key/value matching
- Inspect consumer group state: members, partition assignment, lag per
  partition, lag trend over time
- Placeholder "Produce" tab (UI shell, disabled actions, clearly marked
  "coming soon")
- Sleek, modern terminal UI, Monokai-inspired theme, sparkline graphs where
  they add signal
- Local docker-compose environment with a synthetic message producer for dev/testing

**Explicit non-goals for v1:**
- No cluster administration (no topic create/delete/reassign, no ACL
  management, no config changes)
- No committing offsets / joining real consumer groups as a member
- No message production (stubbed only)
- No multi-user/server mode — this is a local, single-operator CLI tool

---

## 2. Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Bun (required by OpenTUI's build/dev flow) |
| Language | TypeScript |
| TUI engine | `@opentui/core` + `@opentui/react` |
| Kafka client | `kafkajs` |
| MSK IAM auth | `aws-msk-iam-sasl-signer-js` + KafkaJS custom `authenticationProvider` (see §4) |
| AWS credentials | AWS SDK v3 default credential provider chain (`@aws-sdk/credential-providers`), with optional named-profile override |
| Schema Registry | Confluent Schema Registry — `@kafkajs/confluent-schema-registry` |
| Avro decoding | via the above (wraps `avsc`) |
| Config | Local YAML file, multiple named cluster profiles |
| State mgmt | React state/context; no external state library needed at this scale |
| Local dev broker | `docker-compose` running Kafka (KRaft mode, no ZooKeeper) + a synthetic producer container |

---

## 3. Configuration

A local YAML config file (default path `~/.kafka-tui/config.yaml`, override
via `--config <path>`), supporting multiple named cluster profiles:

```yaml
profiles:
  - name: dev-local
    brokers:
      - localhost:9092
    auth:
      type: none          # none | iam | sasl-scram | sasl-plain
    schemaRegistry:
      url: http://localhost:8081

  - name: staging-msk
    brokers:
      - b-1.mycluster.abc123.kafka.us-east-1.amazonaws.com:9098
    auth:
      type: iam
      region: us-east-1
      profile: staging     # optional named AWS profile; omit to use default chain
    schemaRegistry:
      url: https://schema-registry.internal.example.com
      auth:
        username: ${SCHEMA_REGISTRY_USER}   # env var interpolation supported
        password: ${SCHEMA_REGISTRY_PASS}

defaultProfile: dev-local
```

- Support `${ENV_VAR}` interpolation for secrets (never store plaintext
  credentials for schema registry basic auth in the file if avoidable).
- In-app profile picker is a stretch goal (not v1) — v1 selects profile via
  `--profile <name>` flag or `defaultProfile`, but design the config loader
  so a future in-app switcher is trivial to add (i.e., config load produces a
  list of profiles the UI layer already has available).

---

## 4. MSK IAM Authentication — Critical Implementation Note

**Do not use KafkaJS's built-in `sasl: { mechanism: 'aws' }`.** That
mechanism expects static `accessKeyId`/`secretAccessKey`/`sessionToken` and
requires a third-party SASL LoginModule (STACK's
`kafka-auth-aws-iam`) installed on the brokers — it is unrelated to how MSK
actually implements IAM auth, and it will not work against a real MSK
cluster.

The correct approach for MSK IAM auth with KafkaJS is:

1. Use `aws-msk-iam-sasl-signer-js` (AWS's own SigV4 token signer for MSK) to
   generate a short-lived auth token from the ambient AWS credentials
   (default credential provider chain — env vars, shared config/profile,
   SSO, EC2/ECS role, etc.).
2. Wire that signer into KafkaJS via its `sasl.mechanism: 'oauthbearer'` +
   custom `oauthBearerProvider`, OR via KafkaJS's documented
   "Custom Authentication Mechanisms" plugin hook
   (`authenticationProvider`), whichever the signer library's published
   integration example uses at implementation time — Claude Code should
   check the current `aws-msk-iam-sasl-signer-js` README/examples during
   implementation, since the exact glue code is a small, well-documented
   snippet that may have shifted.
3. The signer must be re-invoked per-connection/on token refresh — MSK IAM
   auth tokens are short-lived (expire in minutes), so this is not a
   one-time token fetch at startup.
4. Broker port for MSK IAM is typically `9098` (SASL_SSL), not the plaintext
   `9092` — TLS must be enabled (`ssl: true`) alongside this auth mode.

Build this as an isolated module (`src/kafka/auth/mskIam.ts`) with a clean
interface so it's easy to unit-test/mock and swap out if the signer library's
API changes.

---

## 5. Application Structure (Tabbed Interface)

A tabbed layout, switchable via number keys (`1`–`4`) or arrow/Tab
navigation, with a persistent top status bar and bottom keybinding hint bar
(similar to k9s/lazydocker conventions).

```
┌─────────────────────────────────────────────────────────────┐
│ ● staging-msk   Topic: orders.events   Consumer Group: —    │  ← status bar
├─────────────────────────────────────────────────────────────┤
│ [1] Consume  [2] Groups  [3] Topics  [4] Produce             │  ← tabs
├─────────────────────────────────────────────────────────────┤
│                                                               │
│                     (active tab content)                     │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│ /search  @filter:...   ↑↓ scroll  Enter inspect  q quit       │  ← hint bar
└─────────────────────────────────────────────────────────────┘
```

### Tab 1 — Consume
The core feature. See §6.

### Tab 2 — Consumer Groups
- List all consumer groups (admin `listGroups` / `describeGroups`)
- Per-group: members, host, client-id, assigned partitions
- Per-partition: current offset, log-end offset (high-water mark), **lag**
- Lag sparkline per partition (rolling window, polled on an interval, e.g.
  every 5–10s) so the user can see whether lag is growing, shrinking, or flat
- Aggregate lag-over-time sparkline per consumer group (sum across
  partitions)
- Sort/filter by lag descending to quickly spot a stuck consumer

### Tab 3 — Topics / Cluster Metadata (read-only inspection)
See §8 for the full list of suggested additions — this tab absorbs most of
them.

### Tab 4 — Produce (placeholder)
- Static form UI: topic selector, key input, value input (JSON/text),
  partition/key-strategy selector
- "Send" button present but disabled, with a tooltip/status text: "Producing
  is not yet implemented"
- Purpose: lock in the UI shape now so a future pass can wire up real
  producer logic without redesigning the screen

---

## 6. Consume Tab — Detailed Spec

### 6.1 Connection model
- No consumer group — use the plain `consumer` API with a random/ephemeral
  `groupId` that is never persisted, OR use KafkaJS's lower-level assignment
  via manual partition assignment (`consumer.assign` is not directly
  exposed by KafkaJS's high-level API — in practice this means: create a
  consumer with a throwaway groupId like `kafka-tui-<random>-<pid>`, subscribe
  with `fromBeginning` or "latest" per user choice, and treat it as fully
  disposable — never commit offsets, disconnect and discard the group on
  tab exit). Claude Code should confirm this is the cleanest way to get
  "browse without joining a durable group" semantics in KafkaJS, since
  KafkaJS's public API is oriented around consumer groups.
- Let the user pick start position: **Latest** (tail new messages) or
  **Earliest** (from beginning), plus optionally "from timestamp" as a
  stretch goal.
- Support pause/resume of the live tail (spacebar) without disconnecting.

### 6.2 Decoding pipeline
- Per-topic (or per-message, via magic-byte sniffing) decode strategy:
  - **Confluent wire-format Avro**: first byte `0x0`, next 4 bytes = schema
    ID → fetch schema from Confluent Schema Registry (cache schemas by ID,
    LRU or unbounded-for-session since schema counts are small), decode with
    `@kafkajs/confluent-schema-registry`.
  - **JSON**: attempt `JSON.parse`; on failure, fall through to text.
  - **Text**: UTF-8 decode with a fallback to hex/base64 display for
    non-printable payloads.
- Decode failures must never crash the render loop — show a clear
  "⚠ decode error" inline with a way to view raw bytes (hex dump) for that
  message.
- Headers should be decoded and viewable too (Kafka record headers are
  common for trace IDs, content-type, etc.) — show them in a message detail
  view.

### 6.3 The buffer / lazy renderer (critical for perf)
This is the most important non-obvious engineering constraint. Requirements:
- Maintain a **ring buffer** of the last N raw messages (N configurable,
  default e.g. 5,000), not an ever-growing array — old messages fall off
  once the cap is hit (raw bytes + minimal parsed metadata retained; full
  decoded/pretty-printed representation should be computed lazily, not
  precomputed for every incoming message).
- The visible list is **virtualized**: only rows actually visible in the
  viewport (plus a small overscan buffer) are decoded/formatted/rendered.
  Scrolling triggers on-demand decode of the newly visible slice.
- Incoming message ingestion (network/consumer callback) must be decoupled
  from render: batch incoming messages and flush to the ring buffer + trigger
  a re-render on a throttle (e.g. max 10–20 UI updates/sec), not one React
  state update per message. At high throughput this is the difference
  between a usable and unusable TUI.
- Filtering/search (see §6.4) operates over the ring buffer's retained
  window, not the full topic history — make this limitation visible to the
  user (e.g. "searching last 5,000 buffered messages" in the status bar).
- Expose buffer size and current fill level, and let the user clear the
  buffer without disconnecting.

### 6.4 Search / Filter bar
Single input box, two modes auto-detected by prefix:

**Raw substring mode** (default): typing `my little pony` does a
case-insensitive substring match against the message's decoded string
representation (JSON messages matched against their serialized form).

**Structured filter mode**: input beginning with `@filter:` switches to a
small nested-path query language. Syntax:

```
@filter: my.nested[].key = "my little pony"
@filter: user.roles[] contains "admin"
@filter: metadata.retryCount > 3
@filter: headers.contentType = "application/json"
```

Design notes for Claude Code:
- `a.b.c` = simple nested key path.
- `a.b[].c` = "for any element in array `a.b`, does that element's `.c` match"
  (existential — matches if *any* array element satisfies the condition).
  This must support arrays of objects (`.c` further nested) and arrays of
  scalars (omit the trailing `.c`, e.g. `roles[] contains "admin"`).
- Support operators: `=` (exact match, string/number/bool), `!=`, `contains`
  (substring, for strings; membership, for arrays), `>` `<` `>=` `<=` (numeric
  comparison), and maybe `~=` for regex as a stretch goal.
- Values: quoted strings, bare numbers, `true`/`false`, `null`.
- Parse this with a small hand-rolled recursive-descent parser or a tiny
  grammar library — this does not need a heavyweight parser generator, but it
  should be a clean, testable module (`src/filter/parseFilter.ts`) separate
  from the UI, with unit tests covering nested arrays-of-objects,
  arrays-of-scalars, and multiple predicates.
- **Stretch goal:** allow chaining predicates with `AND`/`OR`
  (`@filter: a.b = 1 AND c.d contains "x"`) — flag this as v1.1 if it adds
  too much complexity to ship v1 on time.
- Filtering re-runs live against the buffer as new messages arrive (i.e., act
  as a live view filter, not a one-shot search), and against the currently
  buffered window when first typed.
- Show a match count and highlight the matched substring/field in the
  message list.

### 6.5 Message detail view
Selecting a message (Enter) opens a detail pane/modal:
- Pretty-printed payload (syntax-highlighted JSON where applicable)
- Partition, offset, timestamp, key (decoded same as value), headers
- Schema ID + subject/version (for Avro messages)
- Raw hex/base64 toggle
- Copy-to-clipboard for the raw value (OSC 52 or similar terminal clipboard
  escape, if OpenTUI supports it — check during implementation; otherwise
  write-to-file as a fallback)

---

## 7. Visual Design

- **Theme**: Monokai-inspired dark palette — near-black background
  (`#272822`-ish), soft off-white foreground, and Monokai's signature accent
  set (pink/magenta `#F92672` for errors/highlights, green `#A6E22E` for
  success/positive lag-trend-down, yellow `#E6DB74` for strings/warnings,
  blue `#66D9EF` for keys/types, orange `#FD971F` for numbers). Define this
  as a single theme/tokens module (`src/theme/monokai.ts`) so every component
  pulls colors from one place — no hardcoded hex codes scattered through
  components.
- Rounded/clean box borders, consistent padding, clear focus indicators
  (highlighted border or background on the focused pane) — OpenTUI's flexbox
  layout and styling props should make this straightforward; consult
  OpenTUI's docs/skill for exact border-style and focus-ring APIs during
  implementation.
- Sparklines: implement as a small reusable component
  (`<Sparkline values={number[]} />`) rendered with Unicode block characters
  (▁▂▃▄▅▆▇█) or braille-based density characters for a smoother look — used
  for per-partition lag trend, consumer-group aggregate lag trend, and
  (optionally) message throughput (msgs/sec) in the Consume tab's status
  bar.
- Status bar always shows: active profile name, connection state (●
  green/red/yellow dot), current topic, buffer fill, and a live throughput
  sparkline while consuming.
- Keybinding hint bar at the bottom, context-sensitive per tab (like
  k9s/lazygit) — this is a strong, well-understood pattern for "modern TUI"
  and should be leaned on rather than reinvented.

---

## 8. Suggested Additional Observability Features

Beyond what was requested, these are high-value for a dev debugging Kafka
day-to-day, roughly in priority order:

1. **Topic metadata / partition browser** — partition count, replication
   factor, per-partition leader/ISR (in-sync replica) state, and per-partition
   earliest/latest offset (so a dev can see "how much data is actually in
   this topic" without consuming it).
2. **Topic config inspection** (read-only) — `retention.ms`,
   `cleanup.policy`, `max.message.bytes`, `min.insync.replicas`, etc. via
   `describeConfigs`. Extremely useful for "why did my message get GC'd" or
   "why is production behaving differently than staging" debugging.
3. **Consumer group "stuck/idle" detection** — flag groups where lag is
   nonzero but not decreasing over the polling window (possible dead
   consumer), surfaced as a visual warning badge in the Groups tab.
4. **Per-partition throughput and skew view** — messages/sec per partition,
   to catch a hot/skewed partition key (common real-world issue: one
   partition getting 90% of traffic due to a bad partition key choice).
5. **Under-replicated / offline partition indicator** — even in a "no
   admin" tool, surfacing "this partition currently has no in-sync replicas"
   as a red flag is valuable, read-only, diagnostic signal (MSK generally
   manages this, but visibility still helps triage "is this an MSK problem or
   my app").
6. **Schema Registry browser** — list subjects, versions, and compatibility
   mode for a subject; view a schema's fields directly, useful when a
   consumer's decode is failing and the dev wants to check "what does the
   registry currently think this schema looks like."
7. **DLQ / retry-topic quick-jump** — if the org follows a `topic.DLQ` or
   `topic-retry` naming convention, a quick "jump to related topic" action
   from the Consume tab (configurable naming pattern in config.yaml, not
   hardcoded).
8. **Cluster/broker overview** — broker count, controller broker, per-broker
   partition count (rough load balance indicator) — this is metadata-only,
   no admin actions, so it fits the read-only constraint.
9. **Export buffered messages to a file** (NDJSON) for offline analysis —
   pairs naturally with the ring-buffer/search feature already being built.
10. **Saved filters** — let the user save a named `@filter:` expression per
    topic in the config file for quick recall (e.g. "errors-only" filter
    reused across sessions).

Recommend v1 includes #1, #2, #3, #4, and #9 (all natural extensions of work
already being done for Groups/Topics/Consume tabs); treat #6, #7, #8, #10 as
v1.1/backlog.

---

## 9. Local Development Environment

`docker-compose.yml` providing:
- A single-node Kafka broker in **KRaft mode** (no ZooKeeper needed) — use
  the official `apache/kafka` image or `confluentinc/cp-kafka` in KRaft mode
  (Claude Code should pick whichever has the simplest KRaft single-node
  compose recipe at implementation time).
- A **Confluent Schema Registry** container, pointed at the broker, so the
  TUI's Avro path is exercisable locally.
- A small **synthetic producer** service (Node/Bun script in its own
  Dockerfile) that continuously produces a mix of:
  - Plain JSON messages (e.g. fake "order" events)
  - Avro-encoded messages registered against the local schema registry
  - Plain text messages
  - Configurable rate (msgs/sec) via env var, including a "burst mode" to
    stress-test the ring buffer/virtualized rendering
  - Nested objects and arrays in the payload (so `@filter:` nested-path
    queries have realistic data to test against — e.g. `order.items[].sku`,
    `order.customer.address.zip`)
- A `.env.example` / `config.yaml` profile pre-wired to point at this local
  stack (`dev-local` profile from §3), so `docker compose up` + `bun run
  dev --profile dev-local` is a working end-to-end loop with zero AWS
  dependency.

---

## 10. Suggested Project Structure

```
kafka-tui/
├── docker/
│   ├── docker-compose.yml
│   └── producer/                 # synthetic message generator
│       ├── Dockerfile
│       └── src/produce.ts
├── src/
│   ├── app.tsx                   # root component, tab router
│   ├── theme/
│   │   └── monokai.ts
│   ├── config/
│   │   ├── loadConfig.ts
│   │   └── types.ts
│   ├── kafka/
│   │   ├── client.ts              # KafkaJS client factory per profile
│   │   ├── auth/
│   │   │   └── mskIam.ts          # §4
│   │   ├── consume.ts             # ephemeral/no-group consumer wrapper
│   │   ├── groups.ts              # describeGroups/lag polling
│   │   ├── topics.ts              # metadata/config describe
│   │   └── decode/
│   │       ├── decodeMessage.ts   # dispatch: json/avro/text
│   │       ├── avro.ts            # schema registry client + cache
│   │       └── hexDump.ts
│   ├── filter/
│   │   ├── parseFilter.ts         # @filter: grammar
│   │   ├── evaluateFilter.ts
│   │   └── parseFilter.test.ts
│   ├── buffer/
│   │   └── ringBuffer.ts          # generic capped ring buffer + windowed view
│   ├── components/
│   │   ├── StatusBar.tsx
│   │   ├── TabBar.tsx
│   │   ├── HintBar.tsx
│   │   ├── Sparkline.tsx
│   │   ├── SearchBox.tsx
│   │   ├── consume/
│   │   │   ├── ConsumeTab.tsx
│   │   │   ├── MessageList.tsx    # virtualized list
│   │   │   └── MessageDetail.tsx
│   │   ├── groups/
│   │   │   └── GroupsTab.tsx
│   │   ├── topics/
│   │   │   └── TopicsTab.tsx
│   │   └── produce/
│   │       └── ProduceTab.tsx     # placeholder
│   └── index.ts                  # entrypoint, createCliRenderer + createRoot
├── package.json
├── tsconfig.json
└── README.md
```

---

## 11. Build Phases (recommended order for Claude Code)

1. **Scaffold**: Bun project, OpenTUI + React wired up, tab shell with
   static placeholder content in each tab, theme tokens applied, status/hint
   bars in place. Verify `bun run dev` renders and tab-switching works before
   anything else.
2. **Local Kafka stack**: docker-compose + synthetic producer, confirm
   producing/consuming works with plain `kafkajs` against the local broker
   (no TUI yet — a throwaway script is fine to validate this layer).
3. **Consume tab core**: ephemeral consumer, ring buffer, virtualized
   list, plain JSON/text decode. Get this feeling smooth against the local
   burst-mode producer before adding Avro/IAM complexity.
4. **Avro + Schema Registry**: wire in `@kafkajs/confluent-schema-registry`
   against the local registry container.
5. **Search/filter bar**: raw substring mode first, then `@filter:` parser +
   evaluator with unit tests, then wire into the live list.
6. **Message detail view**.
7. **Groups tab**: describeGroups, lag computation, polling, sparklines.
8. **Topics tab**: metadata + config describe, partition browser.
9. **MSK IAM auth module**: build and test against a real (or staging) MSK
   cluster last, once everything works locally — this isolates AWS-specific
   debugging from the rest of the app logic.
10. **Produce tab placeholder + export-to-file + polish pass** (colors,
    spacing, keybinding consistency, README).

---

## 12. Open Questions to Resolve Before/During Implementation

These weren't blocking for this plan but Claude Code should confirm early,
since they affect low-level implementation details:

- OpenTUI's exact virtualized/scrollable-list primitive and focus-management
  API (the plan assumes a scroll box + manual windowing exists or can be
  built on top of what OpenTUI exposes — confirm via the OpenTUI skill/docs).
- Whether OpenTUI has any clipboard integration (for "copy raw message"), or
  whether that needs an OSC 52 escape sequence written manually.
- Current recommended integration snippet for
  `aws-msk-iam-sasl-signer-js` + KafkaJS (oauthbearer vs. custom
  authenticationProvider) — check the signer library's own docs/examples at
  implementation time rather than assuming.
- Node/Bun compatibility of `@kafkajs/confluent-schema-registry` and `avsc`
  under Bun's runtime (should be fine, but worth a smoke test early since
  the whole project is Bun-first).
