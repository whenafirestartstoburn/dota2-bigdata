-- Extra live scoreboard and Clarity fields that were previously dropped.
-- One statement per migrate:up: ClickHouse does not batch queries.

-- migrate:up transaction:false

ALTER TABLE live_match_ticks
	ADD COLUMN lobby_id UInt64 DEFAULT 0,
	ADD COLUMN game_number UInt8 DEFAULT 0,
	ADD COLUMN league_series_id UInt32 DEFAULT 0,
	ADD COLUMN league_game_id UInt32 DEFAULT 0,
	ADD COLUMN league_tier UInt8 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE live_match_ticks
	DROP COLUMN IF EXISTS lobby_id,
	DROP COLUMN IF EXISTS game_number,
	DROP COLUMN IF EXISTS league_series_id,
	DROP COLUMN IF EXISTS league_game_id,
	DROP COLUMN IF EXISTS league_tier;

-- migrate:up transaction:false

ALTER TABLE live_player_ticks
	ADD COLUMN item0 UInt32 DEFAULT 0,
	ADD COLUMN item1 UInt32 DEFAULT 0,
	ADD COLUMN item2 UInt32 DEFAULT 0,
	ADD COLUMN item3 UInt32 DEFAULT 0,
	ADD COLUMN item4 UInt32 DEFAULT 0,
	ADD COLUMN item5 UInt32 DEFAULT 0,
	ADD COLUMN ultimate_state UInt8 DEFAULT 0,
	ADD COLUMN ultimate_cooldown UInt16 DEFAULT 0,
	ADD COLUMN respawn_timer UInt16 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE live_player_ticks
	DROP COLUMN IF EXISTS item0,
	DROP COLUMN IF EXISTS item1,
	DROP COLUMN IF EXISTS item2,
	DROP COLUMN IF EXISTS item3,
	DROP COLUMN IF EXISTS item4,
	DROP COLUMN IF EXISTS item5,
	DROP COLUMN IF EXISTS ultimate_state,
	DROP COLUMN IF EXISTS ultimate_cooldown,
	DROP COLUMN IF EXISTS respawn_timer;

-- migrate:up transaction:false

ALTER TABLE replay_combat_log
	ADD COLUMN sourcename String DEFAULT '' Codec(ZSTD(1)),
	ADD COLUMN targetsourcename String DEFAULT '' Codec(ZSTD(1)),
	ADD COLUMN greevils_greed_stack UInt16 DEFAULT 0,
	ADD COLUMN tracked_death UInt8 DEFAULT 0,
	ADD COLUMN tracked_sourcename String DEFAULT '' Codec(ZSTD(1));

-- migrate:down transaction:false

ALTER TABLE replay_combat_log
	DROP COLUMN IF EXISTS sourcename,
	DROP COLUMN IF EXISTS targetsourcename,
	DROP COLUMN IF EXISTS greevils_greed_stack,
	DROP COLUMN IF EXISTS tracked_death,
	DROP COLUMN IF EXISTS tracked_sourcename;

-- migrate:up transaction:false

ALTER TABLE replay_intervals
	ADD COLUMN unit String DEFAULT '' Codec(ZSTD(1)),
	ADD COLUMN facet_hero_id Int32 DEFAULT 0,
	ADD COLUMN repicked UInt8 DEFAULT 0,
	ADD COLUMN randomed UInt8 DEFAULT 0,
	ADD COLUMN pred_vict UInt8 DEFAULT 0,
	ADD COLUMN observers_placed UInt16 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_intervals
	DROP COLUMN IF EXISTS unit,
	DROP COLUMN IF EXISTS facet_hero_id,
	DROP COLUMN IF EXISTS repicked,
	DROP COLUMN IF EXISTS randomed,
	DROP COLUMN IF EXISTS pred_vict,
	DROP COLUMN IF EXISTS observers_placed;

-- migrate:up transaction:false

ALTER TABLE replay_chat
	ADD COLUMN unit String DEFAULT '' Codec(ZSTD(1));

-- migrate:down transaction:false

ALTER TABLE replay_chat
	DROP COLUMN IF EXISTS unit;

-- migrate:up transaction:false

ALTER TABLE replay_draft
	ADD COLUMN extra_time_radiant Int32 DEFAULT 0,
	ADD COLUMN extra_time_dire Int32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_draft
	DROP COLUMN IF EXISTS extra_time_radiant,
	DROP COLUMN IF EXISTS extra_time_dire;

-- migrate:up transaction:false

ALTER TABLE replay_neutrals
	ADD COLUMN is_neutral_active_drop UInt8 DEFAULT 0,
	ADD COLUMN is_neutral_passive_drop UInt8 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE replay_neutrals
	DROP COLUMN IF EXISTS is_neutral_active_drop,
	DROP COLUMN IF EXISTS is_neutral_passive_drop;
