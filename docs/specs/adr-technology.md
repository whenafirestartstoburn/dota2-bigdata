# ADR: technology choices

Status: **Accepted**  
Date: 2026-08-30

Companions: [`data-schema.md`](./data-schema.md) (what we store), [`worker-architecture.md`](./worker-architecture.md) (how collection is split). This record is **why those stores and runtimes**, not the column list.

## Context

dota2-collector ingests professional / league Dota 2 matches: live scoreboard ticks, post-match details, Game Coordinator replay locators, `.dem.bz2` bytes, and parsed event timelines. Constraints that actually bite:

- Steam Web API is **1 request/second per key**. Live and historical must share that budget without a second broker.
- Replay salt comes from the Dota **Game Coordinator**, not HTTP. That needs a Steam client session, proxies, and a different account pool than Web API keys.
- Live ticks and combat logs are **append-only and huge**. Match identity, cursors, and “where is this replay?” are **mutable and small**.
- Re-parse must be possible without Valve still hosting the file. The `.dem.bz2` is the source of truth for events.
- One operator should be able to answer “what is match X?” with ordinary SQL. JSON blobs as source of truth are out ([`data-schema.md`](./data-schema.md)).
- Collection must keep running if the HTTP API is down.

The monorepo started from an internal Bun template (`api`, `shared`, `cli`, `worker`). Domain choices below override the template defaults where they disagreed (postgres.js, pgtyped, codegen).

## Decision drivers

1. Prefer runtime builtins and SQL the operator can read over extra daemons.
2. Keep DDL in files dbmate applies, not in the process that also polls Steam.
3. Put high-volume appends where codecs and partitions help; put locks and upserts where `FOR UPDATE` works.
4. Domain async is `async`/`await` and `Promise`. No Effect or Result runtime.
5. Rejected alternatives are listed so the next session does not re-open them from chat.

---

## Runtime and language

