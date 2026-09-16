-- migrate:up

ALTER TABLE match_replays
	ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX match_replays_parsed_unarchived_idx
	ON match_replays (parsed_at ASC NULLS LAST, id ASC)
	WHERE status = 'parsed' AND archived_at IS NULL;

INSERT INTO settings (key, value, description) VALUES
	(
		'replay_archive_interval_ms',
		'30000',
		'How often archive_parsed_replays runs when the batch is not full (milliseconds).'
	),
	(
		'replay_archive_batch_size',
		'10',
		'Parsed replays copied to cold storage per archive_parsed_replays tick.'
	)
ON CONFLICT (key) DO NOTHING;

-- migrate:down

DELETE FROM settings WHERE key IN (
	'replay_archive_interval_ms',
	'replay_archive_batch_size'
);

DROP INDEX IF EXISTS match_replays_parsed_unarchived_idx;

ALTER TABLE match_replays DROP COLUMN IF EXISTS archived_at;
