-- migrate:up

-- Domain + operational schema in Postgres. graphile_worker is created by the
-- worker at runtime and is not part of this migration.
--
-- Store split: this file = mutable entities, box scores, cursors, Steam/proxy
-- inventory. ClickHouse = live ticks + replay events (db/clickhouse/migrations).
-- S3 = .dem.bz2 bytes (not a SQL table).

CREATE TYPE league_lifecycle AS ENUM ('UPCOMING', 'LIVE', 'FINISHED');
CREATE TYPE resource_status AS ENUM (
	'ready',
	'active',
	'rate_limited',
	'disabled'
);
CREATE TYPE proxy_kind AS ENUM ('http', 'socks5');
CREATE TYPE proxy_purpose AS ENUM ('api', 'gc', 'both');
CREATE TYPE match_phase AS ENUM (
	'discovered',
	'live',
	'awaiting_details',
	'details_ready',
	'awaiting_replay',
	'replay_stored',
	'replay_unavailable',
	'failed'
);
CREATE TYPE match_source AS ENUM ('live', 'historical');
CREATE TYPE replay_priority AS ENUM ('live', 'historical');
CREATE TYPE replay_status AS ENUM (
	'pending',
	'awaiting_gc',
	'downloading',
	'stored',
	'parsing',
	'parsed',
	'unavailable',
	'failed'
);
CREATE TYPE ingest_run_status AS ENUM (
	'queued',
	'running',
	'succeeded',
	'failed'
);

-- Postgres: Dota patch catalog (version + release time). Stamps matches.patch from start_time.
CREATE TABLE patches (
	patch TEXT PRIMARY KEY,
	released_at TIMESTAMPTZ NOT NULL
);

INSERT INTO patches (patch, released_at) VALUES
	('7.00', '2016-12-12 00:00:00+00'),
	('7.01', '2016-12-21 00:00:00+00'),
	('7.06', '2017-05-15 00:00:00+00'),
	('7.07', '2017-10-31 00:00:00+00'),
	('7.10', '2018-03-01 00:00:00+00'),
	('7.20', '2018-11-19 00:00:00+00'),
	('7.22', '2019-05-24 00:00:00+00'),
	('7.23', '2019-11-26 00:00:00+00'),
	('7.24', '2020-01-26 00:00:00+00'),
	('7.27', '2020-06-28 00:00:00+00'),
	('7.28', '2020-12-17 00:00:00+00'),
	('7.29', '2021-04-09 00:00:00+00'),
	('7.30', '2021-08-18 00:00:00+00'),
	('7.31', '2022-02-23 00:00:00+00'),
	('7.32', '2022-08-24 00:00:00+00'),
	('7.33', '2023-04-20 00:00:00+00'),
	('7.34', '2023-08-08 00:00:00+00'),
	('7.35', '2023-12-14 00:00:00+00'),
	('7.36', '2024-05-22 00:00:00+00'),
	('7.37', '2024-08-14 00:00:00+00'),
	('7.38', '2025-02-19 00:00:00+00'),
	('7.39', '2025-05-23 00:00:00+00');

-- Postgres: static hero catalog keyed by Valve hero id. Events store ids only.
CREATE TABLE heroes (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	localized_name TEXT NOT NULL DEFAULT '',
	primary_attr TEXT,
	attack_type TEXT,
	roles TEXT[] NOT NULL DEFAULT '{}'
);

-- Postgres: static item catalog keyed by Valve item id. Events store ids only.
CREATE TABLE items (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	localized_name TEXT NOT NULL DEFAULT '',
	cost INTEGER
);

