-- parse_run_id was the unpublished-write token. Re-parse now deletes
-- by match_id before insert; readers query replay_* by match_id.

-- migrate:up
ALTER TABLE match_replays DROP COLUMN IF EXISTS parse_run_id;

-- migrate:down
ALTER TABLE match_replays ADD COLUMN parse_run_id BIGINT;
