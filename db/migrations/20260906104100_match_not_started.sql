-- migrate:up

ALTER TABLE matches
	ADD COLUMN live_duration_max REAL NOT NULL DEFAULT 0;

ALTER TABLE matches
	DROP CONSTRAINT IF EXISTS matches_last_error_kind_check;

ALTER TABLE matches
	ADD CONSTRAINT matches_last_error_kind_check CHECK (
		last_error_kind IS NULL OR last_error_kind IN (
			'network',
			'rate_limit',
			'auth',
			'not_ready',
			'unavailable',
			'history_timeout',
			'not_started',
			'other'
		)
	);

UPDATE matches
SET
	phase = 'not_started',
	waiting_for = NULL,
	history_next_poll_at = NULL,
	last_error = 'live listing never started',
	last_error_kind = 'not_started',
	last_error_at = now(),
	updated_at = now()
WHERE phase = 'awaiting_history'
	AND NOT EXISTS (
		SELECT 1
		FROM match_players p
		WHERE p.match_id = matches.match_id
			AND (
				COALESCE(p.last_hits, 0) > 0
				OR COALESCE(p.kills, 0) > 0
				OR COALESCE(p.level, 0) > 1
			)
	);

-- migrate:down

UPDATE matches
SET
	phase = 'failed',
	last_error_kind = 'other',
	updated_at = now()
WHERE phase = 'not_started';

ALTER TABLE matches
	DROP CONSTRAINT IF EXISTS matches_last_error_kind_check;

ALTER TABLE matches
	DROP COLUMN IF EXISTS live_duration_max;

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
