-- migrate:up

-- Valve-id catalogs beyond heroes/items/patches. Match facts still store ids
-- only (no FK): live draft uses hero_id 0, and a new id must not block ingest
-- before the next catalog refresh. Mappings between catalogs do have FKs.

CREATE TABLE abilities (
	ability_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	localized_name TEXT NOT NULL DEFAULT '',
	kind TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (ability_id),
	CONSTRAINT abilities_kind_check CHECK (
		kind IN ('spell', 'talent', 'innate', 'item', 'other')
	)
);

CREATE TABLE hero_abilities (
	hero_id INTEGER NOT NULL REFERENCES heroes (hero_id) ON DELETE CASCADE,
	ability_id INTEGER NOT NULL REFERENCES abilities (ability_id) ON DELETE CASCADE,
	slot INTEGER NOT NULL,
	is_talent BOOLEAN NOT NULL DEFAULT false,
	talent_level INTEGER,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (hero_id, slot, is_talent)
);

CREATE TABLE hero_facets (
	hero_id INTEGER NOT NULL REFERENCES heroes (hero_id) ON DELETE CASCADE,
	facet_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	localized_name TEXT NOT NULL DEFAULT '',
	icon TEXT,
	color TEXT,
	deprecated BOOLEAN NOT NULL DEFAULT false,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (hero_id, facet_id)
);

CREATE TABLE permanent_buffs (
	buff_id INTEGER NOT NULL,
	name TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (buff_id)
);

CREATE TABLE game_modes (
	game_mode INTEGER NOT NULL,
	name TEXT NOT NULL,
	balanced BOOLEAN,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (game_mode)
);

CREATE TABLE lobby_types (
	lobby_type INTEGER NOT NULL,
	name TEXT NOT NULL,
	balanced BOOLEAN,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (lobby_type)
);

CREATE TABLE regions (
	region INTEGER NOT NULL,
	name TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (region)
);

CREATE TABLE clusters (
	cluster INTEGER NOT NULL,
	region INTEGER REFERENCES regions (region) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (cluster)
);

CREATE TABLE xp_levels (
	level INTEGER NOT NULL,
	xp INTEGER NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	id BIGSERIAL PRIMARY KEY,
	UNIQUE (level)
);

DO $$
DECLARE
	r record;
BEGIN
	FOR r IN
		SELECT unnest(ARRAY[
			'abilities',
			'hero_abilities',
			'hero_facets',
			'permanent_buffs',
			'game_modes',
			'lobby_types',
			'regions',
			'clusters',
			'xp_levels'
		]) AS table_name
	LOOP
		EXECUTE format(
			'CREATE TRIGGER set_updated_at
			 BEFORE UPDATE ON public.%I
			 FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
			r.table_name
		);
	END LOOP;
END $$;

-- migrate:down

DROP TABLE IF EXISTS xp_levels;
DROP TABLE IF EXISTS clusters;
DROP TABLE IF EXISTS regions;
DROP TABLE IF EXISTS lobby_types;
DROP TABLE IF EXISTS game_modes;
DROP TABLE IF EXISTS permanent_buffs;
DROP TABLE IF EXISTS hero_facets;
DROP TABLE IF EXISTS hero_abilities;
DROP TABLE IF EXISTS abilities;
