-- parse_run_id is the unpublished-until-Postgres-commit token for a
-- MergeTree write. Extra action/ping/cosmetic columns are proto fields
-- the first schema dropped. One statement per migrate:up.

-- migrate:up transaction:false

ALTER TABLE replay_combat_log
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_combat_log
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_intervals
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_intervals
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_actions
	ADD COLUMN parse_run_id UInt64 DEFAULT 0,
	ADD COLUMN unit_index Int32 DEFAULT -1,
	ADD COLUMN target_index Int32 DEFAULT -1,
	ADD COLUMN ability_id Int32 DEFAULT -1,
	ADD COLUMN pos_x Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN pos_y Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN pos_z Float32 DEFAULT 0 Codec(Gorilla, ZSTD(1)),
	ADD COLUMN queued UInt8 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_actions
	DROP COLUMN IF EXISTS parse_run_id,
	DROP COLUMN IF EXISTS unit_index,
	DROP COLUMN IF EXISTS target_index,
	DROP COLUMN IF EXISTS ability_id,
	DROP COLUMN IF EXISTS pos_x,
	DROP COLUMN IF EXISTS pos_y,
	DROP COLUMN IF EXISTS pos_z,
	DROP COLUMN IF EXISTS queued;

-- migrate:up transaction:false

ALTER TABLE replay_pings
	ADD COLUMN parse_run_id UInt64 DEFAULT 0,
	ADD COLUMN ping_type UInt16 DEFAULT 0,
	ADD COLUMN target Int32 DEFAULT -1;

-- migrate:down transaction:false

ALTER TABLE replay_pings
	DROP COLUMN IF EXISTS parse_run_id,
	DROP COLUMN IF EXISTS ping_type,
	DROP COLUMN IF EXISTS target;

-- migrate:up transaction:false

ALTER TABLE replay_wards
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_wards
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_chat
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_chat
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_announcements
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_announcements
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_draft
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_draft
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_ability_levels
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_ability_levels
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_inventory
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_inventory
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_neutrals
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_neutrals
	DROP COLUMN IF EXISTS parse_run_id;

-- migrate:up transaction:false

ALTER TABLE replay_cosmetics
	ADD COLUMN parse_run_id UInt64 DEFAULT 0,
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_cosmetics
	DROP COLUMN IF EXISTS parse_run_id,
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_epilogue
	ADD COLUMN parse_run_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_epilogue
	DROP COLUMN IF EXISTS parse_run_id;
