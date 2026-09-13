# Data schema

Professional Dota 2 matches only. Companions: [`worker-architecture.md`](./worker-architecture.md), [`adr-technology.md`](./adr-technology.md) (runtime and stores), [`demo-file.md`](./demo-file.md) (what is inside a `.dem`).

Postgres holds **entities and match-level facts**. ClickHouse holds **ticks and replay events**. S3 holds **`.dem.bz2`**. JSON blobs are not a source of truth.

## Split

| Store | What | Why |
|---|---|---|
| Postgres | leagues, series, matches, players, teams, heroes, items, draft, box scores, sparse story events, replay/parse status | Mutable, relational, “this match”, worker cursors |
| ClickHouse | live ticks, combat log, 1 s snapshots, chat, wards, orders | Append-only, billions of rows, codecs, **no `FINAL`** |
| S3 | `.dem.bz2` | Bytes; parser reads from here; re-parse is always possible |

**Dropped from ClickHouse:** `dota.match_details_raw`, `dota.source_payloads`. Every Web API / GC field we keep is a column. If Valve adds a field, add a column (or a typed `Map` on that table) — do not stash the whole JSON.

**Dropped from Postgres:** `leagues.payload`, `matches.history_payload` / `details_payload` / `live_payload`, `match_players.payload`. Same rule.

Operational tables (`steam_accounts`, `steam_api_keys`, `proxies`, `settings`, `marketplace_products`, `marketplace_orders`, `resource_attempts`, graphile-worker) stay operational. This spec is the domain model.

