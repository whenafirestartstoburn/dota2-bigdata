# Data schema

Professional Dota 2 matches. Companions: [`worker-architecture.md`](./worker-architecture.md), [`adr-technology.md`](./adr-technology.md), [`demo-file.md`](./demo-file.md).

Postgres: entities, match-level facts. ClickHouse: live scoreboard ticks and replay events. S3: `.dem.bz2`.

## Split

| Store | Contents |
|---|---|
| Postgres | leagues, series, matches, players, teams, heroes, items, draft, box scores, story events, replay/parse status |
| ClickHouse | live scoreboard ticks, combat log, 1 s snapshots, chat, wards, orders |
| S3 | `.dem.bz2` |

Removed: ClickHouse `dota.match_details_raw`, `dota.source_payloads`; Postgres `leagues.payload`, `matches.history_payload` / `details_payload` / `live_payload`, `match_players.payload`.

Operational tables (`steam_accounts`, `steam_api_keys`, `proxies`, `settings`, `marketplace_products`, `marketplace_orders`, `resource_attempts`, `steam_api_requests`, `steam_gc_requests`, `replay_requests`, graphile-worker) are not listed here.

Valve attempt logs (`steam_api_requests`, `steam_gc_requests`, `replay_requests`): daily partitions, `match_id` nullable, retained 3 days. `steam_api_requests` also stores the 200 JSON body (`response_body` jsonb). Web API / GC rows also store `steam_api_key_id` / `steam_account_id`. [`request-logs.md`](./request-logs.md), [`steam-api.md`](./steam-api.md).

Every public Postgres table except dbmate `schema_migrations` has `id bigserial` PK and `created_at` / `updated_at` (`set_updated_at` trigger; `created_at` is immutable). Those three columns are omitted below. Natural identifiers (`match_id`, `league_id`, `account_id`, …) are UNIQUE. FKs point at the natural keys.

---

## Entity model

```
leagues 1──* series 1──* matches
                │            ├── 10 match_players ──> players
                │            ├── * match_draft          (picks and bans, one sequence)
                │            ├── * match_player_buffs
                │            ├── * match_objectives
                │            ├── 1 match_replay
                │            └── * ClickHouse live_*_ticks / replay_*
                └── 2 teams
heroes, items, patches, abilities, …   catalogs keyed by Valve id
```

---

## Postgres

### leagues

Valve `GetLeagueInfoList` plus collector lifecycle. `status` derivation is in the workers spec.

| Column | Description |
|---|---|
| `league_id` | Valve league id (unique). Comes from GetLeagueInfoList |
| `name` | League name. Comes from GetLeagueInfoList |
| `tier` | Valve tier: 1 amateur … 4 international. Comes from GetLeagueInfoList |
| `region` | Valve region id. Comes from GetLeagueInfoList |
| `total_prize_pool` | Prize pool. Comes from GetLeagueInfoList |
| `start_timestamp` | League start, Unix seconds. Comes from GetLeagueInfoList |
| `end_timestamp` | League end, Unix seconds. Comes from GetLeagueInfoList |
| `most_recent_activity` | Last Valve activity, Unix seconds. Comes from GetLeagueInfoList |
| `valve_status` | Valve publication flag (5 ≈ concluded). Comes from GetLeagueInfoList |
| `status` | `UPCOMING` / `LIVE` / `FINISHED`. Derived, workers spec |
| `last_match_seq_num` | Highest `match_seq_num` seen for this league. Comes from GetMatchHistory (and backfill `max(matches.match_seq_num)`) |
| `history_tail_match_id` | `start_at_match_id` for older pages. Comes from GetMatchHistory |
| `history_exhausted` | Older pagination returned nothing. Comes from GetMatchHistory |
| `history_checked_at` | Last GetMatchHistory call |
| `fetched_at` | Last GetLeagueInfoList call |

Indexes: `(status)`, `(most_recent_activity DESC)`.

### series

When Valve `series_id` is 0, `series_id` is a hash of `(league_id, least(t1,t2), greatest(t1,t2), first_match_id)` in a reserved high range. `matches.series_id` FKs to this row.

| Column | Description |
|---|---|
| `series_id` | Valve series id when `> 0`; otherwise the synthetic hash (unique). Comes from GetLiveLeagueGames / GetMatchHistory |
| `league_id` | Parent league. Comes from GetLiveLeagueGames / GetMatchHistory |
| `radiant_team_id` | First-game radiant team; unchanged if sides flip later. Comes from GetLiveLeagueGames / GetMatchHistory |
| `dire_team_id` | First-game dire team; unchanged if sides flip later. Comes from GetLiveLeagueGames / GetMatchHistory |
| `series_type` | 0 none, 1 Bo3, 2 Bo5, …. Comes from GetLiveLeagueGames / GetMatchHistory |
| `radiant_wins` | Last observed radiant series wins. Comes from GetLiveLeagueGames |
| `dire_wins` | Last observed dire series wins. Comes from GetLiveLeagueGames |
| `first_match_id` | First match in the series |
| `started_at` | First match `start_time` |
| `ended_at` | Set when a Bo3/Bo5 side reaches 2/3 wins. Null while `series_type` is 0 |

### matches

One row per game. Team names are a snapshot at game time.

