-- migrate:up

INSERT INTO settings (key, value, description) VALUES
	(
		'live_poll_interval_ms',
		'3000',
		'How often poll_live_games runs (milliseconds).'
	),
	(
		'live_missing_threshold',
		'2',
		'Consecutive live polls a match must be missing before we treat it as finished.'
	),
	(
		'replay_live_delay_ms',
		'1800000',
		'Delay after a live match finishes before fetch_match_details / replay download (Valve publish lag).'
	),
	(
		'history_page_size',
		'100',
		'GetMatchHistory matches_requested. Clamped to Valve max 100.'
	),
	(
		'history_details_enqueue_limit',
		'500',
		'Max in-flight historical fetch_match_details jobs.'
	),
	(
		'history_replay_enqueue_limit',
		'50',
		'Max in-flight historical download_replay jobs.'
	),
	(
		'seq_batch_size',
		'100',
		'GetMatchHistoryBySequenceNum matches_requested. Clamped to Valve max 100.'
	),
	(
		'steam_api_min_interval_ms',
		'1000',
		'Minimum delay between Steam Web API calls on the same key (1 rps).'
	),
	(
		'history_newest_refresh_ms',
		'3600000',
		'How often to re-fetch the newest GetMatchHistory page for a league that is not exhausted.'
	),
	(
		'history_exhausted_refresh_ms',
		'86400000',
		'How often to retry GetMatchHistory for a league whose older pages are exhausted.'
	),
	(
		'replenish_interval_ms',
		'60000',
		'How often replenish_accounts checks desired API-key / GC-account counts.'
	),
	(
		'retest_interval_ms',
		'300000',
		'How often retest_disabled_resources probes disabled proxies, GC accounts, and API keys.'
	),
	(
		'marketplace_buy_max',
		'10',
		'Max accounts per buy-account call (CLI, HTTP, or replenish).'
	),
	(
		'marketplace_wait_ms',
		'120000',
		'How long to wait for Dark Shopping order completed/ok before leaving the local row pending.'
	),
	(
		'marketplace_min_interval_ms',
		'500',
		'Minimum delay between Dark Shopping HTTP calls (≤ 2 req/s).'
	),
	(
		'gc_logon_attempts',
		'4',
		'Password logOn attempts (with proxy rotate) when probing a GC account.'
	),
	(
		'api_key_rate_limit_ms',
		'60000',
		'How long a Steam Web API key stays rate_limited after HTTP 429.'
	),
	(
		'gc_account_rate_limit_ms',
		'300000',
		'How long a GC account stays rate_limited after a Steam rate-limit logon error.'
	)
ON CONFLICT (key) DO NOTHING;

-- migrate:down

DELETE FROM settings WHERE key IN (
	'live_poll_interval_ms',
	'live_missing_threshold',
	'replay_live_delay_ms',
	'history_page_size',
	'history_details_enqueue_limit',
	'history_replay_enqueue_limit',
	'seq_batch_size',
	'steam_api_min_interval_ms',
	'history_newest_refresh_ms',
	'history_exhausted_refresh_ms',
	'replenish_interval_ms',
	'retest_interval_ms',
	'marketplace_buy_max',
	'marketplace_wait_ms',
	'marketplace_min_interval_ms',
	'gc_logon_attempts',
	'api_key_rate_limit_ms',
	'gc_account_rate_limit_ms'
);
