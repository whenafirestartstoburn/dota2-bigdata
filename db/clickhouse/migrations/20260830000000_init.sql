-- Live ticks and replay event stream. Match identity, box scores, and
-- pipeline status live in Postgres (db/migrations). Replay bytes (.dem.bz2)
-- live in S3, not here.
--
-- One CREATE TABLE per migrate:up: ClickHouse does not accept multiple
-- statements in one query.

-- migrate:up transaction:false

-- ClickHouse: one row per live poll per game (score, towers, spectators).
-- Source: GetLiveLeagueGames. Match identity lives in Postgres matches.
CREATE TABLE live_match_ticks
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	captured_at DateTime64(3, 'UTC') Codec(DoubleDelta, ZSTD(1)),
	league_id UInt32,
	duration Float32 Codec(Gorilla, ZSTD(1)),
	radiant_score UInt16,
	dire_score UInt16,
	spectators UInt32,
	tower_state_radiant UInt32,
	tower_state_dire UInt32,
	barracks_state_radiant UInt32,
	barracks_state_dire UInt32,
	roshan_respawn_timer UInt16,
	series_type UInt8,
	radiant_series_wins UInt8,
	dire_series_wins UInt8,
	stream_delay_s UInt16,
	source LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (match_id, captured_at);

-- migrate:down transaction:false

DROP TABLE IF EXISTS live_match_ticks;

-- migrate:up transaction:false

-- ClickHouse: one row per player on the live scoreboard each poll.
-- Same grain as live_match_ticks. End-of-match box score is Postgres
-- match_players.
CREATE TABLE live_player_ticks
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	captured_at DateTime64(3, 'UTC') Codec(DoubleDelta, ZSTD(1)),
	player_slot UInt8,
	account_id UInt64 Codec(Delta, ZSTD(1)),
	hero_id Int32,
	kills UInt16,
	deaths UInt16,
	assists UInt16,
	last_hits UInt32 Codec(Delta, ZSTD(1)),
	denies UInt16,
	gold UInt32 Codec(Delta, ZSTD(1)),
	net_worth UInt32 Codec(Delta, ZSTD(1)),
	level UInt8,
	gold_per_min UInt16,
	xp_per_min UInt16,
	x Float32 Codec(Gorilla, ZSTD(1)),
	y Float32 Codec(Gorilla, ZSTD(1)),
	source LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(captured_at)
ORDER BY (match_id, captured_at, player_slot);

-- migrate:down transaction:false

DROP TABLE IF EXISTS live_player_ticks;

-- migrate:up transaction:false

-- ClickHouse: Clarity combat log (damage, heal, death, gold, xp, purchases, …).
-- Bulk of parse volume. Aggregates (killed/damage maps) are queries, not stored.
CREATE TABLE replay_combat_log
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	type LowCardinality(String),
	attacker String Codec(ZSTD(1)),
	target String Codec(ZSTD(1)),
	inflictor String Codec(ZSTD(1)),
	attacker_slot Int8,
	target_slot Int8,
	value Int32 Codec(T64, ZSTD(1)),
	value_name LowCardinality(String),
	gold_reason UInt16,
	xp_reason UInt16,
	attacker_hero UInt8,
	target_hero UInt8,
	attacker_illusion UInt8,
	target_illusion UInt8,
	stun_duration Float32 Codec(Gorilla, ZSTD(1)),
	slow_duration Float32 Codec(Gorilla, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_combat_log;

-- migrate:up transaction:false

-- ClickHouse: ~1 Hz player snapshots from the replay (gold, lh, xp, position).
CREATE TABLE replay_intervals
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	hero_id Int32,
	variant Int16,
	x Float32 Codec(Gorilla, ZSTD(1)),
	y Float32 Codec(Gorilla, ZSTD(1)),
	gold UInt32 Codec(Delta, ZSTD(1)),
	lh UInt32 Codec(Delta, ZSTD(1)),
	xp UInt32 Codec(Delta, ZSTD(1)),
	networth UInt32 Codec(Delta, ZSTD(1)),
	denies UInt16,
	level UInt8,
	kills UInt16,
	deaths UInt16,
	assists UInt16,
	life_state UInt8,
	stuns Float32 Codec(Gorilla, ZSTD(1)),
	obs_placed UInt16,
	sen_placed UInt16,
	creeps_stacked UInt16,
	camps_stacked UInt16,
	rune_pickups UInt16,
	towers_killed UInt8,
	roshans_killed UInt8,
	teamfight_participation Float32 Codec(Gorilla, ZSTD(1)),
	firstblood_claimed UInt8,
	draft_stage UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick, slot);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_intervals;

-- migrate:up transaction:false

-- ClickHouse: spectator unit orders from the replay
-- (CDOTAUserMsg_SpectatorPlayerUnitOrders).
CREATE TABLE replay_actions
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	order_type UInt16
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_actions;

-- migrate:up transaction:false

-- ClickHouse: map pings from the replay (CDOTAUserMsg_LocationPing).
CREATE TABLE replay_pings
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	x Float32 Codec(Gorilla, ZSTD(1)),
	y Float32 Codec(Gorilla, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_pings;

-- migrate:up transaction:false

-- ClickHouse: observer/sentry place and expire events from the replay.
CREATE TABLE replay_wards
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	kind LowCardinality(String),
	is_left UInt8,
	x Float32 Codec(Gorilla, ZSTD(1)),
	y Float32 Codec(Gorilla, ZSTD(1)),
	z Float32 Codec(Gorilla, ZSTD(1)),
	ehandle UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_wards;

-- migrate:up transaction:false

-- ClickHouse: all-chat, team chat, and chatwheel from the replay.
CREATE TABLE replay_chat
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	kind LowCardinality(String),
	key String Codec(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_chat;

-- migrate:up transaction:false

-- ClickHouse: CHAT_MESSAGE_* announcements (tower, roshan, aegis, glyph, …).
-- Sparse copies also go to Postgres match_objectives for dashboards.
CREATE TABLE replay_announcements
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	kind LowCardinality(String),
	player1 Int16,
	player2 Int16,
	value Int32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_announcements;

-- migrate:up transaction:false

-- ClickHouse: draft timings from the replay. Also upserts Postgres
-- match_draft (ord, clock).
CREATE TABLE replay_draft
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	is_pick UInt8,
	hero_id Int32,
	team UInt8,
	ord UInt16,
	clock Int32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_draft;

-- migrate:up transaction:false

-- ClickHouse: skill-build events (ability id + level) from the replay.
CREATE TABLE replay_ability_levels
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	ability_id String Codec(ZSTD(1)),
	ability_level UInt8,
	target String Codec(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_ability_levels;

-- migrate:up transaction:false

-- ClickHouse: starting items and later inventory snapshots from the replay.
CREATE TABLE replay_inventory
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	item_id String Codec(ZSTD(1)),
	item_slot Int8,
	charges UInt16,
	secondary_charges UInt16
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_inventory;

-- migrate:up transaction:false

-- ClickHouse: neutral tokens and neutral item history from the replay.
CREATE TABLE replay_neutrals
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	kind LowCardinality(String),
	key String Codec(ZSTD(1)),
	value Int32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_neutrals;

-- migrate:up transaction:false

-- ClickHouse: wearable/cosmetic def ids from the replay.
CREATE TABLE replay_cosmetics
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	item_id UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, slot, item_id);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_cosmetics;

-- migrate:up transaction:false

-- ClickHouse: match-end epilogue fields from the replay (few rows per match).
CREATE TABLE replay_epilogue
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	key LowCardinality(String),
	value String Codec(ZSTD(3))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, key);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_epilogue;