Every public table (except dbmate `schema_migrations`) has a surrogate **`id bigserial` primary key** (sequence-backed, backfilled on add) and `created_at` / `updated_at` (before-update trigger `set_updated_at`, which also refuses to change `created_at`). Natural identifiers (`match_id`, `league_id`, `account_id`, `order_id`, `hero_id`, …) are **UNIQUE**, not the PK. FKs still point at those natural keys.

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
heroes, items, patches, abilities, …   catalogs keyed by Valve id
```

Names (vs the list in the request):

| Requested | Here | Why |
|---|---|---|
| `players_matches` | `match_players` | “a player in a match”; unique `(match_id, player_slot)` |
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
| `league_id` unique (Valve) | |
| `name`, `tier`, `region` | `tier`: 1 amateur … 4 international (Valve) |
| `total_prize_pool` | |
| `start_timestamp`, `end_timestamp`, `most_recent_activity` | Unix seconds from Valve |
| `valve_status` | Publication flag (5 ≈ concluded), **not** “games are being played” |
| `status` | `UPCOMING` / `LIVE` / `FINISHED` — **derived**, see workers spec |
| `last_match_seq_num` | Highest `match_seq_num` from GetMatchHistory pages (and backfill `max(matches.match_seq_num)`) |
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
| `series_id` unique | Valve id when `> 0`; otherwise synthetic (below) |
| `league_id` | |
| `radiant_team_id`, `dire_team_id` | First-game orientation; do not swap the row when sides flip later |
| `series_type` | 0 none, 1 Bo3, 2 Bo5, … |
| `radiant_wins`, `dire_wins` | Last observed |
| `first_match_id`, `last_match_id` | |
| `started_at`, `ended_at` | `started_at` from first match `start_time`. `ended_at` when a Bo3/Bo5 side reaches 2/3 wins (live `radiant_series_wins`). Type 0 stays open so the 8-hour synthetic grouping still works. |

Synthetic id: when Valve id is 0, hash `(league_id, least(t1,t2), greatest(t1,t2), first_match_id)` into a bigint in a reserved high range so it never collides with Valve ids. Matches keep `series_id` FK.

### `matches`

One row per game. Denormalize **team names at game time** (orgs rename). Do not denormalize league name.

| Column | Source |
|---|---|
| `match_id` unique | all |
| `league_id` | history / live / details |
| `series_id`, `series_type` | live / history |
| `radiant_series_wins`, `dire_series_wins` | live (score in the series) |
| `league_node_id` | bracket node |
| `match_seq_num` | GetMatchHistory (GC omits it) |
| `start_time`, `duration`, `pre_game_duration` | details |
| `lobby_type`, `game_mode`, `engine` | details / GC. Catalogs: `lobby_types`, `game_modes` |
| `radiant_win` | details |
| `radiant_score`, `dire_score` | details |
| `tower_status_radiant`, `tower_status_dire` | details bitmasks |
| `barracks_status_radiant`, `barracks_status_dire` | details |
| `first_blood_time` | details |
| `lobby_id` | live GetLiveLeagueGames |
| `server_steam_id` | GetTopLiveGame / GetRealtimeStats; Steam uint64 kept as decimal text in JS (`Number` rounds it, GetRealtimeStats then 400s) |
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
| `radiant_captain`, `dire_captain` | replay metadata `cm_captain_player_id` → `match_players.account_id` (GC has no captain fields) |
| `patch` | derived from `start_time` vs `patches` |
| `stream_delay_s` | live |
| `phase` | `discovered` → `live` → `awaiting_history` → `awaiting_details` → `details_ready` → `awaiting_replay` → `replay_stored` → `parsed` / `replay_unavailable` / `failed` / `not_started`. Never rewrite a later phase backwards except a live flap (`not_started`, `awaiting_history`, `awaiting_details`, `failed` go back to `live` if either live feed lists the id again — including an unchanged GetLiveLeagueGames hash that only calls `noteLiveFeedSeen`). |
| `source` | `live` / `historical` — **sticky**: any live feed wins and stays (replay priority) |
| `ingest_sources` | `text[]`, accumulated, never removed: `GetLiveLeagueGames`, `GetTopLiveGame`, `GetMatchHistory` |
| `waiting_for` | `live_end` / `history` / `gc` / `replay` / `parse` / null (`seq` is leftover, no longer written) |
| `live_seen_at`, `live_disappeared_at`, `live_disappeared_count` | last live sighting; flap count (18.1) |
| `live_league_missed_polls`, `top_live_missed_polls` | current miss streak per feed; reset when that feed sees the match |
| `live_duration_max` | max `GetLiveLeagueGames` / `GetRealtimeStats` clock seen while live; 0 means the listing never horned |
| `history_poll_fast_count`, `history_poll_slow_count`, `history_last_polled_at`, `history_next_poll_at` | GetMatchHistory waiter after a **started** live match leaves the feed |
| `seq_fetched_at` | leftover; ingest no longer calls GetMatchHistoryBySequenceNum |
| `details_fetched_at` | GC `CMsgDOTAMatch` persisted |
| `last_realtime_at` | last successful GetRealtimeStats |
| `finished_at` | live disappear **after** `live_duration_max > 0`, else `to_timestamp(start_time + duration)`; stays null for `not_started` |
| `replay_available_at` | live: `finished_at + settings.replay_live_delay_ms` (seed 30 s, first try); historical: `now()`. 404 retries: 1 m, 1 m, 3 m × 20, 1 h × 24, then `replay_unavailable`. |
| `last_error`, `last_error_kind`, `last_error_at`, `attempts` | 8.1: kind is `network` / `rate_limit` / `auth` / `not_ready` / `unavailable` / `history_timeout` / `not_started` / `other`. Replay retries use `match_replays.next_attempt_at`. |
| `last_api_key_id`, `last_steam_account_id`, `last_proxy_id` | which resource last touched the row (ops, not analytics) |
| `created_at`, `updated_at` | |

Indexes: `(league_id, start_time DESC)`, `(phase)`, `(match_seq_num)`, `(source, phase)`, partial `(replay_available_at)` where phase is awaiting replay.

### `match_players`

Unique `(match_id, player_slot)`. Slot 0–4 radiant, 128–132 dire. Live `GetLiveLeagueGames.players[]` has no `player_slot` (and includes `team=4` coaches) — assign per-team index, never the combined array index. Linear 0–9 from some APIs maps 5–9 → 128–132. Replay ClickHouse `slot` is 0–9, `-1` if unknown (draft / global alerts / creeps).

Box score from **GC `CMsgDOTAMatch.Player`**, overwritten when a richer source arrives. Live scoreboard updates the same row while `phase = live`. Replay metadata fills captains and leftover backpack / neutral / Aghs columns on parse.

**Identity:** `account_id`, `player_name` (snapshot), `pro_name`, `real_name` (GC), `hero_id`, `hero_variant` / `selected_facet`, `team_number`, `team_slot`, `side`

**KDA / farm:** `kills`, `deaths`, `assists`, `last_hits`, `denies`, `net_worth`, `gold`, `gold_spent`, `gold_per_min`, `xp_per_min`, `level`, plus GC `claimed_farm_gold`, `support_gold`, `claimed_denies`, `claimed_misses`, `misses`, `bounty_runes`, `outposts_captured`, `seconds_dead`, `gold_lost_to_death`

**Damage:** `hero_damage`, `tower_damage`, `hero_healing`, `scaled_hero_damage`, `scaled_tower_damage`, `scaled_hero_healing`, `scaled_kills` / `scaled_deaths` / `scaled_assists` (GC). Per-type pre/post reduction is child table `match_player_damage_breakdown`.

**Items:** `item_0`…`item_5`, `item_6`…`item_10` + `item_10_lvl` (GC extra slots), `item_neutral`, `item_neutral2`, `backpack_0`…`backpack_2`, `aghanims_scepter`, `aghanims_shard`, `moonshard`. Valve `-1` (empty) is stored as `0`.

**Other details:** `ability_upgrades integer[]` plus timed rows in `match_player_ability_upgrades`; `leaver_status`, `party_id` (bigint), `hero_pick_order`, `hero_was_randomed`, `lane_selection_flags`, `support_ability_value`, `disable_duration`; `additional_units` — child table `match_player_units` (`unit_name`, `item_0`…`item_5`, unique `(match_id, player_slot, unit_name)`)

**Parse summaries** (filled after replay, still one row per player): `lane`, `lane_role`, `is_roaming`, `stuns`, `teamfight_participation`, `towers_killed`, `roshans_killed`, `observers_placed`, `sentries_placed`, `camps_stacked`, `creeps_stacked`, `rune_pickups`, `firstblood_claimed`

Time series (`gold_t`, `lh_t`, purchase log, damage maps) **do not** live here — they are ClickHouse rows.

### `match_player_buffs`

Unique `(match_id, player_slot, buff_id)`. Stack counts of permanent buffs (Aghs, Moonshard, …). `grant_time` from GC when present.

### `match_player_ability_upgrades`

Unique `(match_id, player_slot, seq)`. Seq-num / GC `{ability, time, level}` (`CMatchPlayerAbilityUpgrade`). The `integer[]` on `match_players` is the ability-id list only.

### `match_player_damage_breakdown`

Unique `(match_id, player_slot, direction, damage_type)`. GC `hero_damage_received` / `hero_damage_dealt` (`pre_reduction`, `post_reduction`). `direction` is `received` or `dealt`.

### `match_coaches`

Unique `(match_id, account_id)`. `CMsgDOTAMatch.Coach` on the match proto — public lobby coaches, **not** the private coaching proto.

### `match_broadcasters`

Unique `(match_id, seq)`. GC broadcaster channels (country, language, caster account).

### `players`

| Column | Notes |
|---|---|
| `account_id` unique | 32-bit Steam account id |
| `steam_id` | Steam64 text: `76561197960265728 + account_id` |
| `persona_name` | last seen |
| `is_pro` | true once seen in a league match |
| `current_team_id` | last team in a stored match (best-effort) |
| `last_match_id`, `last_match_at` | |
| `updated_at` | |

### `teams`

`team_id` unique, `name`, `tag`, `logo_url`, `updated_at`. Names on `matches` are the snapshot; this row is “current”.

### Catalogs (`heroes`, `items`, `patches`, `abilities`, …)

Static Valve-id dictionaries, refreshed by `sync_catalogs` (worker boot + daily). Events store **ids only** — there is **no FK** from `match_draft.hero_id` / `match_players.item_*` / `match_player_ability_upgrades.ability_id` to these tables. Live draft uses `hero_id = 0` before a pick, and a brand-new Valve id must not block ingest before the next catalog refresh.

Spells and talents share one ability-id space. Talents are `abilities.kind = talent` (`special_bonus_*`). Facets are `hero_facets` (join `match_players.selected_facet` to `facet_id`; Valve’s slot is often 1-based).

| Table | Natural key | Notes |
|---|---|---|
| `heroes` | `hero_id` | `name`, `localized_name`, `primary_attr`, `attack_type`, `roles[]` |
| `items` | `item_id` | `name`, `localized_name`, `cost` |
| `patches` | `patch` | `released_at` — stamps `matches.patch` |
| `abilities` | `ability_id` | `kind`: `spell` / `talent` / `innate` / `item` / `other` |
| `hero_abilities` | `(hero_id, slot, is_talent)` | skill build + talent tree; FK to `heroes` / `abilities` |
| `hero_facets` | `(hero_id, facet_id)` | `selected_facet` on the player row |
| `permanent_buffs` | `buff_id` | Aghs / Moonshard / … on `match_player_buffs` |
| `game_modes` | `game_mode` | `matches.game_mode` |
| `lobby_types` | `lobby_type` | `matches.lobby_type` |
| `regions` | `region` | Valve region id |
| `clusters` | `cluster` | `matches.cluster` → `regions.region` |
| `xp_levels` | `level` | cumulative XP to reach that level |

Source: [odota/dotaconstants](https://github.com/odota/dotaconstants) (GitHub raw, OpenDota `/constants` fallback). Steam Web API no longer publishes items/abilities; `GetHeroes` lacks roles/attrs and would burn the 1 rps match budget.

### `match_draft`

Unique `(match_id, ord)`.

| Column | Notes |
|---|---|
| `is_pick` | false = ban |
| `hero_id` | |
| `team` | 0 radiant, 1 dire |
| `player_slot` | Valve slot (0–4 / 128–132). Replay draft often has `-1`; filled from `match_players.hero_id` on picks. |
| `clock` | seconds into draft, from replay when parsed |

Live GetLiveLeagueGames only has unordered per-side lists; write them with a local `ord`, then **replace** the rows when details have the real order. Replay parse stamps `clock` on that sequence and does **not** replace a complete details draft with the noisy gamerules timeline.

### `match_objectives`

Sparse Postgres timeline for “what happened in this game” without ClickHouse. Tens of rows per match, not thousands.

Filled from details (`first_blood_time`) before parse, then from parser `CHAT_MESSAGE_*` / combat-log building kills after parse.

| Column | Notes |
|---|---|
| `match_id`, `seq` | unique |
| `time` | game clock seconds |
| `kind` | see below |
| `team` | 0 / 1 / null |
| `slot` | player_slot if applicable |
| `key` | e.g. tower npc / lane |
| `value` | extra int |

`kind` values (from `CDOTAUserMsg_ChatEvent` + combat log):

`first_blood`, `tower`, `barracks`, `roshan`, `aegis`, `aegis_stolen`, `aegis_denied`, `buyback`, `glyph`, `scan`, `pause`, `reconnect`, `disconnect`, `win`, `courier`, `shrine`, `ward`, `tormentor`, `smoke`, `banner`, `outpost`

The full event → table map is [`replay-mapping.md`](./replay-mapping.md).

These are the rows an analyst dashboard hits first. The full event stream stays in ClickHouse.

### `match_replays`

Pipeline, not analytics. Enum grows vs today: add `parsing`, `parsed`.

| Column | Notes |
|---|---|
| `match_id` unique | |
| `priority` | `live` / `historical` |
| `status` | `pending` → `awaiting_gc` → `downloading` → `stored` → `parsing` → `parsed` / `unavailable` / `failed` |
| `cluster`, `replay_salt`, `replay_state` | |
| `source_url` | replay CDN URL used for the download |
| `s3_bucket`, `s3_key`, `bytes` | |
| `stored_at` | when the `.dem.bz2` landed in S3 |
| `parser_version` | CH schema version of the rows |
| `parse_run_id` | published ClickHouse write; unpublished runs are deleted |
| `parsed_at` | |
| `attempts`, `last_error`, `last_error_at`, `next_attempt_at` | |
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
| `match_id` | `Delta, ZSTD(1)` |
| live `account_id` (sorted with the tick) | `Delta, ZSTD(1)` |
| replay `account_id` / `attacker_account_id` / `target_account_id` | default LZ4 — `T64` expanded these |
| `captured_at`, `start_time` | `DoubleDelta, ZSTD(1)` |
| game clock `time`, `tick` | `Delta, ZSTD(1)` |
| slowly changing ints (gold, nw, xp, lh) | `Delta, ZSTD(1)` |
| noisy ints (damage amounts) | `T64, ZSTD(1)` |
| enums / `event_type` / `source` / `patch` / `side` | `LowCardinality(String)` |
| floats that are one series in `ORDER BY` (live ticks, interval `x`/`y`, stun) | `Gorilla, ZSTD(1)` |
| interleaved coordinates (`replay_actions.pos_*`) | `ZSTD(1)` — Gorilla sees a different unit each row |
| leftover maps | `ZSTD(3)` |

`LowCardinality` on `hero_id` is not worth it (many distinct). Combat-log unit names (`attacker`, `target`, `inflictor`, `sourcename`, `targetsourcename`, `tracked_sourcename`) **are** `LowCardinality(String)`: ~300–1.8k distinct values per 50 matches, dictionary is per granule, and `LIKE` / `GROUP BY` on names gets faster. Do not put `T64` on `account_id` / `attacker_account_id` / `target_account_id` — it expanded those columns.

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
game_state          UInt8
server_steam_id     UInt64
```

