-- Split CDOTAMatchMetadata / CDemoFileInfo out of replay_epilogue
-- into typed tables. The JSON blob is not a query surface.
-- One statement per migrate:up: ClickHouse rejects multi-query.

-- migrate:up transaction:false

CREATE TABLE replay_meta
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8 CODEC(T64, ZSTD(1)),
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0,
	playback_time Float32 CODEC(Gorilla, ZSTD(1)),
	playback_ticks UInt32,
	playback_frames UInt32,
	game_winner UInt8,
	radiant_team_id UInt32,
	dire_team_id UInt32,
	metadata_version Int32,
	lobby_id UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_meta;

-- migrate:up transaction:false

CREATE TABLE replay_meta_teams
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8 CODEC(T64, ZSTD(1)),
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0,
	dota_team UInt8,
	cm_first_pick UInt8,
	cm_captain_player_id Int32,
	cm_penalty UInt32,
	graph_experience Array(Float32),
	graph_gold_earned Array(Float32),
	graph_net_worth Array(Float32)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, dota_team);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_meta_teams;

-- migrate:up transaction:false

CREATE TABLE replay_meta_players
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8 CODEC(T64, ZSTD(1)),
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0,
	valve_slot UInt8,
	team_number UInt8,
	team_slot UInt8,
	camps_stacked UInt32,
	lane_selection_flags UInt32,
	rampages UInt32,
	triple_kills UInt32,
	aegis_snatched UInt32,
	rapiers_purchased UInt32,
	couriers_killed UInt32,
	net_worth_rank UInt32,
	support_gold_spent UInt32,
	observer_wards_placed UInt32,
	sentry_wards_placed UInt32,
	wards_dewarded UInt32,
	stun_duration Float32 CODEC(Gorilla, ZSTD(1)),
	fight_score Float32 CODEC(Gorilla, ZSTD(1)),
	farm_score Float32 CODEC(Gorilla, ZSTD(1)),
	support_score Float32 CODEC(Gorilla, ZSTD(1)),
	push_score Float32 CODEC(Gorilla, ZSTD(1)),
	hero_xp UInt32,
	ability_upgrades Array(Int32),
	level_up_times Array(UInt32),
	graph_net_worth Array(Float32),
	graph_hero_damage Array(Float32)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, slot);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_meta_players;

-- migrate:up transaction:false

CREATE TABLE replay_meta_kills
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8 CODEC(T64, ZSTD(1)),
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0,
	team UInt8,
	kill_type LowCardinality(String),
	victim_slot UInt8,
	killer_slots Array(UInt8),
	bounty Int32 CODEC(T64, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, slot);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_meta_kills;

-- migrate:up transaction:false

CREATE TABLE replay_meta_player_kills
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8 CODEC(T64, ZSTD(1)),
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0,
	victim_slot UInt8,
	count UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, slot, victim_slot);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_meta_player_kills;

-- migrate:up transaction:false

CREATE TABLE replay_meta_purchases
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8 CODEC(T64, ZSTD(1)),
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0,
	item_id Int32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, slot);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_meta_purchases;

-- migrate:up transaction:false

CREATE TABLE replay_meta_inventory
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8 CODEC(T64, ZSTD(1)),
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0,
	item_ids Array(Int32),
	backpack_item_ids Array(Int32),
	neutral_item_id Int32,
	neutral_enhancement_id Int32,
	kills UInt32,
	deaths UInt32,
	assists UInt32,
	level UInt32,
	last_hits UInt32,
	denies UInt32,
	flags UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, slot);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_meta_inventory;

-- migrate:up transaction:false

CREATE TABLE replay_meta_tips
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8 CODEC(T64, ZSTD(1)),
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0,
	source_slot UInt8,
	target_slot UInt8,
	tip_amount UInt32,
	event_id UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, slot);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_meta_tips;

-- migrate:up transaction:false

DROP TABLE IF EXISTS replay_epilogue;

-- migrate:down transaction:false

CREATE TABLE replay_epilogue
(
	match_id UInt64 CODEC(Delta(8), ZSTD(1)),
	start_time DateTime('UTC') CODEC(DoubleDelta, ZSTD(1)),
	time Int32 CODEC(Delta(4), ZSTD(1)),
	tick UInt32 CODEC(Delta(4), ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	key LowCardinality(String),
	value String CODEC(ZSTD(3)),
	parse_run_id UInt64 DEFAULT 0,
	account_id UInt32 DEFAULT 0
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, key);
