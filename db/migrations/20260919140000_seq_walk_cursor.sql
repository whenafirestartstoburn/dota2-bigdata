-- migrate:up

INSERT INTO settings (key, value, description) VALUES
	(
		'seq_walk_cursor',
		'7561931158',
		'Next GetMatchHistoryBySequenceNum start_at_match_seq_num to claim.'
	),
	(
		'seq_walk_parallelism',
		'2',
		'How many fetch_seq_window jobs may be in flight.'
	),
	(
		'seq_walk_latest_start_time',
		'',
		'Write-only. Highest start_time seen on a seq window, YYYY-MM-DD HH:MM:SS UTC.'
	),
	(
		'seq_walk_cooldown_until',
		'',
		'ISO timestamp. walk_seq_history waits after an empty seq window.'
	);

-- migrate:down

DELETE FROM settings
WHERE key IN (
	'seq_walk_cursor',
	'seq_walk_parallelism',
	'seq_walk_latest_start_time',
	'seq_walk_cooldown_until'
);
