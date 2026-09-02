# Data schema

Professional Dota 2 matches only. Companions: [`worker-architecture.md`](./worker-architecture.md), [`adr-technology.md`](./adr-technology.md) (runtime and stores).

Postgres holds **entities and match-level facts**. ClickHouse holds **ticks and replay events**. S3 holds **`.dem.bz2`**. JSON blobs are not a source of truth.

## Split

| Store | What | Why |
|---|---|---|
| Postgres | leagues, series, matches, players, teams, heroes, items, draft, box scores, sparse story events, replay/parse status | Mutable, relational, “this match”, worker cursors |
| ClickHouse | live ticks, combat log, 1 s snapshots, chat, wards, orders | Append-only, billions of rows, codecs, **no `FINAL`** |
| S3 | `.dem.bz2` | Bytes; parser reads from here; re-parse is always possible |

**Dropped from ClickHouse:** `dota.match_details_raw`, `dota.source_payloads`. Every Web API / GC field we keep is a column. If Valve adds a field, add a column (or a typed `Map` on that table) — do not stash the whole JSON.

**Dropped from Postgres:** `leagues.payload`, `matches.history_payload` / `details_payload` / `live_payload`, `match_players.payload`. Same rule.

Operational tables (`steam_accounts`, `steam_api_keys`, `proxies`, graphile-worker) stay operational. This spec is the domain model.

---

## Entity model

```
leagues 1──* series 1──* matches
                │            ├── 10 match_players ──> players
                │            ├── * match_draft          (picks and bans, one sequence)
                │            ├── * match_player_buffs
                │            ├── * match_objectives     (Postgres, tens of rows)
                │            ├── 1 match_replay
                │            └── * ClickHouse live_* / replay_*
                └── 2 teams
heroes, items, patches   catalogs keyed by Valve id
```

Names (vs the list in the request):

| Requested | Here | Why |
|---|---|---|
| `players_matches` | `match_players` | “a player in a match”; PK `(match_id, player_slot)` |
| `picks` + `bans` | `match_draft` | One `ord` sequence; two tables split draft order |
| — | `series` | First-class Bo1/Bo3/Bo5 |
| — | `match_objectives` | Story of the game without querying ClickHouse |
| — | `items`, `patches` | Events store ids; stamp `matches.patch` |

---

## Postgres

### `leagues`

Valve `GetLeagueInfoList` plus our lifecycle.

| Column | Notes |
|---|---|
| `league_id` PK | |
| `name`, `tier`, `region` | `tier`: 1 amateur … 4 international (Valve) |
| `total_prize_pool` | |
| `start_timestamp`, `end_timestamp`, `most_recent_activity` | Unix seconds from Valve |
| `valve_status` | Publication flag (5 ≈ concluded), **not** “games are being played” |
| `status` | `UPCOMING` / `LIVE` / `FINISHED` — **derived**, see workers spec |
| `last_match_seq_num` | Highest `match_seq_num` stored for this league |
| `history_head_match_id` | Newest listed `match_id` (detect new games on the next run) |
| `history_tail_match_id` | `start_at_match_id` for walking **older** pages |
| `history_exhausted` | Older pagination returned nothing |
| `history_checked_at` | Last GetMatchHistory touch |
| `fetched_at`, `updated_at` | |

Indexes: `(status)`, `(most_recent_activity DESC)`.

Valve will leave a league `LIVE` until a far `end_timestamp` even when `most_recent_activity` is months ago. That is **not** live ingest; it is historical. Derivation is in the workers spec.

### `series`

Valve `series_id` is often 0 on live games. Analysts still need a grouping key.

| Column | Notes |
|---|---|
| `series_id` PK | Valve id when `> 0`; otherwise synthetic (below) |
| `league_id` | |
| `radiant_team_id`, `dire_team_id` | First-game orientation; do not swap the row when sides flip later |
| `series_type` | 0 none, 1 Bo3, 2 Bo5, … |
| `radiant_wins`, `dire_wins` | Last observed |
| `first_match_id`, `last_match_id` | |
| `started_at`, `ended_at` | From match `start_time` |

Synthetic id: when Valve id is 0, hash `(league_id, least(t1,t2), greatest(t1,t2), first_match_id)` into a bigint in a reserved high range so it never collides with Valve ids. Matches keep `series_id` FK.

