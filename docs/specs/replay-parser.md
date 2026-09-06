# Replay parser

Companions: [`demo-file.md`](./demo-file.md) (what a `.dem` is),
[`data-schema.md`](./data-schema.md), [`worker-architecture.md`](./worker-architecture.md).

A Go service (`packages/parser`) reads `.dem.bz2` from S3, extracts every
typed event the current `replay_*` schema can hold, and writes ClickHouse
plus the sparse Postgres facts the spec already named (`match_objectives`,
`match_draft` clocks, `match_players` parse summaries). The TypeScript
worker still only downloads; it does not parse.

Decoder is ours (`packages/parser/internal/replay`). It implements the
Source 2 demo wire (PBDEMS2, sendtables, field paths, packet entities)
and uses Valve `.proto` types only. We do not depend on manta, Clarity,
or any other third-party replay parser. Example projects are a reference
for callback names and entity field paths, not a codebase we vendor.

## Status

Postgres `replay_status` already has `parsing` / `parsed`. A successful
commit also sets `matches.phase = parsed` and clears `waiting_for`.
“Processed” in the product sense is `parsed` on both rows.

`GET /metrics` exposes parse success/fail, duration, inflight, and the
`stored` / `parsing` / `failed` queue. Spec: [`metrics.md`](./metrics.md).

## Parallelism

`settings.parser_parallelism` (default `10`). The service polls that row
and runs that many in-flight parses. Live-priority `stored` rows go first.

## Claim

```
stored → parsing → parsed
                 ↘ failed  (row stays claimable after backoff)
```

Claim is `UPDATE … WHERE status = 'stored' … FOR UPDATE SKIP LOCKED`.
A `parsing` row older than 30 minutes is treated as abandoned and reset
to `stored`. Already-`parsed` rows with `parser_version >=` the binary’s
schema version are skipped (idempotent). A newer binary re-parses.

## Everything-or-nothing on MergeTree

ClickHouse has no cross-table transaction and we do not change the engine.
Each attempt allocates a unique `parse_run_id` (uint64). Every `replay_*`
row of that attempt carries it. Postgres `match_replays.parse_run_id` is
the published run.

1. Parse the whole demo into memory. A decode error writes nothing.
2. Insert all `replay_*` tables with the new `parse_run_id`.
3. If any insert fails: `ALTER TABLE … DELETE WHERE parse_run_id = {id}`
   on every replay table, mark the row `failed`, stop.
4. Write Postgres (objectives, draft clocks, player summaries) in one
   transaction. On failure: the same CH deletes, mark `failed`.
5. Only then `UPDATE match_replays SET status = 'parsed', parser_version,
   parse_run_id, parsed_at`.
6. After publish, delete any *previous* `parse_run_id` for that `match_id`
   so re-parse does not leave a readable duplicate set.

Queries that must not see a half-written match join
`replay_*.parse_run_id = match_replays.parse_run_id` (or filter
`parser_version` as the schema spec already said). Do not use `FINAL`.

`parser_version` is the extract/schema revision of this binary (starts at
`1`). Bump it when columns or extract rules change.

## What we store

Every table in the replay catalog. Combat-log proto scalars already have
columns. This revision adds the fields the decoder actually emits that
the first schema dropped:

| Table | Added |
|---|---|
| every `replay_*` | `parse_run_id` |
| `replay_actions` | unit / target / ability / position / queued |
| `replay_pings` | `ping_type`, `target` |
| `replay_cosmetics` | `account_id` |
| `replay_alerts` | item/ability/courier/outpost/roshan/… user messages |
| `replay_intervals` | `hp`, `max_hp`, `mana`, `max_mana`, `respawn` |

Unknown `DOTA_COMBATLOG_{id}` and `CHAT_MESSAGE_{id}` values are stored,
not dropped.

Event → table map (every combat type, every stored user message, and
what we deliberately skip): [`replay-mapping.md`](./replay-mapping.md).
`parser_version` is **2** after `replay_alerts` and interval vitals.

## Out of scope

Teamfight aggregation (query-time). Private coaching proto. Changing
MergeTree to Replacing/Collapsing.
