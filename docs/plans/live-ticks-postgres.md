# Live ticks in Postgres, match `status`, 2 s polls

- [x] Specs: 2 s live cadence, `matches.status`, PG `live_*_ticks`, query indexes
- [x] DDL: rename `phase` → `status`, create PG live tick tables, drop CH `live_*`, seed 2000 ms
- [x] Live jobs write ticks to Postgres; stop CH inserts
- [x] Rename `matches.phase` in worker / parser / metrics / Grafana / tests
- [x] `bun run db:up` / `ch:up` / `db:pull`

## Why

Live scoreboard ticks need low-latency reads (current game, last N polls).
ClickHouse is the wrong store for that grain. Match lifecycle is a status
model; the column is `status` like `leagues`, `match_replays`, resources.

## Indexes (queries that exist or will)

See [`data-schema.md`](../specs/data-schema.md#indexes). Add only what
walks, live finish, replay claim, resource pick, or “this match / this
player” lookups need. Do not index Valve bitmask columns.
