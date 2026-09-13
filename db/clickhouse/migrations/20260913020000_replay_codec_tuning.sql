-- Query-safe codec pass measured on 15 live matches (2026-09-12).
-- New inserts pick this up; a rewrite of existing parts is not required
-- if the table will be dropped and re-parsed.
-- One statement per migrate:up: ClickHouse rejects multi-query.

-- migrate:up transaction:false

ALTER TABLE replay_combat_log
	MODIFY COLUMN attacker LowCardinality(String) CODEC(ZSTD(1)),
	MODIFY COLUMN target LowCardinality(String) CODEC(ZSTD(1)),
	MODIFY COLUMN inflictor LowCardinality(String) CODEC(ZSTD(1)),
	MODIFY COLUMN sourcename LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
	MODIFY COLUMN targetsourcename LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
	MODIFY COLUMN tracked_sourcename LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
	MODIFY COLUMN slot Int8 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN attacker_slot Int8 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN target_slot Int8 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN last_hits UInt32 DEFAULT 0 CODEC(Delta(4), ZSTD(1)),
	MODIFY COLUMN modifier_ability UInt32 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN damage_type UInt16 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN damage_category UInt16 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN attacker_team UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN target_team UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN attacker_hero UInt8 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN target_hero UInt8 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN target_is_self UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN spell_generated_attack UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN visible_radiant UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN visible_dire UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN at_night_time UInt8 DEFAULT 0 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN stack_count UInt16 DEFAULT 0 CODEC(T64, ZSTD(1));

-- migrate:down transaction:false

ALTER TABLE replay_combat_log
	MODIFY COLUMN attacker String CODEC(ZSTD(1)),
	MODIFY COLUMN target String CODEC(ZSTD(1)),
	MODIFY COLUMN inflictor String CODEC(ZSTD(1)),
	MODIFY COLUMN sourcename String DEFAULT '' CODEC(ZSTD(1)),
	MODIFY COLUMN targetsourcename String DEFAULT '' CODEC(ZSTD(1)),
	MODIFY COLUMN tracked_sourcename String DEFAULT '' CODEC(ZSTD(1)),
	MODIFY COLUMN slot Int8,
	MODIFY COLUMN attacker_slot Int8,
	MODIFY COLUMN target_slot Int8,
	MODIFY COLUMN last_hits UInt32 DEFAULT 0,
	MODIFY COLUMN modifier_ability UInt32 DEFAULT 0,
	MODIFY COLUMN damage_type UInt16 DEFAULT 0,
	MODIFY COLUMN damage_category UInt16 DEFAULT 0,
	MODIFY COLUMN attacker_team UInt8 DEFAULT 0,
	MODIFY COLUMN target_team UInt8 DEFAULT 0,
	MODIFY COLUMN attacker_hero UInt8,
	MODIFY COLUMN target_hero UInt8,
	MODIFY COLUMN target_is_self UInt8 DEFAULT 0,
	MODIFY COLUMN spell_generated_attack UInt8 DEFAULT 0,
	MODIFY COLUMN visible_radiant UInt8 DEFAULT 0,
	MODIFY COLUMN visible_dire UInt8 DEFAULT 0,
	MODIFY COLUMN at_night_time UInt8 DEFAULT 0,
	MODIFY COLUMN stack_count UInt16 DEFAULT 0;

-- migrate:up transaction:false

ALTER TABLE replay_actions
	MODIFY COLUMN pos_x Float32 DEFAULT 0 CODEC(ZSTD(1)),
	MODIFY COLUMN pos_y Float32 DEFAULT 0 CODEC(ZSTD(1)),
	MODIFY COLUMN pos_z Float32 DEFAULT 0 CODEC(ZSTD(1)),
	MODIFY COLUMN unit_index Int32 DEFAULT -1 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN target_index Int32 DEFAULT -1 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN ability_id Int32 DEFAULT -1 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN slot Int8 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN order_type UInt16 CODEC(T64, ZSTD(1));

-- migrate:down transaction:false

ALTER TABLE replay_actions
	MODIFY COLUMN pos_x Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
	MODIFY COLUMN pos_y Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
	MODIFY COLUMN pos_z Float32 DEFAULT 0 CODEC(Gorilla, ZSTD(1)),
	MODIFY COLUMN unit_index Int32 DEFAULT -1,
	MODIFY COLUMN target_index Int32 DEFAULT -1,
	MODIFY COLUMN ability_id Int32 DEFAULT -1,
	MODIFY COLUMN slot Int8,
	MODIFY COLUMN order_type UInt16;

-- migrate:up transaction:false

ALTER TABLE replay_intervals
	MODIFY COLUMN unit LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),
	MODIFY COLUMN slot Int8 CODEC(T64, ZSTD(1)),
	MODIFY COLUMN respawn UInt16 DEFAULT 0 CODEC(T64, ZSTD(1));

-- migrate:down transaction:false

ALTER TABLE replay_intervals
	MODIFY COLUMN unit String DEFAULT '' CODEC(ZSTD(1)),
	MODIFY COLUMN slot Int8,
	MODIFY COLUMN respawn UInt16 DEFAULT 0;
