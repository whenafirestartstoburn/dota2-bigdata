-- Live ticks live in ClickHouse. PG tables are empty after the drain.

-- migrate:up

DROP TABLE IF EXISTS live_player_ticks;
DROP TABLE IF EXISTS live_match_ticks;

-- migrate:down

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

CREATE INDEX live_match_ticks_match_captured_idx
	ON live_match_ticks (match_id, captured_at DESC);
CREATE INDEX live_match_ticks_captured_idx
	ON live_match_ticks (captured_at DESC);
CREATE INDEX live_player_ticks_match_captured_idx
	ON live_player_ticks (match_id, captured_at DESC);
CREATE INDEX live_player_ticks_captured_idx
	ON live_player_ticks (captured_at DESC);