| Column | Description |
|---|---|
| `match_id` | Valve match id (unique). Comes from GetMatchHistory / GetLiveLeagueGames / GetTopLiveGame / GC |
| `league_id` | Parent league. Comes from GetMatchHistory / GetLiveLeagueGames / GC |
| `series_id` | Parent series. Comes from GetLiveLeagueGames / GetMatchHistory |
| `series_type` | Series type on this match. Comes from GetLiveLeagueGames / GetMatchHistory |
| `radiant_series_wins` | Radiant wins in the series. Comes from GetLiveLeagueGames |
| `dire_series_wins` | Dire wins in the series. Comes from GetLiveLeagueGames |
| `league_node_id` | Bracket node id. Comes from GetLiveLeagueGames |
| `match_seq_num` | Valve match sequence number. Comes from GetMatchHistory |
| `start_time` | Match start, Unix seconds. Comes from GetMatchHistory / GetMatchHistoryBySequenceNum / GC |
| `duration` | Game duration, seconds. Comes from GC |
| `pre_game_duration` | Pregame duration, seconds. Comes from GC |
| `lobby_type` | Valve lobby type; catalog `lobby_types`. Comes from GC |
| `game_mode` | Valve game mode; catalog `game_modes`. Comes from GC |
| `engine` | Source engine id. Comes from GC |
| `radiant_win` | Radiant won. Comes from GC (`match_outcome` 2 rad / 3 dire) |
| `radiant_score` | Radiant kills. Comes from GC |
| `dire_score` | Dire kills. Comes from GC |
| `tower_status_radiant` | Radiant tower bitmask. Comes from GC |
| `tower_status_dire` | Dire tower bitmask. Comes from GC |
| `barracks_status_radiant` | Radiant barracks bitmask. Comes from GC; replay parse also fills from rax kills |
| `barracks_status_dire` | Dire barracks bitmask. Comes from GC; replay parse also fills from rax kills |
| `first_blood_time` | First-blood game clock, seconds. Comes from GC |
| `lobby_id` | Steam lobby id. Comes from GetLiveLeagueGames |
| `server_steam_id` | Game server Steam id. Comes from GetTopLiveGame / GetRealtimeStats |
| `match_flags` | `CMsgDOTAMatch.flags` (field 46). Comes from GC |
| `match_outcome` | `EMatchOutcome`. Comes from GC |
| `game_balance` | Game balance float. Comes from GC |
| `radiant_team_logo` | Radiant team logo id. Comes from GetLiveLeagueGames / GC |
| `dire_team_logo` | Dire team logo id. Comes from GetLiveLeagueGames / GC |
| `radiant_team_logo_url` | Radiant team logo URL. Comes from GC |
| `dire_team_logo_url` | Dire team logo URL. Comes from GC |
| `radiant_team_tag` | Radiant team tag. Comes from GC |
| `dire_team_tag` | Dire team tag. Comes from GC |
| `radiant_guild_id` | Radiant guild id. Comes from GC |
| `dire_guild_id` | Dire guild id. Comes from GC |
| `tournament_id` | Tournament id. Comes from GC |
| `tournament_round` | Tournament round. Comes from GC |
| `league_series_id` | League series id. Comes from GetLiveLeagueGames |
| `league_game_id` | League game id. Comes from GetLiveLeagueGames |
| `game_number` | Game number in the series. Comes from GetLiveLeagueGames |
| `stage_name` | Stage name. Comes from GetLiveLeagueGames |
| `league_tier` | League tier on the listing. Comes from GetLiveLeagueGames |
| `human_players` | Human player count. Comes from GC |
| `cluster` | Replay CDN cluster. Comes from GC |
| `replay_salt` | Replay salt. Comes from GC |
| `radiant_team_id` | Radiant team id at game time. Comes from GetMatchHistory / GetLiveLeagueGames / GC |
| `dire_team_id` | Dire team id at game time. Comes from GetMatchHistory / GetLiveLeagueGames / GC |
| `radiant_team_name` | Radiant team name at game time. Comes from GetMatchHistory / GetLiveLeagueGames / GC |
| `dire_team_name` | Dire team name at game time. Comes from GetMatchHistory / GetLiveLeagueGames / GC |
| `radiant_team_complete` | Radiant roster complete flag. Comes from GC |
| `dire_team_complete` | Dire roster complete flag. Comes from GC |
| `radiant_captain` | Radiant captain `account_id`. Comes from GetMatchHistoryBySequenceNum; replay parse fills if still null |
| `dire_captain` | Dire captain `account_id`. Comes from GetMatchHistoryBySequenceNum; replay parse fills if still null |
| `patch` | Patch string. Derived from `start_time` vs `patches` |
| `stream_delay_s` | Stream delay, seconds. Comes from GetLiveLeagueGames |
| `status` | Enum `match_status`: `discovered` → `live` → `awaiting_history` → `awaiting_details` → `details_ready` → `awaiting_replay` → `replay_stored` → `parsed` / `replay_unavailable` / `failed` / `not_started`. Later statuses are not rewritten backwards except a live flap: `not_started`, `awaiting_history`, `awaiting_details`, `failed` return to `live` when a live feed lists the id again |
| `source` | `live` / `historical`. Once `live`, stays `live` |
| `ingest_sources` | `text[]`, accumulated: `GetLiveLeagueGames`, `GetTopLiveGame`, `GetMatchHistory`, `GetMatchHistoryBySequenceNum` |
| `live_seen_at` | Last live sighting |
| `live_disappeared_at` | When the match left a live feed |
| `live_disappeared_count` | Times the match left a live feed |
| `live_league_missed_polls` | Current miss streak on GetLiveLeagueGames; reset when that feed sees the match |
| `top_live_missed_polls` | Current miss streak on GetTopLiveGame; reset when that feed sees the match |
| `live_duration_max` | Max `GetLiveLeagueGames` / `GetRealtimeStats` clock while live; 0 if the listing never reached horn |
| `history_poll_fast_count` | GetMatchHistory waiter after a **started** live match leaves the feed |
| `history_poll_slow_count` | Slow-phase history waiter count |
| `history_last_polled_at` | Last history-waiter poll |
| `history_next_poll_at` | Armed on live finish. Next history-waiter poll. Cleared on GetMatchHistory hit, waiter timeout, or live flap. Not gated on `status` — GC / replay may already have finished |
| `seq_fetched_at` | When `GetMatchHistoryBySequenceNum` was persisted (`fetch_seq_details` / CLI) |
| `details_fetched_at` | When `CMsgDOTAMatch` was persisted. Comes from GC |
| `attempts` | Seq-details retry count (`fetch_seq_details`) |
| `next_attempt_at` | Next seq-details retry |
| `last_realtime_at` | Last successful GetRealtimeStats call |
| `finished_at` | When the match finished. Set when the match leaves GetLiveLeagueGames / GetTopLiveGame after `live_duration_max > 0`, else `to_timestamp(start_time + duration)`. Null for `not_started` |
| `replay_available_at` | When the replay is due for download. For `source = live`: `finished_at + settings.replay_live_delay_ms` (seed 30 s). For `source = historical`: `now()`. 404 retries: 1 m, 1 m, 3 m × 20, 1 h × 24, then `replay_unavailable` |
| `last_error` | Last ingest error text |
| `last_error_kind` | `network` / `rate_limit` / `auth` / `not_ready` / `unavailable` / `history_timeout` / `not_started` / `other`. `history_timeout` is written only when the waiter expires while still `awaiting_history`. Seq retries: `matches.next_attempt_at`. Replay retries: `match_replays.next_attempt_at` |
| `last_error_at` | When `last_error` was set |