`ENGINE = MergeTree PARTITION BY toYYYYMM(captured_at) ORDER BY (match_id, captured_at)`

### `live_player_ticks`

Same grain, one row per player on the scoreboard.

| Column | Notes |
|---|---|
| `match_id` / `captured_at` | same poll as `live_match_ticks` |
| `player_slot` UInt8 | Valve 0–4 / 128–132 (same as `match_players`). A 0–4 scoreboard slot on dire is `128 + slot` |
| `account_id` UInt64 Codec(Delta, ZSTD(1)) | scoreboard often omits it; resolve from top-level `players[]` by side + `hero_id` (else per-side index) |
| `hero_id` Int32 | |
| `kills` / `deaths` / `assists` UInt16 | |
| `last_hits` UInt32 Codec(Delta(4), ZSTD(1)) | |
| `denies` UInt16 | |
| `gold` / `net_worth` UInt32 Codec(Delta(4), ZSTD(1)) | |
| `level` UInt8 | |
| `gold_per_min` / `xp_per_min` UInt16 | |
| `x` / `y` Float32 Codec(Gorilla, ZSTD(1)) | `position_x` / `position_y` from GetLiveLeagueGames |
| `source` LowCardinality(String) | `GetLiveLeagueGames` / `GetRealtimeStats` |
| `item0`…`item5` UInt32 | inventory |
| `item6`…`item8` UInt32 | backpack from GetRealtimeStats |
| `ultimate_state` UInt8 | GetRealtimeStats |
| `ultimate_cooldown` / `respawn_timer` UInt16 | GetRealtimeStats |