### `matches`

One row per game. Denormalize **team names at game time** (orgs rename). Do not denormalize league name.

| Column | Source |
|---|---|
| `match_id` PK | all |
| `league_id` | history / live / details |
| `series_id`, `series_type` | live / history |
| `radiant_series_wins`, `dire_series_wins` | live (score in the series) |
| `league_node_id` | bracket node |
| `match_seq_num` | details / history |
| `start_time`, `duration`, `pre_game_duration` | details |
| `radiant_win` | details |
| `radiant_score`, `dire_score` | details |
| `tower_status_radiant`, `tower_status_dire` | details bitmasks |
| `barracks_status_radiant`, `barracks_status_dire` | details |
| `first_blood_time` | details |
| `lobby_id` | live GetLiveLeagueGames |
| `match_flags` / `flags` | details / GC |
| `match_outcome` | GC `EMatchOutcome`; also derives `radiant_win` (2 rad / 3 dire) |
| `game_balance` | GC float |
| `radiant_team_logo`, `dire_team_logo` | live `team_logo` / GC uint64 / details `radiant_logo` |
| `radiant_team_logo_url`, `dire_team_logo_url` | GC |
| `radiant_team_tag`, `dire_team_tag` | GC |
| `radiant_guild_id`, `dire_guild_id` | GC |
| `tournament_id`, `tournament_round` | GC |
| `league_series_id`, `league_game_id`, `game_number`, `stage_name`, `league_tier` | live |
| `human_players` | details |
| `cluster`, `replay_salt` | details and/or GC |
| `radiant_team_id`, `dire_team_id` | |
| `radiant_team_name`, `dire_team_name` | snapshot |
| `radiant_team_complete`, `dire_team_complete` | details |
| `radiant_captain`, `dire_captain` | details |
| `positive_votes`, `negative_votes` | details (keep; cheap) |
| `patch` | derived from `start_time` vs `patches` |
| `stream_delay_s` | live |
| `phase` | `discovered` → `live` → `awaiting_details` → `details_ready` → `awaiting_replay` → `replay_stored` / `replay_unavailable` / `failed` |
| `source` | `live` / `historical` — **sticky**: live origin stays `live` even if history lists it later (replay priority) |
| `live_seen_at`, `live_disappeared_at`, `live_disappeared_count` | finish detection |
| `details_fetched_at` | |
| `finished_at` | `live_disappeared_at`, else `to_timestamp(start_time + duration)` |
| `replay_available_at` | live: `finished_at + 30 minutes`; historical: `now()` |
| `last_error`, `last_error_at`, `attempts`, `next_attempt_at` | |
| `created_at`, `updated_at` | |

Indexes: `(league_id, start_time DESC)`, `(phase)`, `(match_seq_num)`, `(source, phase)`, partial `(replay_available_at)` where phase is awaiting replay.

### `match_players`

PK `(match_id, player_slot)`. Slot 0–4 radiant, 128–132 dire.

Box score from **GetMatchHistoryBySequenceNum / GC `CMsgDOTAMatch.Player`**, overwritten when a richer source arrives. Live scoreboard updates the same row while `phase = live`.

**Identity:** `account_id`, `player_name` (snapshot), `pro_name`, `real_name` (GC), `hero_id`, `hero_variant` / `selected_facet`, `team_number`, `team_slot`, `side`

**KDA / farm:** `kills`, `deaths`, `assists`, `last_hits`, `denies`, `net_worth`, `gold`, `gold_spent`, `gold_per_min`, `xp_per_min`, `level`, plus GC `claimed_farm_gold`, `support_gold`, `claimed_denies`, `claimed_misses`, `misses`, `bounty_runes`, `outposts_captured`, `seconds_dead`, `gold_lost_to_death`

**Damage:** `hero_damage`, `tower_damage`, `hero_healing`, `scaled_hero_damage`, `scaled_tower_damage`, `scaled_hero_healing`, `scaled_kills` / `scaled_deaths` / `scaled_assists` (GC). Per-type pre/post reduction is child table `match_player_damage_breakdown`.

