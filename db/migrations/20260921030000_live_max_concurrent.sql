-- migrate:up

UPDATE settings
SET
	description = 'Period from tick start for poll_live_games / poll_top_live / poll_realtime_stats (milliseconds). Next run is scheduled immediately so Steam latency does not stretch the period.'
WHERE key = 'live_poll_interval_ms';

INSERT INTO settings (key, value, description) VALUES
	(
		'live_max_concurrent',
		'5',
		'Max in-flight poll_live_games / poll_top_live / poll_realtime_stats ticks. A tick that would exceed this is skipped until a slot frees; the 1s period still advances.'
	)
ON CONFLICT (key) DO UPDATE SET
	value = EXCLUDED.value,
	description = EXCLUDED.description;

-- migrate:down

UPDATE settings
SET
	description = 'How often poll_live_games / poll_top_live / poll_realtime_stats run (milliseconds).'
WHERE key = 'live_poll_interval_ms';

DELETE FROM settings WHERE key = 'live_max_concurrent';
