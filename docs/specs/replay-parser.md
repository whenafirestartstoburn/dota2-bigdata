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

`settings.parser_parallelism` (default `5`). The service polls that row
and runs that many in-flight parses. Live-priority `stored` rows go first.
Each parse holds the decompressed `.dem` plus entity state; 10-wide
claims do not fit a 4 GiB parser cgroup. 5-wide is the width that still
fits ~1.5–2 GiB of three-to-five overlapping decodes.

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
the **published** run — that is what makes a write visible.

High-volume tables (`replay_combat_log`, `replay_actions`,
`replay_intervals`) are flushed to ClickHouse in batches **during**
decode. Smaller tables (draft, chat, wards, epilogue, …) flush when
their buffer fills or at end-of-demo. A batch is a few thousand rows
(seed 8 192), not one INSERT per event. After a successful flush the
Go slice is reused so extract RAM stays O(batch), not O(match).

The Source 2 entity world still lives in process until EOF — batching
does not shrink that. It only removes the second peak (60k combat
structs + 80k actions held until the end).

1. Allocate `parse_run_id`. Decode the stream. Whenever a table hits
   the batch size, `INSERT` those rows with that id and drop the
   buffer. Decode / insert error: `Abort(parse_run_id)` (`ALTER TABLE
   … DELETE WHERE parse_run_id = {id}` on every `replay_*` table),
   mark the row `failed`, stop. Readers never see this id — Postgres
   still has the previous published run, or none.
2. End of demo: flush leftovers, then write Postgres (objectives,
   draft clocks, player summaries) in one transaction. On failure:
   the same `Abort`, mark `failed`.
3. Only then `UPDATE match_replays SET status = 'parsed',
   parser_version, parse_run_id, parsed_at`.
4. After publish, delete any *previous* `parse_run_id` for that
   `match_id` so re-parse does not leave a readable duplicate set.

`Abort` is a MergeTree mutation: rows vanish from queries quickly,
parts merge later. That is the same contract as today’s failed
`Commit`. Do not query `replay_*` by `match_id` alone while a parse
is in flight; join
`replay_*.parse_run_id = match_replays.parse_run_id`. Do not use
`FINAL`.

`parser_version` is the extract/schema revision of this binary (starts at
`1`). Bump it when columns or extract rules change.

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