**Items:** `item_0`…`item_5`, `item_6`…`item_10` + `item_10_lvl` (GC extra slots), `item_neutral`, `item_neutral2`, `backpack_0`…`backpack_3`, `aghanims_scepter`, `aghanims_shard`, `moonshard`

**Other details:** `ability_upgrades integer[]` plus timed rows in `match_player_ability_upgrades`; `leaver_status`, `party_id` (bigint), `party_size`, `hero_pick_order`, `hero_was_randomed`, `lane_selection_flags`, `support_ability_value`, `disable_duration`; `additional_units` — child table `match_player_units`

**Parse summaries** (filled after replay, still one row per player): `lane`, `lane_role`, `is_roaming`, `stuns`, `teamfight_participation`, `towers_killed`, `roshans_killed`, `observers_placed`, `sentries_placed`, `camps_stacked`, `creeps_stacked`, `rune_pickups`, `firstblood_claimed`

Time series (`gold_t`, `lh_t`, purchase log, damage maps) **do not** live here — they are ClickHouse rows.

### `match_player_buffs`

PK `(match_id, player_slot, buff_id)`. Stack counts of permanent buffs (Aghs, Moonshard, …). `grant_time` from GC when present.

### `match_player_ability_upgrades`

PK `(match_id, player_slot, seq)`. Seq-num / GC `{ability, time, level}` (`CMatchPlayerAbilityUpgrade`). The `integer[]` on `match_players` is the ability-id list only.

### `match_player_damage_breakdown`

PK `(match_id, player_slot, direction, damage_type)`. GC `hero_damage_received` / `hero_damage_dealt` (`pre_reduction`, `post_reduction`). `direction` is `received` or `dealt`.

### `match_coaches`

PK `(match_id, account_id)`. `CMsgDOTAMatch.Coach` on the match proto — public lobby coaches, **not** the private coaching proto.

### `match_broadcasters`

PK `(match_id, seq)`. GC broadcaster channels (country, language, caster account).

### `players`

| Column | Notes |
|---|---|
| `account_id` PK | 32-bit Steam account id |
| `steam_id` | 64-bit, optional |
| `persona_name` | last seen |
| `is_pro` | true once seen in a league match |
| `current_team_id` | last team in a stored match (best-effort) |
| `last_match_id`, `last_match_at` | |
| `updated_at` | |

### `teams`

`team_id`, `name`, `tag`, `logo_url`, `updated_at`. Names on `matches` are the snapshot; this row is “current”.

### `heroes` / `items` / `patches`

Static catalogs, refreshed on patch. Events store **ids only**.

- `heroes`: `id`, `name`, `localized_name`, `primary_attr`, `attack_type`, `roles[]`
- `items`: `id`, `name`, `localized_name`, `cost`
- `patches`: `patch` text PK, `released_at` — stamps `matches.patch`

### `match_draft`

PK `(match_id, ord)`.

| Column | Notes |
|---|---|
| `is_pick` | false = ban |
| `hero_id` | |
| `team` | 0 radiant, 1 dire |
| `player_slot` | if known (replay draft timings) |
| `clock` | seconds into draft, from replay when parsed |

Live GetLiveLeagueGames only has unordered per-side lists; write them with a local `ord`, then **replace** the rows when details/replay have the real order.

### `match_objectives`

Sparse Postgres timeline for “what happened in this game” without ClickHouse. Tens of rows per match, not thousands.

Filled from details (`first_blood_time`) before parse, then from parser `CHAT_MESSAGE_*` / combat-log building kills after parse.

| Column | Notes |
|---|---|
| `match_id`, `seq` | PK |
| `time` | game clock seconds |
| `kind` | see below |
| `team` | 0 / 1 / null |
| `slot` | player_slot if applicable |
| `key` | e.g. tower npc / lane |
| `value` | extra int |

`kind` values (from `CDOTAUserMsg_ChatEvent` + combat log):

`first_blood`, `tower`, `barracks`, `roshan`, `aegis`, `aegis_stolen`, `buyback`, `glyph`, `scan`, `pause`, `reconnect`, `disconnect`, `win`

These are the rows an analyst dashboard hits first. The full event stream stays in ClickHouse.

### `match_replays`

Pipeline, not analytics. Enum grows vs today: add `parsing`, `parsed`.

