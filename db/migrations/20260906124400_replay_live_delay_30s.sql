-- migrate:up

UPDATE settings
SET
	value = '30000',
	description = 'First live replay download wait after finish (30 s). 404s then follow 1m, 1m, 3m×20, 1h×24, then replay_unavailable.'
WHERE key = 'replay_live_delay_ms';

-- migrate:down

UPDATE settings
SET
	value = '1800000',
	description = 'Delay after a live match finishes before fetch_match_details / replay download (Valve publish lag).'
WHERE key = 'replay_live_delay_ms';
