-- migrate:up

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.created_at = OLD.created_at;
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

ALTER TABLE heroes
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ingest_cursors
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE items
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE league_ingest_runs
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE leagues
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_broadcasters
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_coaches
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_draft
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_objectives
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_player_ability_upgrades
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_player_buffs
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_player_damage_breakdown
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_player_units
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE match_players
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE patches
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE players
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE series
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE teams
	ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE proxies
	ADD COLUMN retest_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE steam_accounts
	ADD COLUMN retest_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE steam_api_keys
	ADD COLUMN retest_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	description TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value, description) VALUES
	(
		'desired_api_keys',
		'3',
		'Target count of ready Steam Web API keys. Worker buys more when the ready pool plus pending orders falls below this.'
	),
	(
		'desired_gc_accounts',
		'10',
		'Target count of ready dedicated GC accounts (password, no API key, no shared_secret). Worker buys more when the ready pool plus pending orders falls below this.'
	),
	(
		'proxy_error_threshold',
		'80',
		'Disable a proxy when this percent of the last proxy_error_window attempts failed (0-100).'
	),
	(
		'proxy_error_window',
		'20',
		'How many recent proxy attempts (success and failure) are counted toward proxy_error_threshold.'
	),
	(
		'proxy_retest_max',
		'20',
		'Max times to probe a disabled proxy (every 5 minutes). After this, leave it disabled.'
	),
	(
		'gc_account_error_threshold',
		'80',
		'Disable a GC account when this percent of the last gc_account_error_window attempts failed (0-100). InvalidPassword still disables immediately.'
	),
	(
		'gc_account_error_window',
		'20',
		'How many recent GC-account attempts are counted toward gc_account_error_threshold.'
	),
	(
		'gc_account_retest_max',
		'20',
		'Max times to retest a disabled GC account (every 5 minutes). After this, leave it disabled.'
	),
	(
		'api_key_error_threshold',
		'80',
		'Disable a Steam Web API key when this percent of the last api_key_error_window attempts failed (0-100). HTTP 403 still disables immediately.'
	),
	(
		'api_key_error_window',
		'20',
		'How many recent API-key attempts are counted toward api_key_error_threshold.'
	),
	(
		'api_key_retest_max',
		'20',
		'Max times to retest a disabled API key (every 5 minutes). After this, leave it disabled.'
	);

CREATE TABLE marketplace_products (
	id BIGSERIAL PRIMARY KEY,
	store marketplace_store NOT NULL,
	kind account_purchase_kind NOT NULL,
	product_id INTEGER NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE (store, product_id),
	UNIQUE (store, kind)
);

INSERT INTO marketplace_products (store, kind, product_id) VALUES
	('dark_shopping', 'api_key', 80841),
	('dark_shopping', 'gc', 160811);

CREATE TYPE resource_kind AS ENUM ('proxy', 'gc_account', 'api_key');

CREATE TABLE resource_attempts (
	id BIGSERIAL PRIMARY KEY,
	kind resource_kind NOT NULL,
	resource_id BIGINT NOT NULL,
	ok BOOLEAN NOT NULL,
	error TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX resource_attempts_kind_id_idx
	ON resource_attempts (kind, resource_id, id DESC);

DO $$
DECLARE
	r record;
BEGIN
	FOR r IN
		SELECT c.table_name
		FROM information_schema.columns c
		WHERE c.table_schema = 'public'
			AND c.column_name = 'updated_at'
			AND c.table_name <> 'schema_migrations'
			AND EXISTS (
				SELECT 1
				FROM information_schema.columns c2
				WHERE c2.table_schema = 'public'
					AND c2.table_name = c.table_name
					AND c2.column_name = 'created_at'
			)
	LOOP
		EXECUTE format(
			'DROP TRIGGER IF EXISTS set_updated_at ON public.%I',
			r.table_name
		);
		EXECUTE format(
			'CREATE TRIGGER set_updated_at
			 BEFORE UPDATE ON public.%I
			 FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
			r.table_name
		);
	END LOOP;
END $$;

-- migrate:down

DO $$
DECLARE
	r record;
BEGIN
	FOR r IN
		SELECT trigger_name, event_object_table AS table_name
		FROM information_schema.triggers
		WHERE trigger_schema = 'public'
			AND trigger_name = 'set_updated_at'
	LOOP
		EXECUTE format(
			'DROP TRIGGER IF EXISTS set_updated_at ON public.%I',
			r.table_name
		);
	END LOOP;
END $$;

DROP TABLE IF EXISTS resource_attempts;
DROP TYPE IF EXISTS resource_kind;
DROP TABLE IF EXISTS marketplace_products;
DROP TABLE IF EXISTS settings;

ALTER TABLE steam_api_keys DROP COLUMN IF EXISTS retest_count;
ALTER TABLE steam_accounts DROP COLUMN IF EXISTS retest_count;
ALTER TABLE proxies DROP COLUMN IF EXISTS retest_count;

ALTER TABLE teams DROP COLUMN IF EXISTS created_at;
ALTER TABLE series DROP COLUMN IF EXISTS created_at;
ALTER TABLE players DROP COLUMN IF EXISTS created_at;
ALTER TABLE patches
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE match_players DROP COLUMN IF EXISTS created_at;
ALTER TABLE match_player_units
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE match_player_damage_breakdown
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE match_player_buffs
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE match_player_ability_upgrades
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE match_objectives
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE match_draft
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE match_coaches
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE match_broadcasters
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE leagues DROP COLUMN IF EXISTS created_at;
ALTER TABLE league_ingest_runs DROP COLUMN IF EXISTS updated_at;
ALTER TABLE items
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;
ALTER TABLE ingest_cursors DROP COLUMN IF EXISTS created_at;
ALTER TABLE heroes
	DROP COLUMN IF EXISTS created_at,
	DROP COLUMN IF EXISTS updated_at;

DROP FUNCTION IF EXISTS public.set_updated_at();
