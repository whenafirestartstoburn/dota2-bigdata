-- waiting_for is 1:1 with match_status; workers filter status.

-- migrate:up

DROP INDEX IF EXISTS matches_waiting_for_idx;

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_waiting_for_check;

ALTER TABLE matches DROP COLUMN waiting_for;

-- migrate:down

ALTER TABLE matches ADD COLUMN waiting_for TEXT;

ALTER TABLE matches ADD CONSTRAINT matches_waiting_for_check CHECK (
	waiting_for IS NULL OR waiting_for IN (
		'live_end', 'history', 'gc', 'replay', 'parse'
	)
);

CREATE INDEX matches_waiting_for_idx
	ON matches (waiting_for)
	WHERE waiting_for IS NOT NULL;