| Column | Notes |
|---|---|
| `match_id` PK | |
| `priority` | `live` / `historical` |
| `status` | `pending` → `awaiting_gc` → `downloading` → `stored` → `parsing` → `parsed` / `unavailable` / `failed` |
| `cluster`, `replay_salt`, `replay_state` | |
| `s3_bucket`, `s3_key`, `bytes` | |
| `parser_version` | CH schema version of the rows |
| `parsed_at` | |
| `attempts`, `last_error`, `next_attempt_at` | |
| `steam_account_id`, `proxy_id` | who fetched salt / downloaded |

### Cursors

`ingest_cursors` (one row, key/value):

- `global_max_match_seq_num` — high-water of details we have seen (**not** a pub-match walk)

Per-league listing cursors live on `leagues`. `league_ingest_runs` stays as an operator log for API kicks; the steady walker does not depend on it.

---

## ClickHouse

Database `dota`. DDL is dbmate in [`db/clickhouse/migrations/`](../../db/clickhouse/migrations/); dump [`db/clickhouse/schema.sql`](../../db/clickhouse/schema.sql). Apply with `bun run ch:up` or the `clickhouse-migrate` compose service. Application code does not `CREATE TABLE`. Engines are **MergeTree**, append-only. No ReplacingMergeTree, no CollapsingMergeTree, **no `FINAL` in application SQL**.

Fixes (rare): insert a new row with a higher `ingested_at` and query `argMax(col, ingested_at)` in a view — or treat match-level facts as Postgres-only.

Re-parse: `ALTER TABLE … DELETE WHERE match_id = {id}` (lightweight delete, ClickHouse 23+) then insert. Queries that must not see a half-rewritten match filter `parser_version = {current}` until the mutation finishes. Do not use `FINAL` to hide duplicates.

Avoid `Nullable`. Missing = `0` / `''` / `-1` for slot.

### Codecs

| Kind | Codec |
|---|---|
| `match_id`, `account_id` (sorted, repeating) | `Delta, ZSTD(1)` |
| `captured_at`, `start_time` | `DoubleDelta, ZSTD(1)` |
| game clock `time`, `tick` | `Delta, ZSTD(1)` |
| slowly changing ints (gold, nw, xp, lh) | `Delta, ZSTD(1)` |
| noisy ints (damage amounts) | `T64, ZSTD(1)` |
| enums / `event_type` / `source` / `patch` / `side` | `LowCardinality(String)` |
| floats (duration, stun, coordinates) | `Gorilla, ZSTD(1)` |
| leftover maps | `ZSTD(3)` |

`LowCardinality` on `hero_id` is not worth it (many distinct). **Do not** put `LowCardinality` on combat-log unit names (`attacker`, `target`) — illusion / creep names blow the dictionary.

Partition **live** tables by calendar month of **capture**. Partition **replay** tables by month of **match start** (`toYYYYMM(start_time)`), so one match sits in one partition. Do not partition by insert time.

`index_granularity = 8192` (default). `ORDER BY (match_id, time, tick)` is the query pattern: “this game’s timeline”.

### `live_match_ticks`

One row per poll per live game (every poll — spectator/duration graphs need the zeros). **No `payload` String.**

```
match_id            UInt64   Codec(Delta, ZSTD(1))
captured_at         DateTime64(3, 'UTC')  Codec(DoubleDelta, ZSTD(1))
league_id           UInt32
duration            Float32  Codec(Gorilla, ZSTD(1))
radiant_score       UInt16
dire_score          UInt16
spectators          UInt32
tower_state_radiant UInt32
tower_state_dire    UInt32
barracks_state_radiant UInt32
barracks_state_dire UInt32
roshan_respawn_timer UInt16
series_type         UInt8
radiant_series_wins UInt8
dire_series_wins    UInt8
stream_delay_s      UInt16
source              LowCardinality(String)  -- GetLiveLeagueGames | GetRealtimeStats
lobby_id            UInt64
game_number         UInt8
league_series_id    UInt32
league_game_id      UInt32
league_tier         UInt8
```

`ENGINE = MergeTree PARTITION BY toYYYYMM(captured_at) ORDER BY (match_id, captured_at)`

### `live_player_ticks`

Same grain, one row per player on the scoreboard.

