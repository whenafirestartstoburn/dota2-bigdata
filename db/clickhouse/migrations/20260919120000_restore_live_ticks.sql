-- Live scoreboard ticks: insert-only MergeTree. `id` is the Postgres
-- serial during backfill and 0 on live inserts. Not in ORDER BY —
-- aggregations stay (match_id, captured_at, …) without FINAL.
-- minmax on id is only for the drain script's range checks.

-- migrate:up transaction:false

CREATE TABLE live_match_ticks
(
	`match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
	`captured_at` DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
	`league_id` UInt32 CODEC(T64, ZSTD(1)),
	`duration` Float32 CODEC(Gorilla, ZSTD(1)),
	`radiant_score` UInt16,
	`dire_score` UInt16,
	`spectators` UInt32 CODEC(T64, ZSTD(1)),
	`tower_state_radiant` UInt32,
	`tower_state_dire` UInt32,
	`barracks_state_radiant` UInt32,
	`barracks_state_dire` UInt32,
	`roshan_respawn_timer` UInt16,
	`series_type` UInt8,
	`radiant_series_wins` UInt8,
	`dire_series_wins` UInt8,
	`stream_delay_s` UInt16,
	`source` LowCardinality(String),
	`lobby_id` UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
	`game_number` UInt8 DEFAULT 0,
	`league_series_id` UInt32 DEFAULT 0 CODEC(T64, ZSTD(1)),
	`league_game_id` UInt32 DEFAULT 0 CODEC(T64, ZSTD(1)),
	`league_tier` UInt8 DEFAULT 0,
	`game_state` UInt8 DEFAULT 0,
	`server_steam_id` UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
	`id` UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
	INDEX id_minmax id TYPE minmax GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (match_id, captured_at, source)
SETTINGS index_granularity = 8192;

-- migrate:down transaction:false

DROP TABLE IF EXISTS live_match_ticks;

-- migrate:up transaction:false

CREATE TABLE live_player_ticks
(
	`match_id` UInt64 CODEC(Delta(8), ZSTD(1)),
	`captured_at` DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
	`player_slot` UInt8,
	`account_id` UInt64 CODEC(Delta(8), ZSTD(1)),
	`hero_id` Int32,
	`kills` UInt16,
	`deaths` UInt16,
	`assists` UInt16,
	`last_hits` UInt32 CODEC(Delta(4), ZSTD(1)),
	`denies` UInt16,
	`gold` UInt32 CODEC(Delta(4), ZSTD(1)),
	`net_worth` UInt32 CODEC(Delta(4), ZSTD(1)),
	`level` UInt8,
	`gold_per_min` UInt16,
	`xp_per_min` UInt16,
	`x` Float32 CODEC(Gorilla, ZSTD(1)),
	`y` Float32 CODEC(Gorilla, ZSTD(1)),
	`source` LowCardinality(String),
	`item0` UInt32 DEFAULT 0,
	`item1` UInt32 DEFAULT 0,
	`item2` UInt32 DEFAULT 0,
	`item3` UInt32 DEFAULT 0,
	`item4` UInt32 DEFAULT 0,
	`item5` UInt32 DEFAULT 0,
	`item6` UInt32 DEFAULT 0,
	`item7` UInt32 DEFAULT 0,
	`item8` UInt32 DEFAULT 0,
	`ultimate_state` UInt8 DEFAULT 0,
	`ultimate_cooldown` UInt16 DEFAULT 0,
	`respawn_timer` UInt16 DEFAULT 0,
	`id` UInt64 DEFAULT 0 CODEC(Delta(8), ZSTD(1)),
	INDEX id_minmax id TYPE minmax GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (match_id, captured_at, player_slot, source)
SETTINGS index_granularity = 8192;

-- migrate:down transaction:false

DROP TABLE IF EXISTS live_player_ticks;
