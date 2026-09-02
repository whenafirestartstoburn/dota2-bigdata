-- Extra scalars Valve already sends on GetMatchDetails / seq-num / live /
-- CMsgDOTAMatch, plus child tables for nested GC/HTTP arrays. No JSON blobs.

-- migrate:up

ALTER TABLE matches
	ADD COLUMN lobby_id BIGINT,
	ADD COLUMN match_flags INTEGER,
	ADD COLUMN match_outcome INTEGER,
	ADD COLUMN game_balance REAL,
	ADD COLUMN radiant_team_logo BIGINT,
	ADD COLUMN dire_team_logo BIGINT,
	ADD COLUMN radiant_team_logo_url TEXT,
	ADD COLUMN dire_team_logo_url TEXT,
	ADD COLUMN radiant_team_tag TEXT,
	ADD COLUMN dire_team_tag TEXT,
	ADD COLUMN radiant_guild_id INTEGER,
	ADD COLUMN dire_guild_id INTEGER,
	ADD COLUMN tournament_id INTEGER,
	ADD COLUMN tournament_round INTEGER,
	ADD COLUMN league_series_id INTEGER,
	ADD COLUMN league_game_id INTEGER,
	ADD COLUMN game_number INTEGER,
	ADD COLUMN stage_name TEXT,
	ADD COLUMN league_tier INTEGER;

ALTER TABLE match_players
	ALTER COLUMN party_id TYPE BIGINT,
	ADD COLUMN item_neutral2 INTEGER,
	ADD COLUMN item_6 INTEGER,
	ADD COLUMN item_7 INTEGER,
	ADD COLUMN item_8 INTEGER,
	ADD COLUMN item_9 INTEGER,
	ADD COLUMN item_10 INTEGER,
	ADD COLUMN item_10_lvl INTEGER,
	ADD COLUMN selected_facet INTEGER,
	ADD COLUMN aghanims_scepter INTEGER,
	ADD COLUMN aghanims_shard INTEGER,
	ADD COLUMN moonshard INTEGER,
	ADD COLUMN claimed_farm_gold INTEGER,
	ADD COLUMN support_gold INTEGER,
	ADD COLUMN claimed_denies INTEGER,
	ADD COLUMN claimed_misses INTEGER,
	ADD COLUMN misses INTEGER,
	ADD COLUMN support_ability_value INTEGER,
	ADD COLUMN scaled_kills REAL,
	ADD COLUMN scaled_deaths REAL,
	ADD COLUMN scaled_assists REAL,
	ADD COLUMN hero_pick_order INTEGER,
	ADD COLUMN hero_was_randomed BOOLEAN,
	ADD COLUMN seconds_dead INTEGER,
	ADD COLUMN gold_lost_to_death INTEGER,
	ADD COLUMN lane_selection_flags INTEGER,
	ADD COLUMN bounty_runes INTEGER,
	ADD COLUMN outposts_captured INTEGER,
	ADD COLUMN disable_duration INTEGER,
	ADD COLUMN pro_name TEXT,
	ADD COLUMN real_name TEXT;

ALTER TABLE match_player_buffs
	ADD COLUMN grant_time INTEGER;

-- Postgres: skill-build from GetMatchDetails / GC (ability id + game time).
CREATE TABLE match_player_ability_upgrades (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	player_slot INTEGER NOT NULL,
	seq INTEGER NOT NULL,
	ability_id INTEGER NOT NULL,
	time INTEGER,
	level INTEGER,
	PRIMARY KEY (match_id, player_slot, seq)
);

-- Postgres: GC hero_damage_received / hero_damage_dealt by damage type.
CREATE TABLE match_player_damage_breakdown (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	player_slot INTEGER NOT NULL,
	direction TEXT NOT NULL,
	damage_type INTEGER NOT NULL,
	pre_reduction INTEGER,
	post_reduction INTEGER,
	PRIMARY KEY (match_id, player_slot, direction, damage_type)
);

