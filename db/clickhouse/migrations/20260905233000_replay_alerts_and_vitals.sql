-- replay_alerts: typed user messages that are match facts but not
-- combat / chat / orders. Interval vitals (hp/mana/respawn) from the
-- hero entity. parser_version 2.

-- migrate:up transaction:false

CREATE TABLE replay_alerts
(
	match_id UInt64 Codec(Delta, ZSTD(1)),
	start_time DateTime('UTC') Codec(DoubleDelta, ZSTD(1)),
	time Int32 Codec(Delta, ZSTD(1)),
	tick UInt32 Codec(Delta, ZSTD(1)),
	slot Int8,
	parser_version UInt16,
	parse_run_id UInt64 DEFAULT 0,
	kind LowCardinality(String),
	player2 Int16 DEFAULT -1,
	value Int32 DEFAULT 0 Codec(T64, ZSTD(1)),
	value2 Int32 DEFAULT 0,
	x Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	y Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	key String DEFAULT '' Codec(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(start_time)
ORDER BY (match_id, time, tick);

-- migrate:down transaction:false

DROP TABLE IF EXISTS replay_alerts;

-- migrate:up transaction:false

ALTER TABLE replay_intervals
	ADD COLUMN hp UInt32 DEFAULT 0 Codec(Delta, ZSTD(1)),
	ADD COLUMN max_hp UInt32 DEFAULT 0 Codec(Delta, ZSTD(1)),
	ADD COLUMN mana UInt32 DEFAULT 0 Codec(Delta, ZSTD(1)),
	ADD COLUMN max_mana UInt32 DEFAULT 0 Codec(Delta, ZSTD(1)),
	ADD COLUMN respawn UInt16 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_intervals
	DROP COLUMN IF EXISTS hp,
	DROP COLUMN IF EXISTS max_hp,
	DROP COLUMN IF EXISTS mana,
	DROP COLUMN IF EXISTS max_mana,
	DROP COLUMN IF EXISTS respawn;
