-- Unused leftovers: never filled, or only stamped by seq CLI.
-- GC account/proxy live on match_replays. waiting_for seq and
-- replay_status awaiting_gc are unused enum/check values.

-- migrate:up

UPDATE matches SET waiting_for = 'gc' WHERE waiting_for = 'seq';

ALTER TABLE matches DROP CONSTRAINT matches_waiting_for_check;

ALTER TABLE matches ADD CONSTRAINT matches_waiting_for_check CHECK (
	waiting_for IS NULL OR waiting_for IN (
		'live_end', 'history', 'gc', 'replay', 'parse'
	)
);

ALTER TABLE matches
	DROP COLUMN last_api_key_id,
	DROP COLUMN last_steam_account_id,
	DROP COLUMN last_proxy_id;

UPDATE match_replays SET status = 'pending' WHERE status = 'awaiting_gc';

DROP INDEX IF EXISTS match_replays_parsed_unarchived_idx;

ALTER TABLE match_replays ALTER COLUMN status DROP DEFAULT;

ALTER TYPE replay_status RENAME TO replay_status_old;

CREATE TYPE replay_status AS ENUM (
	'pending',
	'downloading',
	'stored',
	'parsing',
	'parsed',
	'unavailable',
	'failed'
);

ALTER TABLE match_replays
	ALTER COLUMN status TYPE replay_status
	USING status::text::replay_status;

ALTER TABLE match_replays
	ALTER COLUMN status SET DEFAULT 'pending'::replay_status;

DROP TYPE replay_status_old;

CREATE INDEX match_replays_parsed_unarchived_idx
	ON match_replays (parsed_at ASC NULLS LAST, id ASC)
	WHERE status = 'parsed' AND archived_at IS NULL;

-- migrate:down

DROP INDEX IF EXISTS match_replays_parsed_unarchived_idx;

ALTER TABLE match_replays ALTER COLUMN status DROP DEFAULT;

ALTER TYPE replay_status RENAME TO replay_status_new;

CREATE TYPE replay_status AS ENUM (
	'pending',
	'awaiting_gc',
	'downloading',
	'stored',
	'parsing',
	'parsed',
	'unavailable',
	'failed'
);

ALTER TABLE match_replays
	ALTER COLUMN status TYPE replay_status
	USING status::text::replay_status;

ALTER TABLE match_replays
	ALTER COLUMN status SET DEFAULT 'pending'::replay_status;

DROP TYPE replay_status_new;

CREATE INDEX match_replays_parsed_unarchived_idx
	ON match_replays (parsed_at ASC NULLS LAST, id ASC)
	WHERE status = 'parsed' AND archived_at IS NULL;

ALTER TABLE matches
	ADD COLUMN last_api_key_id bigint REFERENCES steam_api_keys (id) ON DELETE SET NULL,
	ADD COLUMN last_steam_account_id bigint REFERENCES steam_accounts (id) ON DELETE SET NULL,
	ADD COLUMN last_proxy_id bigint REFERENCES proxies (id) ON DELETE SET NULL;

ALTER TABLE matches DROP CONSTRAINT matches_waiting_for_check;

ALTER TABLE matches ADD CONSTRAINT matches_waiting_for_check CHECK (
	waiting_for IS NULL OR waiting_for IN (
		'live_end', 'history', 'seq', 'gc', 'replay', 'parse'
	)
);
