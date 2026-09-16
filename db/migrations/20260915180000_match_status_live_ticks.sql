-- migrate:up

ALTER TYPE match_phase RENAME TO match_status;

ALTER TABLE matches RENAME COLUMN phase TO status;

ALTER INDEX matches_phase_idx RENAME TO matches_status_idx;
ALTER INDEX matches_source_phase_idx RENAME TO matches_source_status_idx;

CREATE TABLE live_match_ticks (
	id bigserial PRIMARY KEY,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	match_id bigint NOT NULL REFERENCES matches (match_id),
	captured_at timestamptz NOT NULL,
	league_id integer NOT NULL DEFAULT 0,
	duration real NOT NULL DEFAULT 0,
	radiant_score integer NOT NULL DEFAULT 0,
	dire_score integer NOT NULL DEFAULT 0,
	spectators integer NOT NULL DEFAULT 0,
	tower_state_radiant integer NOT NULL DEFAULT 0,
	tower_state_dire integer NOT NULL DEFAULT 0,
	barracks_state_radiant integer NOT NULL DEFAULT 0,
	barracks_state_dire integer NOT NULL DEFAULT 0,
	roshan_respawn_timer integer NOT NULL DEFAULT 0,
	series_type smallint NOT NULL DEFAULT 0,
	radiant_series_wins smallint NOT NULL DEFAULT 0,
	dire_series_wins smallint NOT NULL DEFAULT 0,
	stream_delay_s integer NOT NULL DEFAULT 0,
	source text NOT NULL,
	lobby_id bigint NOT NULL DEFAULT 0,
	game_number smallint NOT NULL DEFAULT 0,
	league_series_id integer NOT NULL DEFAULT 0,
	league_game_id integer NOT NULL DEFAULT 0,
	league_tier smallint NOT NULL DEFAULT 0,
	game_state smallint NOT NULL DEFAULT 0,
	server_steam_id bigint NOT NULL DEFAULT 0,
	UNIQUE (match_id, captured_at, source)
);

CREATE TABLE live_player_ticks (
	id bigserial PRIMARY KEY,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	match_id bigint NOT NULL REFERENCES matches (match_id),
	captured_at timestamptz NOT NULL,
	player_slot smallint NOT NULL,
	account_id bigint NOT NULL DEFAULT 0,
	hero_id integer NOT NULL DEFAULT 0,
	kills integer NOT NULL DEFAULT 0,
	deaths integer NOT NULL DEFAULT 0,
	assists integer NOT NULL DEFAULT 0,
	last_hits integer NOT NULL DEFAULT 0,
	denies integer NOT NULL DEFAULT 0,
	gold integer NOT NULL DEFAULT 0,
	net_worth integer NOT NULL DEFAULT 0,
	level smallint NOT NULL DEFAULT 0,
	gold_per_min integer NOT NULL DEFAULT 0,
	xp_per_min integer NOT NULL DEFAULT 0,
	x real NOT NULL DEFAULT 0,
	y real NOT NULL DEFAULT 0,
	source text NOT NULL,
	item0 integer NOT NULL DEFAULT 0,
	item1 integer NOT NULL DEFAULT 0,
	item2 integer NOT NULL DEFAULT 0,
	item3 integer NOT NULL DEFAULT 0,
	item4 integer NOT NULL DEFAULT 0,
	item5 integer NOT NULL DEFAULT 0,
	item6 integer NOT NULL DEFAULT 0,
	item7 integer NOT NULL DEFAULT 0,
	item8 integer NOT NULL DEFAULT 0,
	ultimate_state smallint NOT NULL DEFAULT 0,
	ultimate_cooldown integer NOT NULL DEFAULT 0,
	respawn_timer integer NOT NULL DEFAULT 0,
	UNIQUE (match_id, captured_at, player_slot, source)
);

CREATE TRIGGER set_updated_at
	BEFORE UPDATE ON live_match_ticks
	FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at
	BEFORE UPDATE ON live_player_ticks
	FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Live ticks: latest / timeline for one match; recent window / cleanup.
CREATE INDEX live_match_ticks_match_captured_idx
	ON live_match_ticks (match_id, captured_at DESC);
