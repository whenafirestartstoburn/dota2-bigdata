-- migrate:up

ALTER TABLE matches
	ADD COLUMN ingest_sources TEXT[] NOT NULL DEFAULT '{}',
	ADD COLUMN waiting_for TEXT,
	ADD COLUMN last_error_kind TEXT,
	ADD COLUMN server_steam_id BIGINT,
	ADD COLUMN live_league_missed_polls INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN top_live_missed_polls INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN history_poll_fast_count INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN history_poll_slow_count INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN history_last_polled_at TIMESTAMPTZ,
	ADD COLUMN history_next_poll_at TIMESTAMPTZ,
	ADD COLUMN seq_fetched_at TIMESTAMPTZ,
	ADD COLUMN last_realtime_at TIMESTAMPTZ;

ALTER TABLE matches
	ADD CONSTRAINT matches_waiting_for_check CHECK (
		waiting_for IS NULL OR waiting_for IN (
			'live_end', 'history', 'seq', 'gc', 'replay', 'parse'
		)
	);

ALTER TABLE matches
	ADD CONSTRAINT matches_last_error_kind_check CHECK (
		last_error_kind IS NULL OR last_error_kind IN (
			'network',
			'rate_limit',
			'auth',
			'not_ready',
			'unavailable',
			'history_timeout',
			'other'
		)
	);

CREATE INDEX matches_history_poll_idx
	ON matches (league_id, history_next_poll_at)
	WHERE phase = 'awaiting_history';

CREATE INDEX matches_realtime_idx
	ON matches (last_realtime_at)
	WHERE phase = 'live' AND server_steam_id IS NOT NULL;

INSERT INTO settings (key, value, description) VALUES
	(
		'history_fast_poll_ms',
		'5000',
		'GetMatchHistory waiter interval for live-finished matches (first budget).'
	),
	(
		'history_fast_poll_limit',
		'100',
		'Fast GetMatchHistory polls per live-finished match before switching to the slow interval.'
	),
	(
		'history_slow_poll_ms',
		'60000',
		'GetMatchHistory waiter interval after the fast budget is spent.'
	),
	(
		'history_slow_poll_limit',
		'100',
		'Slow GetMatchHistory polls per live-finished match before history_timeout.'
	)
ON CONFLICT (key) DO NOTHING;

-- migrate:down

DELETE FROM settings WHERE key IN (
	'history_fast_poll_ms',
	'history_fast_poll_limit',
	'history_slow_poll_ms',
	'history_slow_poll_limit'
);

DROP INDEX IF EXISTS matches_realtime_idx;
DROP INDEX IF EXISTS matches_history_poll_idx;

ALTER TABLE matches
	DROP CONSTRAINT IF EXISTS matches_last_error_kind_check,
	DROP CONSTRAINT IF EXISTS matches_waiting_for_check;

UPDATE matches SET phase = 'awaiting_details' WHERE phase = 'awaiting_history';
UPDATE matches SET phase = 'replay_stored' WHERE phase = 'parsed';

ALTER TABLE matches
	DROP COLUMN IF EXISTS last_realtime_at,
	DROP COLUMN IF EXISTS seq_fetched_at,
	DROP COLUMN IF EXISTS history_next_poll_at,
	DROP COLUMN IF EXISTS history_last_polled_at,
	DROP COLUMN IF EXISTS history_poll_slow_count,
	DROP COLUMN IF EXISTS history_poll_fast_count,
	DROP COLUMN IF EXISTS top_live_missed_polls,
	DROP COLUMN IF EXISTS live_league_missed_polls,
	DROP COLUMN IF EXISTS server_steam_id,
	DROP COLUMN IF EXISTS last_error_kind,
	DROP COLUMN IF EXISTS waiting_for,
	DROP COLUMN IF EXISTS ingest_sources;
