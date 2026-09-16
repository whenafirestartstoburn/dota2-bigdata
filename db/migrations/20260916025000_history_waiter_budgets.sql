-- migrate:up

UPDATE settings
SET
	value = '720',
	description = 'Fast GetMatchHistory polls per live-finished match (60 min at history_fast_poll_ms).'
WHERE key = 'history_fast_poll_limit';

UPDATE settings
SET
	value = '180',
	description = 'Slow GetMatchHistory polls per live-finished match (3 h at history_slow_poll_ms) before history_timeout.'
WHERE key = 'history_slow_poll_limit';

-- migrate:down

UPDATE settings
SET
	value = '100',
	description = 'Fast GetMatchHistory polls per live-finished match before switching to the slow interval.'
WHERE key = 'history_fast_poll_limit';

UPDATE settings
SET
	value = '100',
	description = 'Slow GetMatchHistory polls per live-finished match before history_timeout.'
WHERE key = 'history_slow_poll_limit';
