-- Always-default leftovers: not on the combat-log proto, unused
-- neutral drop flags, duplicate interval ward count.

-- migrate:up transaction:false

ALTER TABLE replay_combat_log
	DROP COLUMN IF EXISTS greevils_greed_stack,
	DROP COLUMN IF EXISTS tracked_death,
	DROP COLUMN IF EXISTS tracked_sourcename

-- migrate:down transaction:false

ALTER TABLE replay_combat_log
	ADD COLUMN greevils_greed_stack UInt16 DEFAULT 0,
	ADD COLUMN tracked_death UInt8 DEFAULT 0,
	ADD COLUMN tracked_sourcename LowCardinality(String) DEFAULT '' CODEC(ZSTD(1))

-- migrate:up transaction:false

ALTER TABLE replay_intervals
	DROP COLUMN IF EXISTS observers_placed

-- migrate:down transaction:false

ALTER TABLE replay_intervals
	ADD COLUMN observers_placed UInt16 DEFAULT 0

-- migrate:up transaction:false

ALTER TABLE replay_neutrals
	DROP COLUMN IF EXISTS is_neutral_active_drop,
	DROP COLUMN IF EXISTS is_neutral_passive_drop

-- migrate:down transaction:false

ALTER TABLE replay_neutrals
	ADD COLUMN is_neutral_active_drop UInt8 DEFAULT 0,
	ADD COLUMN is_neutral_passive_drop UInt8 DEFAULT 0