Indexes: [Indexes](#indexes).

### match_players

Unique `(match_id, player_slot)`. Slot 0–4 radiant, 128–132 dire. `GetLiveLeagueGames.players[]` has no `player_slot` and includes `team=4` coaches; slot is the per-team index. Linear 0–9 maps 5–9 → 128–132. ClickHouse `slot` is 0–9, `-1` if unknown; join `player_slot = if(slot < 5, slot, slot + 123)`.

Box score: live may refresh `match_players` while the match is still live. The first post-game source (seq or GC) may overwrite those live KDA/items. After `seq_fetched_at` or `details_fetched_at` is set, later sources only fill NULL / `0` (empty hero/item/account). Replay parse COALESCE-fills captains and leftover backpack / neutral / Aghs. Time series are ClickHouse rows. Valve `-1` (empty item) is stored as `0`, and `0` on hero/item/account is empty (a later source may fill it).

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `account_id` | Steam 32-bit account. Comes from GetLiveLeagueGames / GC |
| `player_slot` | Valve slot (0–4 radiant, 128–132 dire). Comes from GC; GetLiveLeagueGames has no slot (per-team index) |
| `hero_id` | Picked hero; 0 before pick. Comes from GetLiveLeagueGames / GC |
| `player_name` | Name at game time. Comes from GetLiveLeagueGames / GC |
| `pro_name` | Pro player name. Comes from GC |
| `real_name` | Real name. Comes from GC |
| `team_number` | Valve team number. Comes from GC |
| `team_slot` | Slot inside the team. Comes from GC |
| `side` | Radiant / dire. Comes from GetLiveLeagueGames / GC |
| `hero_variant` | Selected hero variant. Comes from GC |
| `selected_facet` | Facet id; join `hero_facets.facet_id`. Comes from GC |
| `kills` | Kills. Comes from GetLiveLeagueGames while live, then GC |
| `deaths` | Deaths. Comes from GetLiveLeagueGames while live, then GC |
| `assists` | Assists. Comes from GetLiveLeagueGames while live, then GC |
| `last_hits` | Last hits. Comes from GetLiveLeagueGames while live, then GC |
| `denies` | Denies. Comes from GetLiveLeagueGames while live, then GC |
| `net_worth` | End net worth. Comes from GetLiveLeagueGames while live, then GC |
| `gold` | Unspent gold. Comes from GC |
| `gold_spent` | Gold spent. Comes from GC |
| `gold_per_min` | Gold per minute. Comes from GetLiveLeagueGames while live, then GC |
| `xp_per_min` | XP per minute. Comes from GetLiveLeagueGames while live, then GC |
| `level` | Hero level. Comes from GetLiveLeagueGames while live, then GC |
| `claimed_farm_gold` | Claimed farm gold. Comes from GC |
| `support_gold` | Support gold. Comes from GC |
| `claimed_denies` | Claimed denies. Comes from GC |
| `claimed_misses` | Claimed misses. Comes from GC |
| `misses` | Missed attacks. Comes from GC |
| `bounty_runes` | Bounty runes taken. Comes from GC |
| `outposts_captured` | Outposts captured. Comes from GC |
| `seconds_dead` | Seconds spent dead. Comes from GC |
| `gold_lost_to_death` | Gold lost to death. Comes from GC |
| `hero_damage` | Hero damage. Comes from GC |
| `tower_damage` | Tower damage. Comes from GC |
| `hero_healing` | Hero healing. Comes from GC |
| `scaled_hero_damage` | Scaled hero damage. Comes from GC |
| `scaled_tower_damage` | Scaled tower damage. Comes from GC |
| `scaled_hero_healing` | Scaled hero healing. Comes from GC |
| `scaled_kills` | Scaled kills. Comes from GC |
| `scaled_deaths` | Scaled deaths. Comes from GC |
| `scaled_assists` | Scaled assists. Comes from GC |
| `item_0` | Inventory slot 0. Comes from GetLiveLeagueGames while live, then GC |
| `item_1` | Inventory slot 1. Comes from GetLiveLeagueGames while live, then GC |
| `item_2` | Inventory slot 2. Comes from GetLiveLeagueGames while live, then GC |
| `item_3` | Inventory slot 3. Comes from GetLiveLeagueGames while live, then GC |
| `item_4` | Inventory slot 4. Comes from GetLiveLeagueGames while live, then GC |
| `item_5` | Inventory slot 5. Comes from GetLiveLeagueGames while live, then GC |
| `item_6` | Extra item slot 6 (backpack mapping). Comes from GC |
| `item_7` | Extra item slot 7. Comes from GC |
| `item_8` | Extra item slot 8. Comes from GC |
| `item_9` | Extra item slot 9. Comes from GC |
| `item_10` | Extra item slot 10. Comes from GC |
| `item_10_lvl` | Level of `item_10`. Comes from GC |
| `item_neutral` | Neutral item. Comes from GC; replay parse fills if GC omitted it |
| `item_neutral2` | Second neutral / enhancement. Comes from GC; replay parse fills if GC omitted it |
| `backpack_0` | Backpack slot 0. Comes from GC (`item_6`); replay parse fills if GC omitted it |
| `backpack_1` | Backpack slot 1. Comes from GC (`item_7`); replay parse fills if GC omitted it |
| `backpack_2` | Backpack slot 2. Comes from GC (`item_8`); replay parse fills if GC omitted it |
| `aghanims_scepter` | Aghanim’s Scepter flag. Comes from GC; replay parse fills if GC omitted it |
| `aghanims_shard` | Aghanim’s Shard flag. Comes from GC; replay parse fills if GC omitted it |
| `moonshard` | Moon Shard flag. Comes from GC; replay parse fills if GC omitted it |
| `ability_upgrades` | Ability-id list. Comes from GC; timed rows in `match_player_ability_upgrades` |
| `leaver_status` | Valve leaver status. Comes from GC |
| `party_id` | Party id. Comes from GC |
| `hero_pick_order` | Pick order. Comes from GC |
| `hero_was_randomed` | Hero was randomed. Comes from GC |
| `lane_selection_flags` | Draft lane preference. Comes from GC |
| `support_ability_value` | Support ability value. Comes from GC |
| `disable_duration` | Disable duration. Comes from GC |
| `lane` | Lane outcome. Comes from replay parse |
| `lane_role` | Lane role. Comes from replay parse |
| `is_roaming` | Roaming. Comes from replay parse |
| `stuns` | Stun seconds. Comes from replay parse |
| `teamfight_participation` | Teamfight participation. Comes from replay parse |
| `towers_killed` | Towers killed. Comes from replay parse |
| `roshans_killed` | Roshans killed. Comes from replay parse |
| `observers_placed` | Observer wards placed. Comes from replay parse |
| `sentries_placed` | Sentry wards placed. Comes from replay parse |
| `camps_stacked` | Camps stacked. Comes from replay parse |
| `creeps_stacked` | Creeps stacked. Comes from replay parse |
| `rune_pickups` | Runes picked up. Comes from replay parse |
| `firstblood_claimed` | First blood claimed. Comes from replay parse |

### match_player_buffs

Unique `(match_id, player_slot, buff_id)`. Stack counts of permanent buffs (Aghs, Moonshard, …).

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `player_slot` | Valve player slot |
| `buff_id` | Permanent buff id; catalog `permanent_buffs`. Comes from GC |
| `stacks` | Stack count. Comes from GC |
| `grant_time` | When the buff was granted, game clock. Comes from GC |

### match_player_ability_upgrades

Unique `(match_id, player_slot, seq)`. `CMatchPlayerAbilityUpgrade`.

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `player_slot` | Valve player slot |
| `seq` | Upgrade sequence |
| `ability_id` | Ability id. Comes from GC |
| `time` | Game clock of the upgrade. Comes from GC |
| `level` | Ability level after the upgrade. Comes from GC |

### match_player_damage_breakdown

Unique `(match_id, player_slot, direction, damage_type)`.

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `player_slot` | Valve player slot |
| `direction` | `received` or `dealt`. Comes from GC (`hero_damage_received` / `hero_damage_dealt`) |
| `damage_type` | Valve damage type id. Comes from GC |
| `pre_reduction` | Damage before reduction. Comes from GC |
| `post_reduction` | Damage after reduction. Comes from GC |

### match_player_units

Additional units (Spirit Bear, …). Unique `(match_id, player_slot, unit_name)`.

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `player_slot` | Valve player slot |
| `unit_name` | Extra unit name |
| `item_0` | Unit inventory slot 0. Comes from GC |
| `item_1` | Unit inventory slot 1. Comes from GC |
| `item_2` | Unit inventory slot 2. Comes from GC |
| `item_3` | Unit inventory slot 3. Comes from GC |
| `item_4` | Unit inventory slot 4. Comes from GC |
| `item_5` | Unit inventory slot 5. Comes from GC |

### match_coaches

Unique `(match_id, account_id)`. Public lobby coaches (`CMsgDOTAMatch.Coach`).

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `account_id` | Coach Steam 32-bit account. Comes from GC |
| `coach_name` | Coach name. Comes from GC |
| `coach_rating` | Coach rating. Comes from GC |
| `coach_team` | Side the coach is on. Comes from GC |
| `coach_party_id` | Coach party id. Comes from GC |
| `is_private_coach` | Private-coach flag. Comes from GC |

### match_broadcasters

Unique `(match_id, seq)`. Broadcaster channels.

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `seq` | Channel sequence |
| `country_code` | Broadcast country. Comes from GC |
| `description` | Channel description. Comes from GC |
| `language_code` | Broadcast language. Comes from GC |
| `account_id` | Caster account. Comes from GC |
| `name` | Caster name. Comes from GC |

### players

One row per Steam account seen in a stored league match.

| Column | Description |
|---|---|
| `account_id` | 32-bit Steam account id (unique) |
| `steam_id` | Steam64 text: `76561197960265728 + account_id` |
| `persona_name` | Last seen persona |
| `is_pro` | True once seen in a league match |
| `current_team_id` | Last team in a stored match |
| `last_match_id` | Last stored match |
| `last_match_at` | When that match started |

### teams

Current team name / tag / logo. Game-time names are on `matches`.

| Column | Description |
|---|---|
| `team_id` | Valve team id (unique) |
| `name` | Current team name |
| `tag` | Current tag |
| `logo_url` | Current logo |

### heroes

Valve-id dictionary. Refreshed by `sync_catalogs` (worker boot + daily) from Valve VPK dumps ([dotabuff/d2vpkr](https://github.com/dotabuff/d2vpkr)), same pipeline as [odota/dotaconstants `updateconstants.ts`](https://github.com/odota/dotaconstants/blob/master/tasks/updateconstants.ts). Manual tables (patch / modes / buffs / XP) still come from that repo's `json/`; regions from VPK; cluster from leftover `build/cluster.json`. Event tables store ids and have no FK to catalogs. GetLiveLeagueGames draft uses `hero_id = 0` before a pick.

| Column | Description |
|---|---|
| `hero_id` | Valve hero id (unique). Comes from odota/dotaconstants |
| `name` | Internal name (`npc_dota_hero_*`). Comes from odota/dotaconstants |
| `localized_name` | Display name. Comes from odota/dotaconstants |
| `primary_attr` | Primary attribute. Comes from odota/dotaconstants |
| `attack_type` | Melee / ranged. Comes from odota/dotaconstants |
| `roles` | Role list. Comes from odota/dotaconstants |

### items

Valve item dictionary. No FK from event tables.

| Column | Description |
|---|---|
| `item_id` | Valve item id (unique). Comes from odota/dotaconstants |
| `name` | Internal name. Comes from odota/dotaconstants |
| `localized_name` | Display name. Comes from odota/dotaconstants |
| `cost` | Gold cost. Comes from odota/dotaconstants |

### patches

Lookup for `matches.patch` from `start_time`.

| Column | Description |
|---|---|
| `patch` | Patch string (unique). Comes from odota/dotaconstants |
| `released_at` | Patch release time. Comes from odota/dotaconstants |

### abilities

Spells and talents share one ability-id space. Talents are `kind = talent` (`special_bonus_*`).

| Column | Description |
|---|---|
| `ability_id` | Valve ability id (unique). Comes from odota/dotaconstants |
| `name` | Internal name. Comes from odota/dotaconstants |
| `localized_name` | Display name. Comes from odota/dotaconstants |
| `kind` | `spell` / `talent` / `innate` / `item` / `other`. Comes from odota/dotaconstants |

### hero_abilities

Skill build + talent tree. Unique `(hero_id, slot, is_talent)`. FK to `heroes` / `abilities`.

| Column | Description |
|---|---|
| `hero_id` | Parent hero. Comes from odota/dotaconstants |
| `ability_id` | Ability on this slot. Comes from odota/dotaconstants |
| `slot` | Skill / talent slot. Comes from odota/dotaconstants |
| `is_talent` | Talent-tree row. Comes from odota/dotaconstants |
| `talent_level` | Talent level when `is_talent`. Comes from odota/dotaconstants |

### hero_facets

Unique `(hero_id, facet_id)`. Join `match_players.selected_facet` to `facet_id`.

| Column | Description |
|---|---|
| `hero_id` | Parent hero. Comes from odota/dotaconstants |
| `facet_id` | Facet id. Comes from odota/dotaconstants |
| `name` | Internal name. Comes from odota/dotaconstants |
| `localized_name` | Display name. Comes from odota/dotaconstants |
| `icon` | Facet icon. Comes from odota/dotaconstants |
| `color` | Facet color. Comes from odota/dotaconstants |
| `deprecated` | No longer offered. Comes from odota/dotaconstants |

### permanent_buffs

Catalog for `match_player_buffs.buff_id` (Aghs / Moonshard / …).

| Column | Description |
|---|---|
| `buff_id` | Valve buff id (unique). Comes from odota/dotaconstants |
| `name` | Buff name. Comes from odota/dotaconstants |

### game_modes

Catalog for `matches.game_mode`.

| Column | Description |
|---|---|
| `game_mode` | Valve game-mode id (unique). Comes from odota/dotaconstants |
| `name` | Mode name. Comes from odota/dotaconstants |
| `balanced` | Whether the mode is considered balanced. Comes from odota/dotaconstants |

### lobby_types

Catalog for `matches.lobby_type`.

| Column | Description |
|---|---|
| `lobby_type` | Valve lobby-type id (unique). Comes from odota/dotaconstants |
| `name` | Lobby name. Comes from odota/dotaconstants |
| `balanced` | Whether the lobby is considered balanced. Comes from odota/dotaconstants |

### regions

Valve region id dictionary.

| Column | Description |
|---|---|
| `region` | Valve region id (unique). Comes from odota/dotaconstants |
| `name` | Region name. Comes from odota/dotaconstants |

### clusters

Maps `matches.cluster` → `regions.region`.

| Column | Description |
|---|---|
| `cluster` | Valve cluster id (unique). Comes from odota/dotaconstants |
| `region` | Parent region. Comes from odota/dotaconstants |

### xp_levels

Cumulative XP to reach that hero level.

| Column | Description |
|---|---|
| `level` | Hero level (unique). Comes from odota/dotaconstants |
| `xp` | Cumulative XP required. Comes from odota/dotaconstants |

### match_draft

Unique `(match_id, ord)`. GetLiveLeagueGames writes unordered per-side lists with a local `ord`. The first complete post-game draft (seq / GC / replay, 20–32 rows) may replace that stub; after that, sources only fill null `clock` / `player_slot`. Replay parse stamps `clock` from the gamerules timeline (`replay_draft` first appearance). `CDemoFileInfo.picks_bans` has no per-pick time.

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `ord` | Draft sequence. Comes from GetLiveLeagueGames (local), then GC |
| `is_pick` | `false` = ban. Comes from GetLiveLeagueGames / GC |
| `hero_id` | Hero id; 0 before a pick. Comes from GetLiveLeagueGames / GC |
| `team` | 0 radiant, 1 dire. Comes from GetLiveLeagueGames / GC |
| `player_slot` | Valve slot (0–4 / 128–132). Comes from GC; replay parse fills from `match_players.hero_id` on picks when `-1` |
| `clock` | Seconds into draft. Comes from replay parse |

### match_objectives

Tens of rows per match. First blood from GC `first_blood_time`, then replay parse `CHAT_MESSAGE_*` / combat-log building kills. Event map: [`replay-mapping.md`](./replay-mapping.md).

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `seq` | Sequence inside the match (unique with `match_id`) |
| `time` | Game clock seconds |
| `kind` | `first_blood`, `tower`, `barracks`, `roshan`, `aegis`, `aegis_stolen`, `aegis_denied`, `buyback`, `glyph`, `scan`, `pause`, `reconnect`, `disconnect`, `win`, `courier`, `shrine`, `ward`, `tormentor`, `smoke`, `banner`, `outpost`. Comes from GC (`first_blood`) then replay parse (`CHAT_MESSAGE_*` / combat log) |
| `team` | 0 / 1 / null |
| `slot` | Player slot if applicable |
| `key` | Extra key (tower npc / lane, …) |
| `value` | Extra int |

### match_replays

Replay download and parse status. One row per match.

| Column | Description |
|---|---|
| `match_id` | Parent match (unique) |
| `priority` | `live` / `historical` |
| `status` | `pending` → `downloading` → `stored` → `parsing` → `parsed` / `unavailable` / `failed` |
| `cluster` | Replay CDN cluster. Comes from GC |
| `replay_salt` | Replay salt. Comes from GC |
| `replay_state` | Valve recorded/expired flag. Comes from GC |
| `source_url` | Replay CDN URL used for the download |
| `s3_bucket` | Current object bucket (hot until archive, then cold) |
| `s3_key` | Current object key |
| `bytes` | Object size |
| `stored_at` | When the `.dem.bz2` landed in hot storage |
| `parser_version` | CH schema version of the rows |
| `parsed_at` | When parse published |
| `archived_at` | When the object was copied to cold storage and the hot copy deleted |
| `attempts` | Download / parse attempts |
| `last_error` | Last pipeline error |
| `last_error_at` | When `last_error` was set |
| `next_attempt_at` | Next retry |
| `steam_account_id` | Steam account used for the GC session that fetched salt |
| `proxy_id` | Proxy used for that GC session |

PG `live_match_ticks` / `live_player_ticks` stay in the dump until a later drop. Writers and the drain script target ClickHouse; see [live ticks](#live_match_ticks).

### ingest_cursors

One row per key. Per-league listing cursors are on `leagues`.

| Column | Description |
|---|---|
| `key` | Cursor name. `global_max_match_seq_num` is the high-water of stored details |
| `value` | Cursor value |
| `updated_at` | Last write |

### league_ingest_runs

Log of API-triggered ingest runs.

| Column | Description |
|---|---|
| `run_id` | Run uuid |
| `league_id` | League being ingested |
| `matches_limit` | Optional cap |
| `status` | `queued` / run status |
| `matches_listed` | Matches listed so far |
| `matches_detailed` | Matches detailed so far |
| `replays_enqueued` | Replays enqueued so far |
| `error` | Run error |
| `started_at` | When the run started |
| `finished_at` | When the run finished |

### Indexes

Besides UNIQUE natural keys:

| Table | Index | Query |
|---|---|---|
| `matches` | `(status)`, `(source, status)` | pipeline counts, CLI requeue |
| `matches` | `(league_id, start_time DESC)` | league match list |
| `matches` | `(league_id, history_next_poll_at)` where waiter armed (`history_next_poll_at` set, `match_seq_num` null) | history waiter |
| `matches` | `(last_realtime_at)` where `status = live` and `server_steam_id` set | realtime scan |
| `matches` | `(replay_available_at)` where status in details/awaiting replay | download due |
| `matches` | `(source, start_time DESC)` where details pending | walk enqueue |
| `matches` | `(patch)` where not null | patch replay CLI |
| `match_replays` | `(status)` | inventory |
| `match_replays` | `(priority, stored_at, id)` where `stored` + s3 key | parser claim |
| `match_replays` | `(parsed_at, id)` where parsed and not archived | archive |
| `leagues` | `(status)`, `(status, history_exhausted, history_checked_at)` | walk picker |
| `steam_api_keys` | `(last_used_at)` on pickable statuses; `(account_id)`; `(proxy_id)` | 1 rps pick, occupancy |
| `steam_accounts` | `(status)`, `(proxy_id)` | Game Coordinator session pick, occupancy |
| `proxies` | `(purpose, status)` | assign |
| `match_players` | `(account_id)` | player’s matches |
| `players` | `(current_team_id)` where set | roster |
| `patches` | `(released_at DESC)` | stamp `matches.patch` |
| `series` | `(league_id)` | league series |

Lifecycle columns are named `status`. Enum types are domain-specific (`match_status`, `replay_status`, `league_lifecycle`, …).

---

## ClickHouse

Database `dota`. DDL: [`db/clickhouse/migrations/`](../../db/clickhouse/migrations/), dump [`db/clickhouse/schema.sql`](../../db/clickhouse/schema.sql). Apply with `bun run ch:up` or compose `clickhouse-migrate`. Engines: MergeTree, append-only. Application SQL does not use `FINAL`. No `ingested_at`. Missing values: `0` / `''` / `-1` for slot.

Parser: `packages/parser`. Replays: S3 `.dem.bz2`. Re-parse deletes the previous `match_id` (`ALTER TABLE … DELETE WHERE match_id = {id}`) then inserts. Readers query `replay_*` by `match_id`. Mid-rewrite queries may see a partial match; filter `parser_version = {current}` if needed.

Shared prefix on every `replay_*` table:

- `match_id` — Valve match id, `UInt64 Codec(Delta, ZSTD(1))`
- `start_time` — match start, `DateTime('UTC') Codec(DoubleDelta, ZSTD(1))`, partition key
- `time` — game clock `Int32 Codec(Delta, ZSTD(1))`; negative in pregame. Combat-log also stores `timestamp_raw` (proto field 15 float, unadjusted). Proto field 24 `timestamp_raw` is unused
- `tick` — demo tick, `UInt32 Codec(Delta, ZSTD(1))`
- `slot` — 0–9; `-1` if unknown. Join `match_players` with `player_slot = if(slot < 5, slot, slot + 123)`
- `account_id` — Steam 32-bit; `0` if unknown / not a player. Creeps, buildings, and global chat: `account_id = 0`, `slot = -1`
- `parser_version` — CH schema version

`PARTITION BY toYYYYMM(start_time) ORDER BY (match_id, time, tick)` unless noted. `index_granularity = 8192`.

### live_match_ticks

One row per poll per game. Written by `poll_live_games` and `poll_realtime_stats` after the Postgres transaction. Inserted even when the scoreboard hash is unchanged. MergeTree, insert-only, **no `FINAL`**. `PARTITION BY toYYYYMM(captured_at) ORDER BY (match_id, captured_at, source)`. Application uniqueness is `(match_id, captured_at, source)` — not a CH constraint. `id` is the Postgres serial during backfill and `0` on live inserts (drain script only).

GetLiveLeagueGames fills spectators, towers/rax, roshan, series, stream delay, lobby. GetRealtimeStats fills `duration` (`game_time`), scores, `game_state`, `server_steam_id`; other fields on that `source` are `0`.

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `captured_at` | Poll timestamp |
| `source` | `GetLiveLeagueGames` / `GetRealtimeStats` |
| `league_id` | League of the listing. Comes from GetLiveLeagueGames |
| `duration` | Game clock, seconds. Comes from GetLiveLeagueGames / GetRealtimeStats (`game_time`) |
| `radiant_score` | Radiant kills at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `dire_score` | Dire kills at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `spectators` | Spectator count. Comes from GetLiveLeagueGames |
| `tower_state_radiant` | Radiant tower bitmask. Comes from GetLiveLeagueGames |
| `tower_state_dire` | Dire tower bitmask. Comes from GetLiveLeagueGames |
| `barracks_state_radiant` | Radiant barracks bitmask. Comes from GetLiveLeagueGames |
| `barracks_state_dire` | Dire barracks bitmask. Comes from GetLiveLeagueGames |
| `roshan_respawn_timer` | Roshan respawn timer, seconds. Comes from GetLiveLeagueGames |
| `series_type` | Series type. Comes from GetLiveLeagueGames |
| `radiant_series_wins` | Radiant wins in the series. Comes from GetLiveLeagueGames |
| `dire_series_wins` | Dire wins in the series. Comes from GetLiveLeagueGames |
| `stream_delay_s` | Stream delay, seconds. Comes from GetLiveLeagueGames |
| `lobby_id` | Steam lobby id. Comes from GetLiveLeagueGames |
| `game_number` | Game number in the series. Comes from GetLiveLeagueGames |
| `league_series_id` | League series id. Comes from GetLiveLeagueGames |
| `league_game_id` | League game id. Comes from GetLiveLeagueGames |
| `league_tier` | League tier on the listing. Comes from GetLiveLeagueGames |
| `game_state` | Game state id. Comes from GetRealtimeStats |
| `server_steam_id` | Game server Steam id. Comes from GetRealtimeStats |
| `id` | PG serial on backfill; `0` on live inserts |

### live_player_ticks

One row per poll per player. `ORDER BY (match_id, captured_at, player_slot, source)`. GetLiveLeagueGames fills GPM/XPM/ultimate/respawn. GetRealtimeStats fills backpack `item6`–`item8`; other fields on that `source` are `0`. Same `id` rule as `live_match_ticks`. Future aggregations: `GROUP BY` the order key, no `FINAL`.

| Column | Description |
|---|---|
| `match_id` | Parent match |
| `captured_at` | Poll timestamp |
| `source` | `GetLiveLeagueGames` / `GetRealtimeStats` |
| `player_slot` | Valve player slot |
| `account_id` | Steam 32-bit account. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `hero_id` | Current hero. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `kills` | Kills at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `deaths` | Deaths at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `assists` | Assists at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `last_hits` | Last hits at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `denies` | Denies at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `gold` | Unspent gold at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `net_worth` | Net worth at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `level` | Hero level at poll time. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `gold_per_min` | Gold per minute. Comes from GetLiveLeagueGames |
| `xp_per_min` | XP per minute. Comes from GetLiveLeagueGames |
| `x` | Map x. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `y` | Map y. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `item0` | Inventory slot 0. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `item1` | Inventory slot 1. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `item2` | Inventory slot 2. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `item3` | Inventory slot 3. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `item4` | Inventory slot 4. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `item5` | Inventory slot 5. Comes from GetLiveLeagueGames / GetRealtimeStats |
| `item6` | Backpack slot 0. Comes from GetRealtimeStats |
| `item7` | Backpack slot 1. Comes from GetRealtimeStats |
| `item8` | Backpack slot 2. Comes from GetRealtimeStats |
| `ultimate_state` | Ultimate state. Comes from GetLiveLeagueGames |
| `ultimate_cooldown` | Ultimate cooldown, seconds. Comes from GetLiveLeagueGames |
| `respawn_timer` | Respawn timer, seconds. Comes from GetLiveLeagueGames |
| `id` | PG serial on backfill; `0` on live inserts |

### Codecs

| Kind | Codec |
|---|---|
| `match_id` | `Delta, ZSTD(1)` |
| replay `account_id` / `attacker_account_id` / `target_account_id` | default LZ4 |
| `start_time` | `DoubleDelta, ZSTD(1)` |
| game clock `time`, `tick` | `Delta, ZSTD(1)` |
| gold, nw, xp, lh | `Delta, ZSTD(1)` |
| damage amounts | `T64, ZSTD(1)` |
| enums / `event_type` / `source` / `patch` / `side` | `LowCardinality(String)` |
| interval `x`/`y`, stun | `Gorilla, ZSTD(1)` |
| `replay_actions.pos_*` | `ZSTD(1)` |
| maps | `ZSTD(3)` |

Combat-log unit names (`attacker`, `target`, `inflictor`, `sourcename`, `targetsourcename`) are `LowCardinality(String)`.

### Event catalog → table

From parser NDJSON (`type`) and Valve combat-log / user-message names:

| Parser `type` | ClickHouse table | Notes |
|---|---|---|
| `DOTA_COMBATLOG_*` | `replay_combat_log` | Damage, heal, death, modifiers, gold, xp, purchase, buyback, game state, first blood, building kill, rune, item, ability, killstreak, multikill, playerstats |
| `interval` | `replay_intervals` | ~1 Hz player snapshot |
| `actions` | `replay_actions` | `CDOTAUserMsg_SpectatorPlayerUnitOrders` (`key` = order type) |
| `pings` | `replay_pings` | `CDOTAUserMsg_LocationPing` |
| `obs` / `sen` / `obs_left` / `sen_left` | `replay_wards` | place / expire |
| `chat` / `chatwheel` / channel ids | `replay_chat` | all-chat, team, wheel |
| `CHAT_MESSAGE_*` | `replay_announcements` | tower, roshan, aegis, glyph, pause, … — also copied sparsely to PG `match_objectives` |
| draft timings | `replay_draft` | then upsert PG `match_draft` |
| `DOTA_ABILITY_LEVEL` | `replay_ability_levels` | skill build |
| `STARTING_ITEM` / inventory dumps | `replay_inventory` | starting items + optional later snapshots |
| `neutral_token` / `neutral_item_history` | `replay_neutrals` | combat `PURCHASE` that looks like a tier/neutral item, `CDOTA_Item_*` create, `DOTA_UM_FoundNeutralItem`. Combat `NEUTRAL_ITEM_EARNED` stays in `replay_combat_log` only |
| `cosmetics` | `replay_cosmetics` | wearable def ids |
| item/ability/courier/outpost/roshan/… UM | `replay_alerts` | see [`replay-mapping.md`](./replay-mapping.md) |
| `CDemoFileInfo` + `CDOTAMatchMetadata` | `replay_meta*` | typed post-game facts; no JSON blob |
| `player_slot` | (mapping only) | used while parsing, not stored |

Teamfights are not a stored event.

### replay_combat_log

`CMsgDOTACombatLogEntry` scalars. ~5×10⁴–2×10⁵ rows/match. Names from the `CombatLogNames` string table. Proto field → column: [`replay-mapping.md`](./replay-mapping.md#cmsgdotacombatlogentry-columns). Unknown `DOTA_COMBATLOG_{id}` values are stored; `type` is the raw suffix.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game-clock Int32 from proto `timestamp` (subtract game-start when the stamp looks absolute, `> 1000`) |
| `tick` | Demo tick |
| `slot` | Primary actor slot (`-1` if unknown) |
| `account_id` | Primary actor (attacker, else target); `0` if neither is a hero |
| `parser_version` | CH schema version |
| `type` | Enum name with `DOTA_COMBATLOG_` stripped: `DAMAGE`, `HEAL`, `MODIFIER_ADD` / `REMOVE`, `DEATH`, `ABILITY` / `ABILITY_TRIGGER`, `ITEM`, `LOCATION`, `GOLD` / `ALLIED_GOLD`, `XP`, `PURCHASE`, `BUYBACK`, `GAME_STATE`, `PLAYERSTATS`, `MULTIKILL` / `KILLSTREAK` / `END_KILLSTREAK`, `TEAM_BUILDING_KILL`, `FIRST_BLOOD`, `MODIFIER_STACK_EVENT`, `NEUTRAL_CAMP_STACK`, `PICKUP_RUNE`, `REVEALED_INVISIBLE`, `HERO_SAVED`, `MANA_RESTORED` / `MANA_DAMAGE`, `HERO_LEVELUP`, `BOTTLE_HEAL_ALLY`, `ENDGAME_STATS`, `INTERRUPT_CHANNEL`, `AEGIS_TAKEN`, `PHYSICAL_DAMAGE_PREVENTED`, `UNIT_SUMMONED`, `ATTACK_EVADE`, `TREE_CUT`, `SUCCESSFUL_SCAN`, `BLOODSTONE_CHARGE`, `CRITICAL_DAMAGE`, `SPELL_ABSORB`, `UNIT_TELEPORTED`, `KILL_EATER_EVENT`, `NEUTRAL_ITEM_EARNED`, `STAT_TRACKER_PLAYER` |
| `attacker` | Proto `attacker_name` |
| `target` | Proto `target_name` |
| `inflictor` | Proto `inflictor_name` |
| `sourcename` | Proto `damage_source_name` |
| `targetsourcename` | Proto `target_source_name` |
| `attacker_slot` | Derived from names; `-1` if unknown |
| `target_slot` | Derived from names; `-1` if unknown |
| `attacker_account_id` | `0` if that side is not a player hero |
| `target_account_id` | `0` if that side is not a player hero |
| `value` | Proto `value`: damage / gold / xp / item id / game-state id |
| `value_name` | Resolved name on `PURCHASE` / `ITEM` / `BUYBACK` / `MODIFIER_*` |
| `gold_reason` | Proto gold reason id |
| `xp_reason` | Proto xp reason id |
| `attacker_hero` | Proto `is_attacker_hero` |
| `target_hero` | Proto `is_target_hero` |
| `attacker_illusion` | Proto `is_attacker_illusion` |
| `target_illusion` | Proto `is_target_illusion` |
| `last_hits` | Proto `last_hits` |
| `stun_duration` | Stun seconds |
| `slow_duration` | Slow seconds |
| `health` | Target HP after the event |
| `ability_level` | Ability level |
| `location_x` | `LOCATION` events |
| `location_y` | `LOCATION` events |
| `modifier_duration` | Applied duration on add |
| `timestamp_raw` | Proto `timestamp` (field 15) as float seconds, unadjusted |
| `attacker_team` | `DOTA_GC_TEAM` |
| `target_team` | `DOTA_GC_TEAM` |
| `stack_count` | `MODIFIER_STACK_EVENT` |
| `is_target_building` | Target is a building |
| `rune_type` | `PICKUP_RUNE` |
| `networth` | Net worth on the event |
| `visible_radiant` | Proto `is_visible_radiant` |
| `visible_dire` | Proto `is_visible_dire` |
| `is_ability_toggle_on` | Ability toggled on |
| `is_ability_toggle_off` | Ability toggled off |
| `obs_wards_placed` | Observer wards placed |
| `assist_player0` | First of proto `assist_players`; `0` if absent |
| `assist_player1` | Second assist |
| `assist_player2` | Third assist |
| `assist_player3` | Fourth assist |
| `assist_players` | Full assist list |
| `hidden_modifier` | Hidden modifier flag |
| `neutral_camp_type` | `NEUTRAL_CAMP_STACK` |
| `is_heal_save` | Heal saved the target |
| `is_ultimate_ability` | Ultimate flag |
| `attacker_hero_level` | Attacker hero level |
| `target_hero_level` | Target hero level |
| `xpm` | XPM on the event |
| `gpm` | GPM on the event |
| `event_location` | Event location id |
| `target_is_self` | Target is self |
| `damage_type` | Damage type |
| `invisibility_modifier` | Invisibility modifier flag |
| `damage_category` | Damage category |
| `building_type` | Building type |
| `modifier_elapsed_duration` | Elapsed modifier duration |
| `silence_modifier` | Silence modifier flag |
| `heal_from_lifesteal` | Heal from lifesteal |
| `modifier_purged` | Modifier was purged |
| `spell_evaded` | Spell evaded |
| `motion_controller_modifier` | Motion-controller modifier |
| `long_range_kill` | Long-range kill |
| `modifier_purge_ability` | Ability that purged |
| `modifier_purge_npc` | NPC that purged |
| `root_modifier` | Root modifier flag |
| `total_unit_death_count` | Unit death count |
| `aura_modifier` | Aura modifier flag |
| `armor_debuff_modifier` | Armor debuff flag |
| `no_physical_damage_modifier` | No-physical-damage flag |
| `modifier_ability` | Modifier ability id |
| `modifier_hidden` | Hidden modifier |
| `inflictor_is_stolen_ability` | Stolen-ability inflictor |
| `kill_eater_event` | `KILL_EATER_EVENT` |
| `unit_status_label` | Unit status label |
| `spell_generated_attack` | Spell-generated attack |
| `at_night_time` | Night-time flag |
| `attacker_has_scepter` | Attacker has Aghs |
| `neutral_camp_team` | Neutral camp team |
| `regenerated_health` | Regenerated health |
| `will_reincarnate` | Will reincarnate |
| `uses_charges` | Uses charges |
| `tracked_stat_id` | `STAT_TRACKER_PLAYER` |
| `modifier_purged_duration` | Purged duration |
| `heal_from_regen` | Heal from regen |

### replay_intervals

~1 Hz player snapshot. ~2×10⁴ rows/match. `ORDER BY (match_id, time, tick, slot)`. Entity-field map: [`replay-mapping.md`](./replay-mapping.md#1-hz-snapshot--replay_intervals).

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Player slot 0–9 |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `hero_id` | `m_nSelectedHeroID` |
| `variant` | `m_nSelectedHeroVariant` / facet key low 8 bits |
| `facet_hero_id` | `m_iHeroFacetKey >> 32` |
| `unit` | Hero class name |
| `x` | Hero origin x |
| `y` | Hero origin y |
| `gold` | `m_vecDataTeam` earned gold |
| `lh` | Last hits |
| `xp` | Experience |
| `networth` | Net worth |
| `denies` | Denies |
| `level` | Hero level |
| `kills` | `m_vecPlayerTeamData` kills |
| `deaths` | Deaths |
| `assists` | Assists |
| `life_state` | Hero `m_lifeState` |
| `stuns` | Cumulative stun seconds |
| `obs_placed` | Observer ward count |
| `sen_placed` | Sentry ward count |
| `creeps_stacked` | Creeps stacked |
| `camps_stacked` | Camps stacked |
| `rune_pickups` | Runes picked up |
| `towers_killed` | Towers killed |
| `roshans_killed` | Roshans killed |
| `teamfight_participation` | Teamfight participation |
| `firstblood_claimed` | First blood claimed |
| `draft_stage` | Gamerules `m_nGameState` |
| `repicked` | Repicked |
| `randomed` | Randomed |
| `pred_vict` | Predicted victory |
| `hp` | Current HP |
| `max_hp` | Max HP |
| `mana` | Current mana |
| `max_mana` | Max mana |
| `respawn` | Seconds left from `m_flRespawnTime` |

### replay_actions

One row per `DOTA_UM_SpectatorPlayerUnitOrders`.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Ordering player slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `order_type` | Valve `dotaunitorder_t` (`key` in older parser notes) |
| `unit_index` | First unit in the list; `-1` if absent |
| `target_index` | Target entity; `-1` if absent |
| `ability_id` | Ability id; `-1` if absent |
| `pos_x` | Order position x |
| `pos_y` | Order position y |
| `pos_z` | Order position z |
| `queued` | Proto `queue` |

### replay_pings

`DOTA_UM_LocationPing` and `DOTA_UM_MinimapEvent`. Ability / facet / item alerts are in `replay_alerts`.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Pinging player slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `x` | Map x |
| `y` | Map y |
| `ping_type` | `CDOTAMsg_LocationPing.type` or minimap `event_type` |
| `target` | Entity handle; `-1` if none |

### replay_wards

Entity create/leave on observer and sentry ward classes.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Placing / owning player slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `kind` | `obs` / `sen` |
| `is_left` | `0` place, `1` expire/destroy |
| `x` | Ward x |
| `y` | Ward y |
| `z` | Ward z |
| `ehandle` | Entity index so place and leave join |

### replay_chat

All-chat, team chat, and chat wheel.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Speaker slot; `-1` if unknown |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `kind` | `chat` / `chatwheel` |
| `key` | Message text, wheel id, or `SayText2.messagename` |
| `unit` | Speaker prefix (`SayText2.param1`) when set |
| `channel` | `CDOTAUserMsg_ChatMessage.channel_type` |

### replay_announcements

`DOTA_UM_ChatEvent`. Also written sparsely to PG `match_objectives`. Unknown `CHAT_MESSAGE_{id}` values are stored.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Related player slot; `-1` if unused |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `kind` | `CHAT_MESSAGE_TOWER_KILL`, … |
| `player1` | Proto `playerid_1`; `-1` if unused |
| `player2` | Proto `playerid_2`; `-1` if unused |
| `player3` | Proto `playerid_3`; `-1` if unused |
| `value` | Event value |
| `value2` | Extra int |
| `value3` | Extra int |

### replay_alerts

Spectator/user messages not stored in combat, chat, or orders. `kind` list: [`replay-mapping.md`](./replay-mapping.md#alerts--replay_alerts).

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Primary player slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `kind` | `item_alert`, `courier_killed`, `roshan_timer`, … |
| `player2` | Second player when the message has one; `-1` else |
| `value` | Item / ability / gold / team / type |
| `value2` | Extra int (tier, xp, flags, …) |
| `x` | Map line / ping confirm / item alert |
| `y` | Map line / ping confirm / item alert |
| `key` | Name when the wire sends a string (`shared_cooldown`) |

### replay_draft

Gamerules pick/ban timeline while `m_nGameState == 2`. First appearance of each `(hero_id, is_pick)` stamps PG `match_draft.clock`. `CDemoFileInfo` is the official order only.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Picking player slot; `-1` if unknown |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `is_pick` | `0` ban, `1` pick |
| `hero_id` | Hero id |
| `team` | `0` radiant, `1` dire |
| `ord` | Local sequence in this parse |
| `clock` | Seconds into draft |
| `extra_time_radiant` | Radiant reserve time remaining |
| `extra_time_dire` | Dire reserve time remaining |

### replay_ability_levels

A row when a hero ability slot’s level increases.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Hero slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `ability_id` | Ability class or string-table name |
| `ability_level` | New ability level |
| `target` | Hero npc name |

### replay_inventory

Combat `PURCHASE` with `time <= 90` (`item_slot = -1`) and later `m_hItems` handle changes (slots 0–20, backpack / stash included). Empty `item_id` on a later row means that slot was cleared.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Player slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `item_id` | Item class or name |
| `item_slot` | `-1` starting purchase; `0`–`20` inventory |
| `charges` | Charges when the item entity exists |
| `secondary_charges` | Secondary charges when the item entity exists |

### replay_neutrals

Neutral tokens and found neutrals. Combat `NEUTRAL_ITEM_EARNED` stays in `replay_combat_log` only.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Player slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `kind` | `purchase` / `neutral_item` / `found` |
| `key` | Item name or ability id |
| `value` | Item / ability id |

### replay_cosmetics

`CDOTAWearableItem` definition index + account. Deduped per `(account, item)`. `ORDER BY (match_id, slot, item_id)`.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Player slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `item_id` | Wearable definition index |

### replay_meta

One row per match from `CDemoFileInfo` + `CDOTAMatchMetadata`. `slot` is `-1`, `account_id` is `0`. Seasonal / cosmetic leftover fields (event_data, strange gems, cavern, contracts, equipped econ) are not stored. Winner / team ids are also on Postgres `matches`.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | `-1` on this match-level row |
| `account_id` | `0` on this match-level row |
| `parser_version` | CH schema version |
| `playback_time` | Demo playback time |
| `playback_ticks` | Demo playback ticks |
| `playback_frames` | Demo playback frames |
| `game_winner` | Winner team |
| `radiant_team_id` | Radiant team id |
| `dire_team_id` | Dire team id |
| `metadata_version` | Metadata proto version |
| `lobby_id` | Lobby id |

### replay_meta_teams

One row per side.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | `-1` on this team-level row |
| `account_id` | `0` on this team-level row |
| `parser_version` | CH schema version |
| `dota_team` | `2` radiant / `3` dire |
| `cm_first_pick` | Captains Mode first pick |
| `cm_captain_player_id` | Captains Mode captain |
| `cm_penalty` | Captains Mode penalty |
| `graph_experience` | Team XP graph |
| `graph_gold_earned` | Team gold graph |
| `graph_net_worth` | Team net-worth graph |

### replay_meta_players

One row per player. `ORDER BY (match_id, slot)`.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Player slot 0–9 |
| `account_id` | Steam 32-bit |
| `parser_version` | CH schema version |
| `valve_slot` | Valve player slot |
| `team_number` | Team number |
| `team_slot` | Slot inside the team |
| `camps_stacked` | Camps stacked |
| `lane_selection_flags` | Draft lane preference |
| `rampages` | Rampages |
| `triple_kills` | Triple kills |
| `aegis_snatched` | Aegis snatched |
| `rapiers_purchased` | Rapiers purchased |
| `couriers_killed` | Couriers killed |
| `net_worth_rank` | Net-worth rank |
| `support_gold_spent` | Support gold spent |
| `observer_wards_placed` | Observer wards placed |
| `sentry_wards_placed` | Sentry wards placed |
| `wards_dewarded` | Wards dewarded |
| `stun_duration` | Stun duration |
| `fight_score` | Fight score |
| `farm_score` | Farm score |
| `support_score` | Support score |
| `push_score` | Push score |
| `hero_xp` | Hero XP |
| `ability_upgrades` | Ability-id list |
| `level_up_times` | Level-up clocks |
| `graph_net_worth` | Net-worth graph |
| `graph_hero_damage` | Hero-damage graph |

### replay_meta_kills

One row per kill. Game-clock `time`.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Kill clock |
| `tick` | Demo tick |
| `slot` | Related slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `team` | Team that scored the kill |
| `kill_type` | `player` / `tower` / `barracks` / `roshan` / `miniboss` |
| `victim_slot` | Victim slot |
| `killer_slots` | Killer slots |
| `bounty` | Kill bounty |

### replay_meta_player_kills

Kill matrix: `slot` killed `victim_slot` this many `count` times. `ORDER BY (match_id, slot, victim_slot)`.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Game clock seconds |
| `tick` | Demo tick |
| `slot` | Killer slot |
| `account_id` | Killer Steam 32-bit |
| `parser_version` | CH schema version |
| `victim_slot` | Victim slot |
| `count` | Times `slot` killed `victim_slot` |

### replay_meta_purchases

One row per buy. `time` is purchase clock.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Purchase clock |
| `tick` | Demo tick |
| `slot` | Buyer slot |
| `account_id` | Steam 32-bit |
| `parser_version` | CH schema version |
| `item_id` | Item id |

### replay_meta_inventory

~30 s inventory snapshot.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Snapshot clock |
| `tick` | Demo tick |
| `slot` | Player slot |
| `account_id` | Steam 32-bit |
| `parser_version` | CH schema version |
| `item_ids` | Inventory item ids |
| `backpack_item_ids` | Backpack item ids |
| `neutral_item_id` | Neutral item |
| `neutral_enhancement_id` | Neutral enhancement |
| `kills` | Kills at snapshot |
| `deaths` | Deaths at snapshot |
| `assists` | Assists at snapshot |
| `level` | Level at snapshot |
| `last_hits` | Last hits at snapshot |
| `denies` | Denies at snapshot |
| `flags` | Snapshot flags |

### replay_meta_tips

One row per tip.

| Column | Description |
|---|---|
| `match_id` | Valve match id |
| `start_time` | Match start (UTC), partition key |
| `time` | Tip clock |
| `tick` | Demo tick |
| `slot` | Related slot |
| `account_id` | Steam 32-bit; `0` if unknown |
| `parser_version` | CH schema version |
| `source_slot` | Tipper slot |
| `target_slot` | Receiver slot |
| `tip_amount` | Tip amount |
| `event_id` | Tip event id |

### Volume

Order of magnitude for ~2×10⁵ professional matches: combat log ~10¹⁰ rows, intervals ~4×10⁹.

---

## Source → columns

| Source | Writes |
|---|---|
| `GetLeagueInfoList` | `leagues` |
| `GetLiveLeagueGames` | `matches` (live, including `lobby_id` / logos / series ids), `ingest_sources`, `match_players` (roster/scoreboard items), `match_draft` (provisional), CH `live_*` ticks |
| `GetTopLiveGame` | `matches.server_steam_id`, `ingest_sources`, live status |
| `GetRealtimeStats` | live PG scoreboard/draft plus CH `live_*` ticks (`source = GetRealtimeStats`, `game_state`, `server_steam_id`, backpack `item6`–`item8`). Those ticks do not get GPM/XPM/ultimate/respawn |
| `GetMatchHistory` (`league_id`) | `match_id` / `match_seq_num` / series / teams; live-finished waiter (paginated until found or league exhausted) |
| `GetMatchHistoryBySequenceNum` | box score, draft, backpack, ability upgrades, captains, `seq_fetched_at`. Worker `fetch_seq_details` (`matches_requested = 1`); CLI `persistSeqMatches` batch |
| GC `CMsgGCMatchDetailsResponse` → `CMsgDOTAMatch` | `cluster` / `replay_salt`, box score, draft, team columns. `item_6..8` map to backpack. `match_replays.steam_account_id` / `proxy_id` |
| Replay parse | CH `replay_*`, PG `match_objectives`, parse summaries on `match_players`, `match_draft.clock` (complete details draft is left in place), `matches.barracks_status_*` from rax kills, captains + leftover backpack / neutrals / Aghs from metadata |

Seq-num responses include pub matches. A row is kept only if `league_id` is in `leagues`.

GC messages used: `CMsgGCMatchDetailsRequest/Response` (`CMsgDOTAMatch`), `CMsgDOTALiveLeagueGameUpdate`, SourceTV watch list (`CSourceTVGameSmall`). [`dota_gcmessages_client_coaching.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/dota_gcmessages_client_coaching.proto) is unused.