`ORDER BY (match_id, captured_at, player_slot)`

GetLiveLeagueGames fills this table on its own. GetTopLiveGame + GetRealtimeStats add a second `source` and extra fields; they are not required for a live row to exist.

### Replay tables

Parser is the Go service in `packages/parser`. Tables below are what it fills. Replays sit in S3 as `.dem.bz2`.

Shared prefix on every replay table:

```
match_id    UInt64   Codec(Delta, ZSTD(1))
start_time  DateTime('UTC')  Codec(DoubleDelta, ZSTD(1))  -- match start, for partition
time        Int32    Codec(Delta, ZSTD(1))   -- game clock; negative in pregame
tick        UInt32   Codec(Delta, ZSTD(1))
slot        Int8                     -- 0-9 (Int8 cannot hold Valve 128-132); -1 if unknown
account_id  UInt32                   -- Steam 32-bit; 0 if unknown / not a player; default LZ4
parser_version  UInt16
parse_run_id    UInt64   -- unpublished until match_replays.parse_run_id matches
```

`account_id` is the player entity (`players.account_id`). Do not store
Postgres `players.id`. Valve's user-message `player_id` (0–23 resource
index) is extract-time only. `slot` 0–4 radiant / 5–9 dire; join
`match_players` with `player_slot = if(slot < 5, slot, slot + 123)`.
Creeps, buildings, and global chat stay `account_id = 0`, `slot = -1`.

