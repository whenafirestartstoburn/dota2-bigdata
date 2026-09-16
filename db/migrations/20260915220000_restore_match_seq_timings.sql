-- Seq-num details retry timings. Restored now that ingest calls
-- GetMatchHistoryBySequenceNum in parallel with GC.

-- migrate:up

ALTER TABLE matches
	ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN next_attempt_at TIMESTAMPTZ;

-- migrate:down

ALTER TABLE matches
	DROP COLUMN attempts,
	DROP COLUMN next_attempt_at;
