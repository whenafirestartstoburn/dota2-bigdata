-- matches.attempts was an unused ingest-error tally.
-- Replay retries are match_replays.attempts; history uses history_poll_*_count.

-- migrate:up

ALTER TABLE matches DROP COLUMN attempts;

-- migrate:down

ALTER TABLE matches
	ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
