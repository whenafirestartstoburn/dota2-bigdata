-- Synthetic series attach uses ended_at + updated_at (8h), not this
-- pointer. last_match_id was always set on insert, so IS NULL never fired.

-- migrate:up

ALTER TABLE series DROP COLUMN last_match_id;

-- migrate:down

ALTER TABLE series ADD COLUMN last_match_id BIGINT;