**Decision:** [Bun](https://bun.sh) + TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Packages under `packages/*`, scope `@app`.

**Why.** HTTP, SQL, file, spawn, and hash are used on the collect path. Bun’s `Bun.serve`, `Bun.SQL`, `Bun.file`, `Bun.spawn`, `Bun.CryptoHasher` are the APIs we call, not wrappers around Node. One runtime for api, worker, and CLI avoids a second package manager and a compile step before `bun packages/worker/src/app.ts`.

**Rejected.** Node + `pg` / `undici` / Express — extra process model and no native SQL. Deno — weaker Steam/`steam-user` ecosystem. Go/Rust for the worker — GC and `steam-user` are Node-shaped; we would still run a JS sidecar.

**Consequence.** Tests and scripts assume Bun. `packageManager` is pinned in the root manifest.

## HTTP API

**Decision:** `Bun.serve` route table in `packages/api`. No Fastify, Express, or oRPC. Zod at the handler. CORS from `CORS_ORIGINS`.

**Why.** The API is a **test harness** (health, kick a league, ingest-run status), not the collect path. A framework would own lifecycle we already have in `app.ts`.

**Rejected.** Next.js / a public website — out of scope. GraphQL — no nested product UI.

## Postgres

**Decision:** Postgres 16 as the system of record for entities, match-level facts, Steam/proxy inventory, rate-limit mutexes, and the job queue.

**Why.** Live/historical workers share a **1 rps mutex** (`SELECT … FOR UPDATE` on `steam_api_keys`). That is a database lock, not a Redis key. Cursors, `ON CONFLICT` upserts, and graphile-worker tables are the same class of state. An operator inspects a match with `psql`.

**Rejected.** Mongo / JSON document store — we already forbade payload blobs as source of truth. SQLite — no concurrent workers + GC + API on one file. Cockroach — no need for multi-region.

## Query layer: bun.sql + Drizzle

**Decision:** Native [`Bun.SQL`](https://bun.sh/docs/api/sql) as the driver. [Drizzle ORM](https://orm.drizzle.team/docs/connect-bun-sql) (`drizzle-orm/bun-sql`) on top. Table types in `packages/shared/src/db/schema.ts` from `bun run db:pull` (`drizzle-kit pull`, casing preserved). Runtime queries: `db.execute(sql\`…\`)` or `db.select().from(…)`. Transactions: `db.transaction`.

**Why.** We already run Bun; a second Postgres client (postgres.js, `node-postgres`) is another pool and another bigint story. Drizzle gives `bigint({ mode: 'number' })` on `select()`, `ON CONFLICT` we already write in SQL, and a schema file the typechecker sees. Pull after DDL — we do not generate migrations from TypeScript.

**Rejected.**

| Alternative | Why not |
|---|---|
| postgres.js tagged templates | Second client; `sql(rows)` / `pool.json` were the only bulk helpers. Removed. |
| `@pgtyped` `.sql` files + codegen | Unused in this repo; needed a live DB *and* a watch process before types existed. Drizzle pull is one command after `db:up`. |
| drizzle-kit `migrate` / `push` | Two migration runners. DDL stays dbmate. |
| Prisma | Migrate + client runtime in the app; heavier than pull-the-schema. |
| Kysely-only | Fine query builder, no pull story we already have with Drizzle kit. |

**Consequence.** `execute(sql\`…\`)` returns driver types (int8 outside i32 as strings unless Bun `bigint: true`). Prefer `select()` when the row is a first-class entity. `undefined` in a Drizzle SQL chunk is omitted, not NULL — call sites use `?? null`. Schema files are overwritten by pull; do not hand-edit except restoring `mode: 'number'` if kit drops it.

## Migrations: dbmate, not the app

**Decision:** [dbmate](https://github.com/amacneil/dbmate) applies SQL in `db/migrations` (Postgres) and `db/clickhouse/migrations` (ClickHouse). Dumps: `db/schema.sql`, `db/clickhouse/schema.sql`. Compose one-shots `migrate` / `clickhouse-migrate` run **before** workers. Application images do not copy `db/`, do not depend on dbmate, and do not `CREATE TABLE`.

**Why.** Several worker replicas must not all migrate on boot. SQL files are the reviewable DDL. The same tool covers Postgres and ClickHouse (ClickHouse: one statement per `-- migrate:up`, `transaction:false`).

**Rejected.** Flyway/Liquibase — JVM in a Bun repo. drizzle-kit migrate — TypeScript as DDL source. `graphile-migrate`. App-startup `ensureSchema()`.

**Consequence.** After DDL: `db:up` then `db:pull` so Drizzle types match. dbmate is a Go binary (`brew install`), not an npm dependency of `@app/worker`.

## ClickHouse

**Decision:** ClickHouse for live ticks and replay event tables. Official `@clickhouse/client` over HTTP. MergeTree, append-only, **no `FINAL`** in application SQL. Worker may `ALTER TABLE … DELETE WHERE match_id = …` on re-parse (mutation), not schema changes.

**Why.** Billions of `(match_id, time, tick)` rows, codecs, monthly partitions. Postgres would bloat and still lose the scan shape. The split is in [`data-schema.md`](./data-schema.md).

**Rejected.** Timescale on Postgres — still one engine for mutexes *and* combat log. Redshift/BigQuery — not the ingest path. ReplacingMergeTree / CollapsingMergeTree — we would pay `FINAL`.

**Consequence.** Two URLs: `CLICKHOUSE_URL` (HTTP, app) and `CHURI` (native TCP, dbmate). Do not mix them.

## Object storage

**Decision:** S3 API (`S3_*` in `.env`) for `.dem.bz2`. Parser reads the object; re-parse does not need Valve’s replay CDN.

**Why.** Files are tens to hundreds of MB; they are not rows. S3 is the durable blob; Postgres `match_replays` is the locator and status.

**Rejected.** Storing demos in Postgres `bytea`. Filesystem on the worker box (replicas, no shared disk).

## Jobs: graphile-worker

**Decision:** [graphile-worker](https://worker.graphile.org) in the **same Postgres**. Queues, retries, cron, and `jobKey` dedupe are tables. One worker process runs every job (live, historical, GC details, download, parse) at that job's own frequency.

**Why.** The 1 rps limiter and job state already live in Postgres. A Redis/NATS broker would be a second failover and a second place to look when a match is stuck. `jobKey` + `preserve_run_at` is how live poll and replay delays work.

**Rejected.** BullMQ / Redis. Kafka (overkill for “one GetMatchDetails”). Temporal (ops surface we do not need). In-process `setInterval` only — no retries, no inspectable queue.

**Consequence.** graphile-worker **creates its own schema at runtime**. It is not in dbmate dumps. Live poll is a self-rescheduling job, not a second process.

## Domain async: Promise

**Decision:** `async`/`await` and `Promise` for Steam Web API walks, live poll, league history, and jobs. Zod for HTTP and Valve JSON. Errors are `Error` subclasses (`throw` / `try`/`catch`). Retries are a loop plus `await Bun.sleep`.

**Why.** The collect path is sequential I/O with a handful of retries. Effect (`Effect.gen`, `fromPromise` at every Drizzle/`fetch` edge, `runPromise` at graphile) added ceremony without changing the shape of the work. One async style across jobs, stores, and HTTP.

**Rejected.** Effect 4. Neverthrow / custom Result. RxJS.

## Steam clients

**Decision:** `steam-user` + `steam-session` for GC (replay salt / cluster). Web API is `fetch` + Zod. TOTP is vendored (not `steam-totp`). Proxies are first-class rows; HTTP/GC calls do not go out “bare”.

**Why.** Valve does not document a stable HTTP equivalent for replay locators. `steam-user` is the maintained GC client in this ecosystem. Web API stays HTTP so the limiter is one Postgres mutex, not a Steam connection.

**Rejected.** One Steam account for both API key and GC — we split pools (key vs password-only, no `shared_secret`) so a GC ban does not burn the 1 rps key. Official undocumented protobuf-only stack — we would still wrap sessions.

## Replay parser

**Decision:** Parse in-process in the Bun worker. The engine is a TypeScript port of the Source 2 demo format used by [dotabuff/manta](https://github.com/dotabuff/manta) (bitstream, send tables, entities, string tables). Compressed demo messages use [`snappy`](https://www.npmjs.com/package/snappy) (`uncompressSync`, raw block format — the same wire as manta). Processors emit the existing NDJSON event catalog into ClickHouse `replay_*`. `parse_replay` is a separate graphile job after S3 already has the `.dem.bz2`. We do not call a third-party match HTTP API and do not run a Java sidecar.

**Why.** Download and parse are different units of work (network vs CPU), but they share one worker so ops stays one process. S3 remains the source of truth for re-parse. Native rust-snappy is the fast path for large entity packets; `snappyjs` is a pure-JS fallback we do not need.

**Rejected.** A Java sidecar. An unpublished npm demo engine as a black box. Parsing inside the download job. Depending on someone else’s match API. `snappyjs` as the codec.

## Logging and formatting

**Decision:** `pino` (JSON in production, `pino-pretty` only when `NODE_ENV=development`), redaction of Steam/S3 secrets. [biome](https://biomejs.dev) (tabs, single quotes, width 80). No Prettier + ESLint pair.

**Why.** Collectors are scraped as logs, not pretty-printed. biome is one tool and already in the template.

## Packaging and deploy

**Decision:** Bun workspaces, catalog versions. Docker: one image per service, context = repo root, `db/` ignored. Migrations run outside the replica (CI, `bun run db:up`, or compose one-shot).

**Why.** Two replicas migrating on boot race. Catalog keeps Drizzle / Zod on one version across packages.

---

## Summary

| Concern | Choose | Do not choose |
|---|---|---|
| Runtime | Bun + TypeScript | Node framework stack, extra compile |
| HTTP | `Bun.serve` | Express / Fastify / Next |
| Mutable state + locks + jobs | Postgres 16 | Redis as source of truth |
| SQL in process | bun.sql + Drizzle | postgres.js, pgtyped, Prisma migrate |
| DDL | dbmate files + one-shot | migrate-on-boot, drizzle-kit migrate |
| Ticks / combat log | ClickHouse MergeTree | JSON in PG, `FINAL` engines |
| Demos | S3 | bytea, local disk |
| Queue | graphile-worker in PG | Bull / Kafka / in-process timers |
| Steam HTTP vs GC | fetch+Zod vs steam-user | one account for both roles |
| Parse | in-process Source 2 parser (manta-shaped) | third-party match API, Java sidecar |
| Domain flow | `async`/`await`, `Promise` | Effect, neverthrow, RxJS |

Revisit this ADR if we add a public query API, a second region, or a Steam transport that is not `steam-user`. Until then, schema and worker specs assume this stack.