`match_id, captured_at, player_slot` + `account_id, hero_id, kills, deaths, assists, last_hits, denies, gold, net_worth, level, gold_per_min, xp_per_min, x, y` (`position_x` / `position_y` from GetLiveLeagueGames), `item0`…`item5`, `ultimate_state`, `ultimate_cooldown`, `respawn_timer`.

`ORDER BY (match_id, captured_at, player_slot)`

Default live source is GetLiveLeagueGames only. GetTopLiveGame + GetRealtimeStats is optional enrichment (see workers spec); it must not be required to fill this table.

### Replay tables

Parser: in-process Source 2 demo parse → NDJSON (`type` per combat-log / interval / chat / …). We do not collapse into one JSON document. `parse_replay` always runs after a replay is stored in S3.

Shared prefix on every replay table:

```
match_id    UInt64   Codec(Delta, ZSTD(1))
start_time  DateTime('UTC')          -- match start, for partition
time        Int32    Codec(Delta, ZSTD(1))   -- game clock; negative in pregame
tick        UInt32   Codec(Delta, ZSTD(1))
slot        Int8                     -- player slot or -1
parser_version  UInt16
```

`PARTITION BY toYYYYMM(start_time) ORDER BY (match_id, time, tick)`

#### Event catalog → table

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
| `neutral_token` / `neutral_item_history` | `replay_neutrals` | |
| `cosmetics` | `replay_cosmetics` | wearable def ids |
| `epilogue` | `replay_epilogue` | one row; match end blob typed into columns we use |
| `player_slot` | (mapping only) | used while parsing, not stored |

Teamfights are not a parser event. v1: derive in a query from clustered `DEATH` + `DAMAGE` windows, or a nightly materialized view. Do not block ingest on a teamfight detector.

#### `replay_combat_log`

Bulk of parse volume (~5×10⁴–2×10⁵ rows/match).

| Column | Notes |
|---|---|
| `type` LowCardinality(String) | `DAMAGE`, `HEAL`, `DEATH`, `MODIFIER_ADD`, `MODIFIER_REMOVE`, `PURCHASE`, `GOLD`, `XP`, `BUYBACK`, `GAME_STATE`, `FIRST_BLOOD`, `TEAM_BUILDING_KILL`, `ITEM`, `ABILITY`, … (strip `DOTA_COMBATLOG_` prefix at insert) |
| `attacker`, `target`, `inflictor`, `sourcename`, `targetsourcename` String Codec(ZSTD(1)) | npc names |
| `attacker_slot`, `target_slot` Int8 | |
| `value` Int32 Codec(T64, ZSTD(1)) | damage / gold / xp / item id |
| `value_name` LowCardinality(String) | item name on `PURCHASE` |
| `gold_reason`, `xp_reason` UInt16 | |
| `attacker_hero`, `target_hero`, `attacker_illusion`, `target_illusion` UInt8 | |
| `stun_duration`, `slow_duration` Float32 Codec(Gorilla, ZSTD(1)) | |
| `greevils_greed_stack` UInt16 | parser visitor when present |
| `tracked_death` UInt8, `tracked_sourcename` | Track visitor when present |
| `health`, `ability_level`, `location_x` / `location_y`, `modifier_duration`, `last_hits`, `attacker_team` / `target_team`, `stack_count`, `is_target_building`, `rune_type`, `networth` | `CMsgDOTACombatLogEntry` |
| remaining combat-log proto scalars | same message: visibility, toggles, assists, damage_type, modifiers, kill-eater, etc. — every field Valve sends is a column |

Unknown `DOTA_COMBATLOG_{id}` values (newer than the named enum) are still inserted; `type` is the raw suffix. Do not drop high combat-log type ids.

#### `replay_intervals`/ `lh_t` / `xp_t` / `lane_pos`). ~2×10⁴ rows/match. Gold graphs and farming curves.

From parser interval fields: `slot, hero_id, variant, facet_hero_id, unit, x, y, gold, lh, xp, networth, denies, level, kills, deaths, assists, life_state, stuns, obs_placed, sen_placed, creeps_stacked, camps_stacked, rune_pickups, towers_killed, roshans_killed, teamfight_participation, firstblood_claimed, draft_stage, repicked, randomed, pred_vict, observers_placed`. The parser does not currently emit `hp`.

