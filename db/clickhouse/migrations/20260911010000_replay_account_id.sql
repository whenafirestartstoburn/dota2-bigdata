-- Steam32 player stamp on every replay_* row. Combat also keeps
-- attacker/target accounts. Cosmetics already has account_id.
-- One statement per migrate:up: ClickHouse rejects multi-query.

-- migrate:up transaction:false

ALTER TABLE replay_combat_log
	ADD COLUMN account_id UInt32 DEFAULT 0,
	ADD COLUMN attacker_account_id UInt32 DEFAULT 0,
	ADD COLUMN target_account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_combat_log
	DROP COLUMN IF EXISTS account_id,
	DROP COLUMN IF EXISTS attacker_account_id,
	DROP COLUMN IF EXISTS target_account_id;

-- migrate:up transaction:false

ALTER TABLE replay_intervals
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_intervals
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_actions
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_actions
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_pings
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_pings
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_wards
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_wards
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_chat
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_chat
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_announcements
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_announcements
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_draft
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_draft
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_ability_levels
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_ability_levels
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_inventory
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_inventory
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_neutrals
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_neutrals
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_alerts
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_alerts
	DROP COLUMN IF EXISTS account_id;

-- migrate:up transaction:false

ALTER TABLE replay_epilogue
	ADD COLUMN account_id UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_epilogue
	DROP COLUMN IF EXISTS account_id;
