# Replay parser

Companions: [`demo-file.md`](./demo-file.md) (what a `.dem` is),
[`data-schema.md`](./data-schema.md), [`worker-architecture.md`](./worker-architecture.md).

A Go service (`packages/parser`) reads `.dem.bz2` from S3, extracts every
typed event the current `replay_*` schema can hold, and writes ClickHouse
plus the sparse Postgres facts the spec already named (`match_objectives`,
`match_draft` clocks, `match_players` parse summaries, captains and leftover
backpack / neutrals / Aghs from metadata). The TypeScript
worker still only downloads; it does not parse.

Decoder is [dotabuff/manta](https://github.com/dotabuff/manta)
(`github.com/dotabuff/manta`). Extract, ClickHouse batches, and
Postgres publish stay ours (`packages/parser/internal/parse`,
`internal/sink`, `internal/store`). Manta owns PBDEMS2, sendtables,
field paths, packet entities, and Valve proto types
(`github.com/dotabuff/manta/dota`). The example
`example_projects/dota2-demo-parser` is the same split: manta for
decode, our callbacks for rows.

## Status

Postgres `replay_status` already has `parsing` / `parsed`. A successful
commit also sets `matches.status = parsed`.
“Processed” in the product sense is `parsed` on both rows.

`GET /metrics` exposes parse success/fail, duration, inflight, and the
`stored` / `parsing` / `failed` queue. Spec: [`metrics.md`](./metrics.md).

## Parallelism

`settings.parser_parallelism` (default `6`, prod `8`). The service
polls that row and runs that many in-flight parses. Live-priority
`stored` rows go first. Each parse holds manta’s entity world until
EOF. High-volume extract rows flush to ClickHouse in batches (seed 8 192).

Width 8 needs the parser cgroup at **3.00 CPU / 8 GiB**. The old
0.90 / 4 GiB cap made 6-wide look “full” and 10-wide on 0.70 only
thrashed CFS. The host is 4 cores: 20-wide on ~2.5 usable cores
raised wall time to 3–4 min and cut throughput. Skip `DeleteMatch`
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

After `parsed`, match-processing `archive_parsed_replays` copies the object
to cold storage and rewrites `s3_bucket` / `s3_key`. A re-parse that resets
the row to `stored` reads that locator (Glacier/Archive classes need a
restore first).

## Delete+insert on MergeTree

ClickHouse has no cross-table transaction and we do not change the engine.
Readers query `replay_*` by `match_id`. A re-parse deletes the previous
rows for that match first, then inserts. A failed attempt deletes the
same `match_id` so MergeTree does not keep a partial write.

High-volume tables (`replay_combat_log`, `replay_actions`,
`replay_intervals`) are flushed to ClickHouse in batches **during**
decode. Smaller tables (draft, chat, wards, `replay_meta*`, …) flush when
their buffer fills or at end-of-demo. A batch is a few thousand rows
(seed 8 192), not one INSERT per event. After a successful flush the
Go slice is reused so extract RAM stays O(batch), not O(match).

High-volume extract rows still flush in batches so extract RAM stays
O(batch), not O(match). Manta keeps the live entity world for the
whole demo (heroes, creeps, projectiles). We no longer drop unused
classes after decode.

1. If the row already published a `parser_version` (re-parse),
   `DeleteMatch` (`ALTER TABLE … DELETE WHERE match_id = {id}` on
   every `replay_*`). Skip on first parse — empty mutations filled
   the disk at high width.
2. Decode the stream. Whenever a table hits the batch size, `INSERT`
   those rows and drop the buffer. Decode / insert error:
   `DeleteMatch`, mark the row `failed`, stop.
3. End of demo: flush leftovers, then write Postgres (objectives,
   draft clocks, player summaries) in one transaction. On failure:
   the same `DeleteMatch`, mark `failed`.
4. Only then `UPDATE match_replays SET status = 'parsed',
   parser_version, parsed_at`.

`DeleteMatch` is a MergeTree mutation: rows vanish from queries
quickly, parts merge later. During a re-parse readers may see no
rows or a partial insert until publish. Do not use `FINAL`.

`parser_version` is the extract/schema revision of this binary (starts at
`1`). Bump it when columns or extract rules change. **3** after
`account_id` on every `replay_*` row (and combat attacker/target
accounts). **4** after PURCHASE `value_name` (CombatLogNames[value]),
lane fill from positions, and barracks bitmasks from rax kills. Re-parse
is how old matches get the stamps.

## What we store

Every table in the replay catalog. Combat-log proto scalars already have
columns — field-by-field map in
[`replay-mapping.md`](./replay-mapping.md#cmsgdotacombatlogentry-columns).
This revision adds the fields the decoder actually emits that the first
schema dropped:

| Table | Added |
|---|---|
| every `replay_*` | `account_id` (Steam 32-bit; 0 if unknown) |
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
`parser_version` is **4** after PURCHASE names, lane positions, and
rax-derived barracks. Version 3 stamped `account_id` on every
`replay_*` row (and combat `attacker_account_id` /
`target_account_id`). Version 2 was `replay_alerts` and interval vitals.

## Out of scope

Teamfight aggregation (query-time). Private coaching proto. Changing
MergeTree to Replacing/Collapsing.
