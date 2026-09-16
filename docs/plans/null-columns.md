# Plan: always-null columns (prod `pg_stats`)

Measured on `dota2-bigdata` 2026-09-11; leftovers dropped 2026-09-15.

## Fill (done)

| Column | Source |
|---|---|
| `players.steam_id` | `76561197960265728 + account_id` (Steam64 text) |
| `leagues.last_match_seq_num` | `max(matches.match_seq_num)` + history walk |
| `series.ended_at` | Bo3/Bo5 when one side has 2/3 wins |
| `match_draft.player_slot` | pick `hero_id` → `match_players.player_slot` |

## Keep (source exists; Valve / live rarely sends)

GC / live fields (`pro_name`, `claimed_*`, `game_balance`, team tags,
guilds, tournament, live `game_number` / `server_steam_id`, parse
summaries until `Store.Publish`).

## Dropped (no ingest source)

| Column | Why |
|---|---|
| `match_players.party_size` | not on `CMsgDOTAMatch.Player` |
| `match_players.backpack_3` | Valve backpack is 0–2; extras are `item_6+` |
| `matches.positive_votes`, `negative_votes` | not on GC match proto; we do not call old Web API details |
| `matches.next_attempt_at` | restored 2026-09-15 for `fetch_seq_details` retry |
| `matches.attempts` | restored 2026-09-15 for `fetch_seq_details` retry |
| `steam_api_keys.daily_quota` | not a Steam field we read (1 rps limiter is enough) |
| `matches.last_steam_account_id`, `last_proxy_id` | never written; GC session is `match_replays.steam_account_id` / `proxy_id` |
| `matches.last_api_key_id` | seq CLI backfill only |
| `waiting_for = 'seq'` | CHECK leftover; ingest never assigned it |
| `match_replays.status = awaiting_gc` | enum leftover; flow is `pending` → `downloading` |
| `replay_combat_log.greevils_greed_stack`, `tracked_death`, `tracked_sourcename` | not on the proto |
| `replay_neutrals.is_neutral_active_drop` / `is_neutral_passive_drop` | extract left `0` |
| `replay_intervals.observers_placed` | copy of `obs_placed` |