-- Postgres: current team/org row. Match rows keep team names as a game-time snapshot.
CREATE TABLE teams (
	team_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	tag TEXT,
	logo_url TEXT,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres: Steam accounts seen in league matches (persona, last team, last match).
CREATE TABLE players (
	account_id BIGINT PRIMARY KEY,
	steam_id TEXT,
	persona_name TEXT,
	is_pro BOOLEAN NOT NULL DEFAULT false,
	current_team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL,
	last_match_id BIGINT,
	last_match_at TIMESTAMPTZ,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres (ops): HTTP/SOCKS5 egress for Steam Web API and Game Coordinator. Not match data.
CREATE TABLE proxies (
	id BIGSERIAL PRIMARY KEY,
	name TEXT NOT NULL,
	url TEXT NOT NULL UNIQUE,
	kind proxy_kind NOT NULL DEFAULT 'http',
	purpose proxy_purpose NOT NULL DEFAULT 'both',
	region TEXT,
	supports_udp BOOLEAN NOT NULL DEFAULT false,
	status resource_status NOT NULL DEFAULT 'ready',
	rate_limited_until TIMESTAMPTZ,
	last_error TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres (ops): Steam logins. Web API pool vs GC pool (password, no API key, no shared_secret).
CREATE TABLE steam_accounts (
	id BIGSERIAL PRIMARY KEY,
	login TEXT NOT NULL UNIQUE,
	password TEXT NOT NULL,
	shared_secret TEXT,
	identity_secret TEXT,
	steam_id TEXT,
	proxy_id BIGINT REFERENCES proxies (id) ON DELETE SET NULL,
	status resource_status NOT NULL DEFAULT 'ready',
	rate_limited_until TIMESTAMPTZ,
	last_login_at TIMESTAMPTZ,
	last_error TEXT,
	shared_secret_broken BOOLEAN NOT NULL DEFAULT false,
	email TEXT,
	email_password TEXT,
	email_imap_host TEXT,
	refresh_token TEXT,
	refresh_token_expires_at TIMESTAMPTZ,
	machine_auth_token TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres (ops): Steam Web API keys; last_called_at is the 1 rps mutex. Not match data.
CREATE TABLE steam_api_keys (
	id BIGSERIAL PRIMARY KEY,
	account_id BIGINT NOT NULL REFERENCES steam_accounts (id) ON DELETE CASCADE,
	api_key TEXT NOT NULL UNIQUE,
	proxy_id BIGINT REFERENCES proxies (id) ON DELETE SET NULL,
	status resource_status NOT NULL DEFAULT 'ready',
	daily_quota INTEGER,
	rate_limited_until TIMESTAMPTZ,
	last_used_at TIMESTAMPTZ,
	last_called_at TIMESTAMPTZ,
	last_error TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres: Valve leagues (GetLeagueInfoList) plus our UPCOMING/LIVE/FINISHED
-- status and history cursors.
CREATE TABLE leagues (
	league_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	tier INTEGER NOT NULL DEFAULT 0,
	region INTEGER NOT NULL DEFAULT 0,
	total_prize_pool BIGINT NOT NULL DEFAULT 0,
	start_timestamp BIGINT NOT NULL DEFAULT 0,
	end_timestamp BIGINT NOT NULL DEFAULT 0,
	most_recent_activity BIGINT NOT NULL DEFAULT 0,
	valve_status INTEGER NOT NULL DEFAULT 0,
	status league_lifecycle NOT NULL,
	fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_match_seq_num BIGINT,
	history_head_match_id BIGINT,
	history_tail_match_id BIGINT,
	history_exhausted BOOLEAN NOT NULL DEFAULT false,
	history_checked_at TIMESTAMPTZ
);

CREATE INDEX leagues_status_idx ON leagues (status);
CREATE INDEX leagues_activity_idx ON leagues (most_recent_activity DESC);

-- Postgres: Bo1/Bo3/Bo5 grouping. Valve series_id when > 0, otherwise a synthetic id.
CREATE TABLE series (
	series_id BIGINT PRIMARY KEY,
	league_id INTEGER REFERENCES leagues (league_id) ON DELETE SET NULL,
	radiant_team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL,
	dire_team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL,
	series_type INTEGER NOT NULL DEFAULT 0,
	radiant_wins INTEGER NOT NULL DEFAULT 0,
	dire_wins INTEGER NOT NULL DEFAULT 0,
	first_match_id BIGINT,
	last_match_id BIGINT,
	started_at TIMESTAMPTZ,
	ended_at TIMESTAMPTZ,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX series_league_idx ON series (league_id);

-- Postgres: one professional match — identity, box-score scalars, ingest
-- phase. Ticks/events are ClickHouse; .dem is S3.
CREATE TABLE matches (
	match_id BIGINT PRIMARY KEY,
	league_id INTEGER REFERENCES leagues (league_id) ON DELETE SET NULL,
	match_seq_num BIGINT,
	start_time BIGINT,
	duration INTEGER,
	pre_game_duration INTEGER,
	radiant_win BOOLEAN,
	lobby_type INTEGER,
	game_mode INTEGER,
	cluster INTEGER,
	replay_salt BIGINT,
	series_id BIGINT REFERENCES series (series_id) ON DELETE SET NULL,
	series_type INTEGER,
	radiant_series_wins INTEGER,
	dire_series_wins INTEGER,
	radiant_team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL,
	dire_team_id INTEGER REFERENCES teams (team_id) ON DELETE SET NULL,
	league_node_id INTEGER,
	stream_delay_s INTEGER,
	phase match_phase NOT NULL DEFAULT 'discovered',
	source match_source NOT NULL DEFAULT 'historical',
	live_seen_at TIMESTAMPTZ,
	live_disappeared_at TIMESTAMPTZ,
	live_disappeared_count INTEGER NOT NULL DEFAULT 0,
	details_fetched_at TIMESTAMPTZ,
	finished_at TIMESTAMPTZ,
	replay_available_at TIMESTAMPTZ,
	radiant_score INTEGER,
	dire_score INTEGER,
	tower_status_radiant INTEGER,
	tower_status_dire INTEGER,
	barracks_status_radiant INTEGER,
	barracks_status_dire INTEGER,
	first_blood_time INTEGER,
	engine INTEGER,
	human_players INTEGER,
	radiant_team_name TEXT,
	dire_team_name TEXT,
	radiant_team_complete SMALLINT,
	dire_team_complete SMALLINT,
	radiant_captain BIGINT,
	dire_captain BIGINT,
	positive_votes INTEGER,
	negative_votes INTEGER,
	patch TEXT REFERENCES patches (patch) ON DELETE SET NULL,
	last_error TEXT,
	last_error_at TIMESTAMPTZ,
	last_api_key_id BIGINT REFERENCES steam_api_keys (id) ON DELETE SET NULL,
	last_steam_account_id BIGINT REFERENCES steam_accounts (id) ON DELETE SET NULL,
	last_proxy_id BIGINT REFERENCES proxies (id) ON DELETE SET NULL,
	attempts INTEGER NOT NULL DEFAULT 0,
	next_attempt_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX matches_league_idx ON matches (league_id);
CREATE INDEX matches_phase_idx ON matches (phase);
CREATE INDEX matches_seq_idx ON matches (match_seq_num);
CREATE INDEX matches_source_phase_idx ON matches (source, phase);
CREATE INDEX matches_start_time_idx ON matches (league_id, start_time DESC);
CREATE INDEX matches_replay_available_idx ON matches (replay_available_at)
	WHERE phase IN ('details_ready', 'awaiting_replay');

-- Postgres: one player in a match (box score, items, parse summaries).
-- Time series (gold_t, combat) are ClickHouse.
CREATE TABLE match_players (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	account_id BIGINT NOT NULL,
	player_slot INTEGER NOT NULL,
	hero_id INTEGER NOT NULL DEFAULT 0,
	player_name TEXT,
	team_number INTEGER,
	team_slot INTEGER,
	side TEXT,
	kills INTEGER,
	deaths INTEGER,
	assists INTEGER,
	last_hits INTEGER,
	denies INTEGER,
	gold INTEGER,
	level INTEGER,
	gold_per_min INTEGER,
	xp_per_min INTEGER,
	net_worth INTEGER,
	hero_variant INTEGER,
	gold_spent INTEGER,
	hero_damage INTEGER,
	tower_damage INTEGER,
	hero_healing INTEGER,
	scaled_hero_damage INTEGER,
	scaled_tower_damage INTEGER,
	scaled_hero_healing INTEGER,
	item_0 INTEGER,
	item_1 INTEGER,
	item_2 INTEGER,
	item_3 INTEGER,
	item_4 INTEGER,
	item_5 INTEGER,
	item_neutral INTEGER,
	backpack_0 INTEGER,
	backpack_1 INTEGER,
	backpack_2 INTEGER,
	backpack_3 INTEGER,
	ability_upgrades INTEGER[],
	leaver_status INTEGER,
	party_id INTEGER,
	party_size INTEGER,
	lane INTEGER,
	lane_role INTEGER,
	is_roaming BOOLEAN,
	stuns REAL,
	teamfight_participation REAL,
	towers_killed INTEGER,
	roshans_killed INTEGER,
	observers_placed INTEGER,
	sentries_placed INTEGER,
	camps_stacked INTEGER,
	creeps_stacked INTEGER,
	rune_pickups INTEGER,
	firstblood_claimed INTEGER,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (match_id, player_slot)
);

-- Postgres: permanent buff stacks on a player in a match (Aghs, Moonshard, …).
CREATE TABLE match_player_buffs (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	player_slot INTEGER NOT NULL,
	buff_id INTEGER NOT NULL,
	stacks INTEGER NOT NULL DEFAULT 1,
	PRIMARY KEY (match_id, player_slot, buff_id)
);

-- Postgres: extra units for a player (e.g. Spirit Bear) and their item slots.
CREATE TABLE match_player_units (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	player_slot INTEGER NOT NULL,
	unit_name TEXT NOT NULL,
	item_0 INTEGER,
	item_1 INTEGER,
	item_2 INTEGER,
	item_3 INTEGER,
	item_4 INTEGER,
	item_5 INTEGER,
	PRIMARY KEY (match_id, player_slot, unit_name)
);

-- Postgres: pick/ban sequence (one ord). Provisional from live, replaced by details/replay order.
CREATE TABLE match_draft (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	ord INTEGER NOT NULL,
	is_pick BOOLEAN NOT NULL,
	hero_id INTEGER NOT NULL,
	team SMALLINT NOT NULL,
	player_slot INTEGER,
	clock INTEGER,
	PRIMARY KEY (match_id, ord)
);

-- Postgres: sparse story timeline (first blood, towers, roshan, …). Full event stream is ClickHouse replay_*.
CREATE TABLE match_objectives (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	seq INTEGER NOT NULL,
	time INTEGER NOT NULL,
	kind TEXT NOT NULL,
	team SMALLINT,
	slot INTEGER,
	key TEXT,
	value INTEGER,
	PRIMARY KEY (match_id, seq)
);

-- Postgres: replay pipeline (status, cluster/salt, S3 key). The .dem.bz2
-- bytes live in S3, parse rows in ClickHouse.
CREATE TABLE match_replays (
	match_id BIGINT PRIMARY KEY REFERENCES matches (match_id) ON DELETE CASCADE,
	status replay_status NOT NULL DEFAULT 'pending',
	priority replay_priority NOT NULL DEFAULT 'historical',
	cluster INTEGER,
	replay_salt BIGINT,
	replay_state INTEGER,
	source_url TEXT,
	s3_bucket TEXT,
	s3_key TEXT,
	bytes BIGINT,
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT,
	last_error_at TIMESTAMPTZ,
	next_attempt_at TIMESTAMPTZ,
	steam_account_id BIGINT REFERENCES steam_accounts (id) ON DELETE SET NULL,
	proxy_id BIGINT REFERENCES proxies (id) ON DELETE SET NULL,
	parser_version INTEGER,
	parsed_at TIMESTAMPTZ,
	stored_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX match_replays_status_idx ON match_replays (status);

-- Postgres (ops): worker key/value cursors (global_max_match_seq_num, next_live_poll_at). Not match facts.
CREATE TABLE ingest_cursors (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Postgres (ops): operator log for API-kicked league ingest. The steady
-- history walker does not depend on this.
CREATE TABLE league_ingest_runs (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	league_id INTEGER NOT NULL,
	matches_limit INTEGER,
	status ingest_run_status NOT NULL DEFAULT 'queued',
	matches_listed INTEGER NOT NULL DEFAULT 0,
	matches_detailed INTEGER NOT NULL DEFAULT 0,
	replays_enqueued INTEGER NOT NULL DEFAULT 0,
	error TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	started_at TIMESTAMPTZ,
	finished_at TIMESTAMPTZ
);

CREATE INDEX league_ingest_runs_league_idx
	ON league_ingest_runs (league_id, created_at DESC);

-- migrate:down

DROP TABLE IF EXISTS league_ingest_runs;
DROP TABLE IF EXISTS ingest_cursors;
DROP TABLE IF EXISTS match_replays;
DROP TABLE IF EXISTS match_objectives;
DROP TABLE IF EXISTS match_draft;
DROP TABLE IF EXISTS match_player_units;
DROP TABLE IF EXISTS match_player_buffs;
DROP TABLE IF EXISTS match_players;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS series;
DROP TABLE IF EXISTS leagues;
DROP TABLE IF EXISTS steam_api_keys;
DROP TABLE IF EXISTS steam_accounts;
DROP TABLE IF EXISTS proxies;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS heroes;
DROP TABLE IF EXISTS patches;
DROP TABLE IF EXISTS teams;
DROP TYPE IF EXISTS ingest_run_status;
DROP TYPE IF EXISTS replay_status;
DROP TYPE IF EXISTS replay_priority;
DROP TYPE IF EXISTS match_source;
DROP TYPE IF EXISTS match_phase;
DROP TYPE IF EXISTS proxy_purpose;
DROP TYPE IF EXISTS proxy_kind;
DROP TYPE IF EXISTS resource_status;
DROP TYPE IF EXISTS league_lifecycle;