CREATE INDEX live_match_ticks_captured_idx
	ON live_match_ticks (captured_at DESC);
CREATE INDEX live_player_ticks_match_captured_idx
	ON live_player_ticks (match_id, captured_at DESC);
CREATE INDEX live_player_ticks_captured_idx
	ON live_player_ticks (captured_at DESC);

-- Walk enqueue: live first, then start_time.
CREATE INDEX matches_details_pending_idx
	ON matches (source, start_time DESC)
	WHERE details_fetched_at IS NULL
		AND status IN ('discovered', 'awaiting_details');

CREATE INDEX matches_patch_idx
	ON matches (patch)
	WHERE patch IS NOT NULL;

CREATE INDEX matches_waiting_for_idx
	ON matches (waiting_for)
	WHERE waiting_for IS NOT NULL;

-- Parser claim: stored objects, live first.
CREATE INDEX match_replays_claim_idx
	ON match_replays (priority ASC, stored_at ASC NULLS LAST, id ASC)
	WHERE status = 'stored' AND s3_key IS NOT NULL AND s3_key <> '';

-- History walker: skip UPCOMING, prefer higher tier / recent activity.
CREATE INDEX leagues_history_walk_idx
	ON leagues (status, history_exhausted, history_checked_at);

-- Resource pick + proxy occupancy.
CREATE INDEX steam_api_keys_pick_idx
	ON steam_api_keys (last_used_at ASC NULLS FIRST)
	WHERE status IN ('ready', 'active', 'rate_limited');
CREATE INDEX steam_api_keys_account_idx
	ON steam_api_keys (account_id);
CREATE INDEX steam_api_keys_proxy_idx
	ON steam_api_keys (proxy_id)
	WHERE proxy_id IS NOT NULL;

CREATE INDEX steam_accounts_status_idx
	ON steam_accounts (status);
CREATE INDEX steam_accounts_proxy_idx
	ON steam_accounts (proxy_id)
	WHERE proxy_id IS NOT NULL;

CREATE INDEX proxies_pick_idx
	ON proxies (purpose, status);

-- “this player’s matches” / patch lookup.
CREATE INDEX match_players_account_idx
	ON match_players (account_id);
CREATE INDEX patches_released_idx
	ON patches (released_at DESC);
CREATE INDEX players_team_idx
	ON players (current_team_id)
	WHERE current_team_id IS NOT NULL;

UPDATE settings
SET
	value = '2000',
	description = 'How often poll_live_games / poll_top_live / poll_realtime_stats run (milliseconds).'
WHERE key = 'live_poll_interval_ms';

-- migrate:down

UPDATE settings
SET
	value = '3000',
	description = 'How often poll_live_games runs (milliseconds).'
WHERE key = 'live_poll_interval_ms';

DROP INDEX IF EXISTS players_team_idx;
DROP INDEX IF EXISTS patches_released_idx;
DROP INDEX IF EXISTS match_players_account_idx;
DROP INDEX IF EXISTS proxies_pick_idx;
DROP INDEX IF EXISTS steam_accounts_proxy_idx;
DROP INDEX IF EXISTS steam_accounts_status_idx;
DROP INDEX IF EXISTS steam_api_keys_proxy_idx;
DROP INDEX IF EXISTS steam_api_keys_account_idx;
DROP INDEX IF EXISTS steam_api_keys_pick_idx;
DROP INDEX IF EXISTS leagues_history_walk_idx;
DROP INDEX IF EXISTS match_replays_claim_idx;
DROP INDEX IF EXISTS matches_waiting_for_idx;
DROP INDEX IF EXISTS matches_patch_idx;
DROP INDEX IF EXISTS matches_details_pending_idx;

DROP TABLE IF EXISTS live_player_ticks;
DROP TABLE IF EXISTS live_match_ticks;

ALTER INDEX matches_source_status_idx RENAME TO matches_source_phase_idx;
ALTER INDEX matches_status_idx RENAME TO matches_phase_idx;
ALTER TABLE matches RENAME COLUMN status TO phase;
ALTER TYPE match_status RENAME TO match_phase;