`time` is the game clock (Int32 seconds). Combat-log rows also keep
`timestamp_raw`: the same proto `timestamp` as a float, **before** the
game-start subtract. Proto field 24 `timestamp_raw` is unused.

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
| item/ability/courier/outpost/roshan/… UM | `replay_alerts` | see [`replay-mapping.md`](./replay-mapping.md) |
| `CDemoFileInfo` + `CDOTAMatchMetadata` | `replay_meta*` | typed post-game facts; no JSON blob |
| `player_slot` | (mapping only) | used while parsing, not stored |

Teamfights are not a parser event. v1: derive in a query from clustered `DEATH` + `DAMAGE` windows, or a nightly materialized view. Do not block ingest on a teamfight detector.

#### `replay_combat_log`

Bulk of parse volume (~5×10⁴–2×10⁵ rows/match). Shared prefix plus
every stored scalar on `CMsgDOTACombatLogEntry`. Names resolve through
the `CombatLogNames` string table. Proto field → column:
[`replay-mapping.md`](./replay-mapping.md#cmsgdotacombatlogentry-columns).

Unknown `DOTA_COMBATLOG_{id}` values (newer than the named enum) are
still inserted; `type` is the raw suffix. Do not drop high type ids.

| Column | Notes |
|---|---|
| `type` LowCardinality(String) | enum name with `DOTA_COMBATLOG_` stripped: `DAMAGE`, `HEAL`, `MODIFIER_ADD` / `REMOVE`, `DEATH`, `ABILITY` / `ABILITY_TRIGGER`, `ITEM`, `LOCATION`, `GOLD` / `ALLIED_GOLD`, `XP`, `PURCHASE`, `BUYBACK`, `GAME_STATE`, `PLAYERSTATS`, `MULTIKILL` / `KILLSTREAK` / `END_KILLSTREAK`, `TEAM_BUILDING_KILL`, `FIRST_BLOOD`, `MODIFIER_STACK_EVENT`, `NEUTRAL_CAMP_STACK`, `PICKUP_RUNE`, `REVEALED_INVISIBLE`, `HERO_SAVED`, `MANA_RESTORED` / `MANA_DAMAGE`, `HERO_LEVELUP`, `BOTTLE_HEAL_ALLY`, `ENDGAME_STATS`, `INTERRUPT_CHANNEL`, `AEGIS_TAKEN`, `PHYSICAL_DAMAGE_PREVENTED`, `UNIT_SUMMONED`, `ATTACK_EVADE`, `TREE_CUT`, `SUCCESSFUL_SCAN`, `BLOODSTONE_CHARGE`, `CRITICAL_DAMAGE`, `SPELL_ABSORB`, `UNIT_TELEPORTED`, `KILL_EATER_EVENT`, `NEUTRAL_ITEM_EARNED`, `STAT_TRACKER_PLAYER` |
| `attacker` / `target` / `inflictor` LowCardinality(String) Codec(ZSTD(1)) | proto `attacker_name` / `target_name` / `inflictor_name` |
| `sourcename` / `targetsourcename` LowCardinality(String) Codec(ZSTD(1)) | proto `damage_source_name` / `target_source_name` |
| `slot` / `attacker_slot` / `target_slot` Int8 Codec(T64, ZSTD(1)) | derived from names; `-1` if unknown |
| `account_id` UInt32 | primary actor (attacker, else target); `0` if neither is a hero |
| `attacker_account_id` / `target_account_id` UInt32 | `0` if that side is not a player hero |
| `value` Int32 Codec(T64, ZSTD(1)) | proto `value`: damage / gold / xp / item id / game-state id |
| `value_name` LowCardinality(String) | resolved name on `PURCHASE` / `ITEM` / `BUYBACK` / `MODIFIER_*` |
| `gold_reason` / `xp_reason` UInt16 | proto reason ids |
| `attacker_hero` / `target_hero` UInt8 Codec(T64, ZSTD(1)) | proto `is_attacker_hero` / `is_target_hero` |
| `attacker_illusion` / `target_illusion` UInt8 | proto `is_attacker_illusion` / `is_target_illusion` |
| `last_hits` UInt32 Codec(Delta(4), ZSTD(1)) | proto `last_hits` |
| `stun_duration` / `slow_duration` Float32 Codec(Gorilla, ZSTD(1)) | |
| `health` Int32 Codec(T64, ZSTD(1)) | target HP after the event |
| `ability_level` UInt8 | |
| `location_x` / `location_y` Float32 Codec(Gorilla, ZSTD(1)) | `LOCATION` events |
| `modifier_duration` Float32 Codec(Gorilla, ZSTD(1)) | applied duration on add |
| `timestamp_raw` Float32 Codec(Gorilla, ZSTD(1)) | proto `timestamp` (field 15) as float seconds, **unadjusted**. Shared `time` is this value converted to game-clock Int32 (subtract game-start when the stamp looks absolute, `> 1000`). Proto field 24 `timestamp_raw` is **not** stored. |
| `attacker_team` / `target_team` UInt8 Codec(T64, ZSTD(1)) | `DOTA_GC_TEAM` |
| `stack_count` UInt16 Codec(T64, ZSTD(1)) | `MODIFIER_STACK_EVENT` |
| `is_target_building` UInt8 | |
| `rune_type` UInt16 | `PICKUP_RUNE` |
| `networth` UInt32 Codec(Delta(4), ZSTD(1)) | |
| `visible_radiant` / `visible_dire` UInt8 Codec(T64, ZSTD(1)) | proto `is_visible_*` |
| `is_ability_toggle_on` / `is_ability_toggle_off` UInt8 | |
| `obs_wards_placed` UInt16 | |
| `assist_player0`…`assist_player3` UInt32 | first four of proto `assist_players`; `0` if absent |
| `assist_players` Array(Int32) | full assist list |
| `hidden_modifier` UInt8 | |
| `neutral_camp_type` UInt16 | `NEUTRAL_CAMP_STACK` |
| `is_heal_save` UInt8 | |
| `is_ultimate_ability` UInt8 | |
| `attacker_hero_level` / `target_hero_level` UInt16 | |
| `xpm` / `gpm` UInt32 | |
| `event_location` UInt16 | |
| `target_is_self` UInt8 Codec(T64, ZSTD(1)) | |
| `damage_type` UInt16 Codec(T64, ZSTD(1)) | |
| `invisibility_modifier` UInt8 | |
| `damage_category` UInt16 Codec(T64, ZSTD(1)) | |
| `building_type` UInt16 | |
| `modifier_elapsed_duration` Float32 Codec(Gorilla, ZSTD(1)) | |
| `silence_modifier` UInt8 | |
| `heal_from_lifesteal` UInt8 | |
| `modifier_purged` UInt8 | |
| `spell_evaded` UInt8 | |
| `motion_controller_modifier` UInt8 | |
| `long_range_kill` UInt8 | |
| `modifier_purge_ability` / `modifier_purge_npc` UInt32 | |
| `root_modifier` UInt8 | |
| `total_unit_death_count` UInt32 | |
| `aura_modifier` UInt8 | |
| `armor_debuff_modifier` UInt8 | |
| `no_physical_damage_modifier` UInt8 | |
| `modifier_ability` UInt32 Codec(T64, ZSTD(1)) | |
| `modifier_hidden` UInt8 | |
| `inflictor_is_stolen_ability` UInt8 | |
| `kill_eater_event` UInt32 | `KILL_EATER_EVENT` |
| `unit_status_label` UInt32 | |
| `spell_generated_attack` UInt8 Codec(T64, ZSTD(1)) | |
| `at_night_time` UInt8 Codec(T64, ZSTD(1)) | |
| `attacker_has_scepter` UInt8 | |
| `neutral_camp_team` UInt16 | |
| `regenerated_health` Float32 Codec(Gorilla, ZSTD(1)) | |
| `will_reincarnate` UInt8 | |
| `uses_charges` UInt8 | |
| `tracked_stat_id` UInt32 | `STAT_TRACKER_PLAYER` |
| `modifier_purged_duration` Float32 Codec(Gorilla, ZSTD(1)) | |
| `heal_from_regen` UInt8 | |
| `greevils_greed_stack` UInt16 | leftover default (`0`); not on the proto; do not read |
| `tracked_death` UInt8 | leftover default (`0`); not on the proto; do not read |
| `tracked_sourcename` LowCardinality(String) Codec(ZSTD(1)) | leftover default (`''`); not on the proto; do not read |

#### `replay_intervals`

Replaces OpenDota-style `gold_t` / `lh_t` / `xp_t` / `lane_pos`.
~2×10⁴ rows/match. `ORDER BY (match_id, time, tick, slot)`, so Gorilla
on `x`/`y` is a real per-hero path. Entity-field map:
[`replay-mapping.md`](./replay-mapping.md#1-hz-snapshot--replay_intervals).

| Column | Notes |
|---|---|
| `slot` Int8 Codec(T64, ZSTD(1)) | 0–9 |
| `hero_id` Int32 | `m_nSelectedHeroID` |
| `variant` Int16 | `m_nSelectedHeroVariant` / facet key low 8 bits |
| `facet_hero_id` Int32 | `m_iHeroFacetKey >> 32` |
| `unit` LowCardinality(String) Codec(ZSTD(1)) | hero class name |
| `x` / `y` Float32 Codec(Gorilla, ZSTD(1)) | hero origin |
| `gold` / `lh` / `xp` / `networth` UInt32 Codec(Delta(4), ZSTD(1)) | `m_vecDataTeam` earned / last-hit / net worth |
| `denies` UInt16 | |
| `level` UInt8 | |
| `kills` / `deaths` / `assists` UInt16 | `m_vecPlayerTeamData` |
| `life_state` UInt8 | hero `m_lifeState` |
| `stuns` Float32 Codec(Gorilla, ZSTD(1)) | cumulative stun seconds |
| `obs_placed` / `sen_placed` / `observers_placed` UInt16 | ward counts (`observers_placed` copies `obs_placed`) |
| `creeps_stacked` / `camps_stacked` / `rune_pickups` UInt16 | |
| `towers_killed` / `roshans_killed` UInt8 | |
| `teamfight_participation` Float32 Codec(Gorilla, ZSTD(1)) | |
| `firstblood_claimed` UInt8 | |
| `draft_stage` UInt8 | gamerules `m_nGameState` |
| `repicked` / `randomed` / `pred_vict` UInt8 | |
| `hp` / `max_hp` / `mana` / `max_mana` UInt32 Codec(Delta(4), ZSTD(1)) | hero vitals |
| `respawn` UInt16 Codec(T64, ZSTD(1)) | seconds left from `m_flRespawnTime` |

#### `replay_actions`

One row per `DOTA_UM_SpectatorPlayerUnitOrders`. High volume in pro
games; still cheaper than aggregating orders into a per-minute map.

| Column | Notes |
|---|---|
| `order_type` UInt16 Codec(T64, ZSTD(1)) | Valve `dotaunitorder_t` (`key` in older parser notes) |
| `unit_index` / `target_index` / `ability_id` Int32 Codec(T64, ZSTD(1)) | `-1` if absent; `unit_index` is the first unit in the list |
| `pos_x` / `pos_y` / `pos_z` Float32 Codec(ZSTD(1)) | not Gorilla: `ORDER BY (match_id, time, tick)` interleaves units |
| `queued` UInt8 | proto `queue` |

#### `replay_pings`

`DOTA_UM_LocationPing` and `DOTA_UM_MinimapEvent`. Ability / facet /
item alerts are **not** pings; they go to `replay_alerts`.

| Column | Notes |
|---|---|
| `x` / `y` Float32 Codec(Gorilla, ZSTD(1)) | map coords |
| `ping_type` UInt16 | `CDOTAMsg_LocationPing.type` or minimap `event_type` |
| `target` Int32 | entity handle; `-1` if none |

#### `replay_wards`

Entity create/leave on observer and sentry ward classes.

| Column | Notes |
|---|---|
| `kind` LowCardinality(String) | `obs` / `sen` |
| `is_left` UInt8 | `0` place, `1` expire/destroy |
| `x` / `y` / `z` Float32 Codec(Gorilla, ZSTD(1)) | |
| `ehandle` UInt32 | entity index so place and leave join |

#### `replay_chat`

| Column | Notes |
|---|---|
| `kind` LowCardinality(String) | `chat` / `chatwheel` |
| `key` String Codec(ZSTD(1)) | message text, wheel id, or `SayText2.messagename` |
| `unit` String Codec(ZSTD(1)) | speaker prefix (`SayText2.param1`) when set |
| `channel` UInt8 | `CDOTAUserMsg_ChatMessage.channel_type` |

#### `replay_announcements`

`DOTA_UM_ChatEvent`. Source for PG `match_objectives`. Unknown
`CHAT_MESSAGE_{id}` values are stored, not dropped.

| Column | Notes |
|---|---|
| `kind` LowCardinality(String) | `CHAT_MESSAGE_TOWER_KILL`, … |
| `player1` / `player2` / `player3` Int16 | proto `playerid_*`; `-1` if unused |
| `value` Int32 | |
| `value2` / `value3` UInt32 | |

#### `replay_alerts`

Spectator/user messages that are match facts but not combat, chat, or
orders. Full `kind` list in [`replay-mapping.md`](./replay-mapping.md#alerts--replay_alerts).

| Column | Notes |
|---|---|
| `kind` LowCardinality(String) | `item_alert`, `courier_killed`, `roshan_timer`, … |
| `player2` Int16 | second player when the message has one; `-1` else |
| `value` Int32 Codec(T64, ZSTD(1)) | item / ability / gold / team / type |
| `value2` Int32 | extra int (tier, xp, flags, …) |
| `x` / `y` Float32 Codec(Gorilla, ZSTD(1)) | map line / ping confirm / item alert |
| `key` String Codec(ZSTD(1)) | name when the wire sends a string (`shared_cooldown`) |

#### `replay_draft`

Gamerules pick/ban timeline while `m_nGameState == 2`. Official
~24-row sequence is `CDemoFileInfo` (stamps PG `match_draft.clock`).

| Column | Notes |
|---|---|
| `is_pick` UInt8 | `0` ban, `1` pick |
| `hero_id` Int32 | |
| `team` UInt8 | `0` radiant, `1` dire |
| `ord` UInt16 | local sequence in this parse |
| `clock` Int32 | seconds into draft |
| `extra_time_radiant` / `extra_time_dire` Int32 | reserve time remaining |

#### `replay_ability_levels`

A row when a hero ability slot’s level increases.

| Column | Notes |
|---|---|
| `ability_id` String Codec(ZSTD(1)) | ability class or string-table name (not always the numeric Valve id) |
| `ability_level` UInt8 | |
| `target` String Codec(ZSTD(1)) | hero npc name |

#### `replay_inventory`

Combat `PURCHASE` with `time <= 90` (`item_slot = -1`) and later
`m_hItems` handle changes (slots 0–20, backpack / stash included).
Empty `item_id` on a later row means that slot was cleared.

| Column | Notes |
|---|---|
| `item_id` String Codec(ZSTD(1)) | item class or name |
| `item_slot` Int8 | `-1` starting purchase; `0`–`20` inventory |
| `charges` / `secondary_charges` UInt16 | when the item entity exists |

#### `replay_neutrals`

| Column | Notes |
|---|---|
| `kind` LowCardinality(String) | `purchase` / `neutral_item` / `found` |
| `key` String Codec(ZSTD(1)) | item name or ability id |
| `value` Int32 | item / ability id |
| `is_neutral_active_drop` / `is_neutral_passive_drop` UInt8 | reserved; extract currently leaves `0` |

#### `replay_cosmetics`

`CDOTAWearableItem` definition index + account. Deduped per
`(account, item)`. `ORDER BY (match_id, slot, item_id)`.

| Column | Notes |
|---|---|
| `item_id` UInt32 | wearable definition index |

#### `replay_meta*` (`CDOTAMatchMetadata` / `CDemoFileInfo`)

Valve's post-game metadata, typed. Do **not** stash the proto as JSON.
Seasonal / cosmetic leftover fields (event_data, strange gems, cavern,
contracts, equipped econ) are dropped. Winner / team ids also exist on
Postgres `matches`.

| Table | Grain | Notes |
|---|---|---|
| `replay_meta` | one row | playback time/ticks/frames, `game_winner`, team ids, metadata version, lobby id |
| `replay_meta_teams` | one / side | `dota_team` 2/3, CM flags, gold/xp/nw graphs |
| `replay_meta_players` | one / player | scores, ward/stack/rapier counts, `lane_selection_flags` (draft preference, **not** lane outcome), ability upgrade ids, level-up times, nw/damage graphs |
| `replay_meta_kills` | one / kill | `kill_type` `player` / `tower` / `barracks` / `roshan` / `miniboss`, victim + killer slots, bounty, game-clock `time` |
| `replay_meta_player_kills` | kill matrix | `slot` killed `victim_slot` this many times |
| `replay_meta_purchases` | one / buy | `item_id` + `time` = purchase clock (phase boots at 6:43 is `item_id=50`, `time=403`) |
| `replay_meta_inventory` | ~30 s snapshot | `item_ids[]`, backpack, `neutral_item_id` / `neutral_enhancement_id`, KDA/level/lh |
| `replay_meta_tips` | one / tip | source/target slots, amount |

Lane **outcome** (safe-lane win / draw / lose) is not in the proto. Derive
it from 10-minute farm vs the opposing laner if needed. `lane_selection_flags`
is who queued for which lane.

### Volume (pro-only, order of magnitude)

~2×10⁵ professional matches lifetime: combat log ~10¹⁰ rows, intervals ~4×10⁹, live ticks negligible. ClickHouse-normal. Historical parse trailing by months is acceptable; storage is not the bottleneck, parse CPU is.

---

## Source → columns

| Source | Writes |
|---|---|
| `GetLeagueInfoList` | `leagues` |
| `GetLiveLeagueGames` | `matches` (live, including `lobby_id` / logos / series ids), `ingest_sources`, `match_players` (roster/scoreboard items), `match_draft` (provisional), `live_*` ticks |
| `GetTopLiveGame` | `matches.server_steam_id`, `ingest_sources`, live phase |
| `GetRealtimeStats` | live PG scoreboard/draft plus CH `live_*` ticks (`source = GetRealtimeStats`, `game_state`, backpack items) |
| `GetMatchHistory` (`league_id`) | discover `match_id` / `match_seq_num` / series / teams; live-finished waiter |
| `GetMatchHistoryBySequenceNum` | **Not used** on the ingest path. Same blob as the old `GetMatchDetails`; GC + replay cover the columns. |
| GC `CMsgGCMatchDetailsResponse` → `CMsgDOTAMatch` | **Primary** fill for `cluster` / `replay_salt` and box-score / draft / team columns. `item_6..8` map to backpack. |
| Replay parse | CH `replay_*`, PG `match_objectives`, parse summaries on `match_players`, `match_draft` clocks (does not replace a complete details draft), `matches.barracks_status_*` from rax kills, captains + leftover backpack / neutrals / Aghs from metadata |

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

1. Every scalar on `CMsgDOTAMatch` has a Postgres column or a child table. Seq-num-only aliases (backpack, captains, Aghs flags) come from GC slot mapping or replay metadata.
2. Combat-log enum values and interval snapshots from a future demo parser land as ClickHouse rows.
3. Parser announcement types that describe the story of the game are also in Postgres `match_objectives`.
4. The replay file stays in S3 so we can parse (and re-parse) with a `parser_version`.
5. We do **not** keep a second copy of those payloads as JSON — that is what `match_details_raw` was, and it is how useful fields stay unqueryable.

Out of scope on purpose (product/community, not match facts): community profiles, mmr / rank_tier, public_matches, scenarios, webhooks, notable_players as a separate crawl.
