-- migrate:up

INSERT INTO settings (key, value, description) VALUES
	(
		'parser_parallelism',
		'1',
		'How many stored replays the Go parser parses at once.'
	)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE match_replays
	ADD COLUMN parse_run_id BIGINT;

-- migrate:down

ALTER TABLE match_replays
	DROP COLUMN IF EXISTS parse_run_id;

DELETE FROM settings WHERE key = 'parser_parallelism';
