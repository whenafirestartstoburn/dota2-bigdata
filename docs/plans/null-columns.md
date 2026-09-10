# Plan: always-null columns (prod `pg_stats`)

Measured on `dota2-bigdata` 2026-09-11. ClickHouse uses `0` / `''` for
missing (no `Nullable`); replay proto columns stay.

## Fill

| Column | Source |
|---|---|
| `players.steam_id` | `76561197960265728 + account_id` (Steam64 text) |
| `leagues.last_match_seq_num` | `max(matches.match_seq_num)` + history walk |
| `series.ended_at` | Bo3/Bo5 when one side has 2/3 wins |
| `match_draft.player_slot` | pick `hero_id` → `match_players.player_slot` |

## Keep (source exists; Valve / live rarely sends)

GC / live fields (`pro_name`, `claimed_*`, `game_balance`, team tags,
guilds, tournament, live `game_number` / `server_steam_id`, parse
summaries). `last_steam_account_id` / `last_proxy_id` wait on
`steam_accounts` (empty on this host).

## Drop (no ingest source)

| Column | Why |
|---|---|
| `match_players.party_size` | not on `CMsgDOTAMatch.Player` |
| `match_players.backpack_3` | Valve backpack is 0–2; extras are `item_6+` |
| `matches.positive_votes`, `negative_votes` | not on GC match proto; we do not call old Web API details |
| `matches.next_attempt_at` | unused; replay retry is `match_replays.next_attempt_at` |
| `steam_api_keys.daily_quota` | not a Steam field we read (1 rps limiter is enough) |
