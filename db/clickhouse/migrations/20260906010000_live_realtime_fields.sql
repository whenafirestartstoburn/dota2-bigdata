-- Extra GetRealtimeStats fields on live ticks.
-- One statement per migrate:up: ClickHouse does not batch queries.

-- migrate:up transaction:false

ALTER TABLE live_match_ticks
	ADD COLUMN game_state UInt8 DEFAULT 0,
	ADD COLUMN server_steam_id UInt64 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE live_match_ticks
	DROP COLUMN IF EXISTS game_state,
	DROP COLUMN IF EXISTS server_steam_id;

-- migrate:up transaction:false

ALTER TABLE live_player_ticks
	ADD COLUMN item6 UInt32 DEFAULT 0,
	ADD COLUMN item7 UInt32 DEFAULT 0,
	ADD COLUMN item8 UInt32 DEFAULT 0;

-- migrate:down transaction:false

ALTER TABLE live_player_ticks
	DROP COLUMN IF EXISTS item6,
	DROP COLUMN IF EXISTS item7,
	DROP COLUMN IF EXISTS item8;
