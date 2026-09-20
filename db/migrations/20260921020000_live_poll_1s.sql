-- migrate:up

UPDATE settings
SET
	value = '1000',
	description = 'How often poll_live_games / poll_top_live / poll_realtime_stats run (milliseconds).'
WHERE key = 'live_poll_interval_ms';

INSERT INTO settings (key, value, description) VALUES
	(
		'seq_walk_interval_ms',
		'1000',
		'How often walk_seq_history claims GetMatchHistoryBySequenceNum windows while catching up. Empty tip still sleeps 60s (seq_walk_cooldown_until).'
	)
ON CONFLICT (key) DO UPDATE SET
	value = EXCLUDED.value,
	description = EXCLUDED.description;

-- migrate:down

UPDATE settings
SET
	value = '2000',
	description = 'How often poll_live_games / poll_top_live / poll_realtime_stats run (milliseconds).'
WHERE key = 'live_poll_interval_ms';

DELETE FROM settings WHERE key = 'seq_walk_interval_ms';