#### `replay_actions`

One row per unit order. `order_type UInt16` (`key` in the parser). High volume in pro games; still cheaper than aggregating orders into a per-minute map.

#### `replay_pings`

`slot`, optional `x, y` if we enable coordinates later (parser currently counts only).

#### `replay_wards`

`kind` LowCardinality (`obs` / `sen`), `is_left` UInt8, `x, y, z` Float32, `ehandle` UInt32.

#### `replay_chat`

`kind` LowCardinality (`chat` / `chatwheel` / channel), `key` String (message or wheel id), `unit` String (speaker prefix when the parser sets it), `channel` UInt8 (`CDOTAUserMsg_ChatMessage.channel_type`).

#### `replay_announcements`

`kind` LowCardinality (`CHAT_MESSAGE_TOWER_KILL`, …), `player1`, `player2`, `player3`, `value`, `value2`, `value3`. Source for PG `match_objectives`. Unknown `CHAT_MESSAGE_{id}` values are stored, not dropped.

#### `replay_draft` / `replay_ability_levels` / `replay_inventory` / `replay_neutrals` / `replay_cosmetics` / `replay_epilogue`

Small. Keep typed columns, not a JSON dump. Epilogue is one (or few) rows per match.

### Volume (pro-only, order of magnitude)

~2×10⁵ professional matches lifetime: combat log ~10¹⁰ rows, intervals ~4×10⁹, live ticks negligible. ClickHouse-normal. Historical parse trailing by months is acceptable; storage is not the bottleneck, parse CPU is.

---

## Source → columns

| Source | Writes |
|---|---|
| `GetLeagueInfoList` | `leagues` |
| `GetLiveLeagueGames` | `matches` (live, including `lobby_id` / logos / series ids), `match_players` (roster/scoreboard items), `match_draft` (provisional), `live_*` ticks |
| `GetTopLiveGame` + `GetRealtimeStats` | extra live tick fields when enabled; **not** required |
| `GetMatchHistory` (`league_id`) | discover `match_id` / `match_seq_num` / series / teams |
| `GetMatchHistoryBySequenceNum` | full `matches` + `match_players` + `match_draft` for targets **and** any other known-league match that landed in the window. Optional HTTP details — `GetMatchDetails` is gone for good. |
| GC `CMsgGCMatchDetailsResponse` → `CMsgDOTAMatch` | **Primary** fill for `cluster` / `replay_salt` and for box-score columns when HTTP details never ran. Same PG columns as seq-num. |
| Replay parse | CH `replay_*`, PG `match_objectives`, parse summaries on `match_players`, `match_draft` clocks |

Seq-num responses contain **pub matches**. Keep a row only if `league_id` is in `leagues` (defence in depth). Do not store pubs “because they were in the window”.

### GC vs the coaching proto

[`dota_gcmessages_client_coaching.proto`](https://github.com/SteamDatabase/GameTracking-Dota2/blob/master/Protobufs/dota_gcmessages_client_coaching.proto) is **private coaching** (friend coach, ratings). It is not a live-pro feed and is out of scope.

Useful GC messages:

- `CMsgGCMatchDetailsRequest/Response` → full `CMsgDOTAMatch` (salt, box score, extra slots, coaches, broadcasters)
- `CMsgDOTALiveLeagueGameUpdate` (count of live league games)
- SourceTV / watch list (`CSourceTVGameSmall`) — same lobby ids GetTopLiveGame uses

Live **metrics** come from Web API scoreboards first. GC is the replay locator **and** the details source that replaced `GetMatchDetails`.

---

## What “not losing data” means

1. Every scalar on `CMsgDOTAMatch` / seq-num has a Postgres column or a child table.
2. Every combat-log enum value and interval snapshot from the demo parser is a ClickHouse row.
3. Parser announcement types that describe the story of the game are also in Postgres `match_objectives`.
4. The replay file stays in S3 so we can re-parse with a new `parser_version`.
5. We do **not** keep a second copy of those payloads as JSON — that is what `match_details_raw` was, and it is how useful fields stay unqueryable.

Out of scope on purpose (product/community, not match facts): community profiles, mmr / rank_tier, public_matches, scenarios, webhooks, notable_players as a separate crawl.
