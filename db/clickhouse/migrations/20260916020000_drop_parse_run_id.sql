-- parse_run_id was the unpublished-write token. Readers query by match_id.

-- migrate:up transaction:false
ALTER TABLE replay_ability_levels DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_ability_levels ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_actions DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_actions ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_alerts DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_alerts ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_announcements DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_announcements ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_chat DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_chat ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_combat_log DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_combat_log ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_cosmetics DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_cosmetics ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_draft DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_draft ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_intervals DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_intervals ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_inventory DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_inventory ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_meta DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_meta ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_meta_inventory DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_meta_inventory ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_meta_kills DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_meta_kills ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_meta_player_kills DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_meta_player_kills ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_meta_players DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_meta_players ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_meta_purchases DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_meta_purchases ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_meta_teams DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_meta_teams ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_meta_tips DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_meta_tips ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_neutrals DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_neutrals ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_pings DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_pings ADD COLUMN parse_run_id UInt64 DEFAULT 0

-- migrate:up transaction:false
ALTER TABLE replay_wards DROP COLUMN IF EXISTS parse_run_id

-- migrate:down transaction:false
ALTER TABLE replay_wards ADD COLUMN parse_run_id UInt64 DEFAULT 0
