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

`settings.parser_parallelism` (default `6`, prod `8`). The service
polls that row and runs that many in-flight parses. Live-priority
`stored` rows go first. Each parse still holds the **kept** Source 2
entity world until EOF (heroes, player resource, gamerules, team data,
items, abilities, wards, wearables). Creeps / projectiles / particles
are decoded only far enough to consume the bitstream, then dropped.
High-volume extract rows flush to ClickHouse in batches (seed 8 192).

Width 8 needs the parser cgroup at **3.00 CPU / 8 GiB**. The old
0.90 / 4 GiB cap made 6-wide look “full” and 10-wide on 0.70 only
thrashed CFS. The host is 4 cores: 20-wide on ~2.5 usable cores
raised wall time to 3–4 min and cut throughput. Skip `DropPrevious`
when the row has never published a `parser_version` — empty
`ALTER DELETE` mutations are what filled the disk at high width.
A mutation still rewrites every MergeTree **part** that contains a
matching row, so it reserves that part’s size (multi-GiB on
`replay_combat_log` / `replay_actions`), not the handful of deleted
rows.

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

Unused entity classes are not kept in `ents` — batching plus that
discard is what keeps RSS O(kept world + one batch), not O(match).
Creeps still cost decode CPU (variable-length fields must be read);
they do not cost a cloned baseline tree.

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
`1`). Bump it when columns or extract rules change. **3** after
`account_id` on every `replay_*` row (and combat attacker/target
accounts). Re-parse is how old matches get the stamps.

## What we store

Every table in the replay catalog. Combat-log proto scalars already have
columns. This revision adds the fields the decoder actually emits that
the first schema dropped:

| Table | Added |
|---|---|
| every `replay_*` | `parse_run_id`, `account_id` (Steam 32-bit; 0 if unknown) |
| `replay_combat_log` | `attacker_account_id`, `target_account_id` |
| `replay_actions` | unit / target / ability / position / queued |
| `replay_pings` | `ping_type`, `target` |
| `replay_cosmetics` | `account_id` (also on the shared prefix) |
| `replay_alerts` | item/ability/courier/outpost/roshan/… user messages |
| `replay_intervals` | `hp`, `max_hp`, `mana`, `max_mana`, `respawn` |

Unknown `DOTA_COMBATLOG_{id}` and `CHAT_MESSAGE_{id}` values are stored,
not dropped.

Event → table map (every combat type, every stored user message, and
what we deliberately skip): [`replay-mapping.md`](./replay-mapping.md).
`parser_version` is **3** after `account_id` on every `replay_*` row
(and combat `attacker_account_id` / `target_account_id`). Version 2
was `replay_alerts` and interval vitals.

## Out of scope

Teamfight aggregation (query-time). Private coaching proto. Changing
MergeTree to Replacing/Collapsing.