-- Postgres: CMsgDOTAMatch.Coach (pro lobby coaches, not the private coaching proto).
CREATE TABLE match_coaches (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	account_id BIGINT NOT NULL,
	coach_name TEXT,
	coach_rating INTEGER,
	coach_team INTEGER,
	coach_party_id BIGINT,
	is_private_coach BOOLEAN,
	PRIMARY KEY (match_id, account_id)
);

-- Postgres: GC broadcaster channels (country, language, caster account).
CREATE TABLE match_broadcasters (
	match_id BIGINT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
	seq INTEGER NOT NULL,
	country_code TEXT,
	description TEXT,
	language_code TEXT,
	account_id BIGINT,
	name TEXT,
	PRIMARY KEY (match_id, seq)
);

-- migrate:down

DROP TABLE IF EXISTS match_broadcasters;
DROP TABLE IF EXISTS match_coaches;
DROP TABLE IF EXISTS match_player_damage_breakdown;
DROP TABLE IF EXISTS match_player_ability_upgrades;

ALTER TABLE match_player_buffs
	DROP COLUMN IF EXISTS grant_time;

ALTER TABLE match_players
	DROP COLUMN IF EXISTS real_name,
	DROP COLUMN IF EXISTS pro_name,
	DROP COLUMN IF EXISTS disable_duration,
	DROP COLUMN IF EXISTS outposts_captured,
	DROP COLUMN IF EXISTS bounty_runes,
	DROP COLUMN IF EXISTS lane_selection_flags,
	DROP COLUMN IF EXISTS gold_lost_to_death,
	DROP COLUMN IF EXISTS seconds_dead,
	DROP COLUMN IF EXISTS hero_was_randomed,
	DROP COLUMN IF EXISTS hero_pick_order,
	DROP COLUMN IF EXISTS scaled_assists,
	DROP COLUMN IF EXISTS scaled_deaths,
	DROP COLUMN IF EXISTS scaled_kills,
	DROP COLUMN IF EXISTS support_ability_value,
	DROP COLUMN IF EXISTS misses,
	DROP COLUMN IF EXISTS claimed_misses,
	DROP COLUMN IF EXISTS claimed_denies,
	DROP COLUMN IF EXISTS support_gold,
	DROP COLUMN IF EXISTS claimed_farm_gold,
	DROP COLUMN IF EXISTS moonshard,
	DROP COLUMN IF EXISTS aghanims_shard,
	DROP COLUMN IF EXISTS aghanims_scepter,
	DROP COLUMN IF EXISTS selected_facet,
	DROP COLUMN IF EXISTS item_10_lvl,
	DROP COLUMN IF EXISTS item_10,
	DROP COLUMN IF EXISTS item_9,
	DROP COLUMN IF EXISTS item_8,
	DROP COLUMN IF EXISTS item_7,
	DROP COLUMN IF EXISTS item_6,
	DROP COLUMN IF EXISTS item_neutral2,
	ALTER COLUMN party_id TYPE INTEGER;

ALTER TABLE matches
	DROP COLUMN IF EXISTS league_tier,
	DROP COLUMN IF EXISTS stage_name,
	DROP COLUMN IF EXISTS game_number,
	DROP COLUMN IF EXISTS league_game_id,
	DROP COLUMN IF EXISTS league_series_id,
	DROP COLUMN IF EXISTS tournament_round,
	DROP COLUMN IF EXISTS tournament_id,
	DROP COLUMN IF EXISTS dire_guild_id,
	DROP COLUMN IF EXISTS radiant_guild_id,
	DROP COLUMN IF EXISTS dire_team_tag,
	DROP COLUMN IF EXISTS radiant_team_tag,
	DROP COLUMN IF EXISTS dire_team_logo_url,
	DROP COLUMN IF EXISTS radiant_team_logo_url,
	DROP COLUMN IF EXISTS dire_team_logo,
	DROP COLUMN IF EXISTS radiant_team_logo,
	DROP COLUMN IF EXISTS game_balance,
	DROP COLUMN IF EXISTS match_outcome,
	DROP COLUMN IF EXISTS match_flags,
	DROP COLUMN IF EXISTS lobby_id;
