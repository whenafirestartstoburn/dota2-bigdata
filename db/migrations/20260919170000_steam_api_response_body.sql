-- migrate:up

ALTER TABLE steam_api_requests
	ADD COLUMN response_body jsonb;

CREATE TABLE steam_api_schema_alerts (
	id bigserial PRIMARY KEY,
	method_name text NOT NULL UNIQUE,
	last_notified_at timestamptz NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at
	BEFORE UPDATE ON steam_api_schema_alerts
	FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.maintain_request_logs(
	retain_days integer DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	tbl text;
	d date;
	start_day date;
	end_day date;
	part_name text;
	part_from timestamptz;
	part_to timestamptz;
	drop_name text;
BEGIN
	IF retain_days < 1 THEN
		RAISE EXCEPTION 'retain_days must be >= 1';
	END IF;
	start_day := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - retain_days;
	end_day := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date + 2;
	FOREACH tbl IN ARRAY ARRAY[
		'steam_api_requests',
		'steam_gc_requests',
		'replay_requests'
	]
	LOOP
		d := start_day;
		WHILE d < end_day LOOP
			part_name := tbl || '_' || to_char(d, 'YYYY_MM_DD');
			part_from := (d::text || ' 00:00:00+00')::timestamptz;
			part_to := ((d + 1)::text || ' 00:00:00+00')::timestamptz;
			EXECUTE format(
				'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
				part_name,
				tbl,
				part_from,
				part_to
			);
			d := d + 1;
		END LOOP;
		FOR drop_name IN
			SELECT c.relname
			FROM pg_inherits i
			JOIN pg_class c ON c.oid = i.inhrelid
			JOIN pg_class p ON p.oid = i.inhparent
			WHERE p.relname = tbl
				AND c.relkind = 'r'
				AND c.relname ~ ('^' || tbl || '_[0-9]{4}_[0-9]{2}_[0-9]{2}$')
				AND to_date(
					substring(c.relname FROM '[0-9]{4}_[0-9]{2}_[0-9]{2}$'),
					'YYYY_MM_DD'
				) < start_day
		LOOP
			EXECUTE format('DROP TABLE IF EXISTS %I', drop_name);
		END LOOP;
	END LOOP;
END;
$$;

-- migrate:down

CREATE OR REPLACE FUNCTION public.maintain_request_logs(
	retain_days integer DEFAULT 4
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	tbl text;
	d date;
	start_day date;
	end_day date;
	part_name text;
	part_from timestamptz;
	part_to timestamptz;
	drop_name text;
BEGIN
	IF retain_days < 1 THEN
		RAISE EXCEPTION 'retain_days must be >= 1';
	END IF;
	start_day := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - retain_days;
	end_day := (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date + 2;
	FOREACH tbl IN ARRAY ARRAY[
		'steam_api_requests',
		'steam_gc_requests',
		'replay_requests'
	]
	LOOP
		d := start_day;
		WHILE d < end_day LOOP
			part_name := tbl || '_' || to_char(d, 'YYYY_MM_DD');
			part_from := (d::text || ' 00:00:00+00')::timestamptz;
			part_to := ((d + 1)::text || ' 00:00:00+00')::timestamptz;
			EXECUTE format(
				'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
				part_name,
				tbl,
				part_from,
				part_to
			);
			d := d + 1;
		END LOOP;
		FOR drop_name IN
			SELECT c.relname
			FROM pg_inherits i
			JOIN pg_class c ON c.oid = i.inhrelid
			JOIN pg_class p ON p.oid = i.inhparent
			WHERE p.relname = tbl
				AND c.relkind = 'r'
				AND c.relname ~ ('^' || tbl || '_[0-9]{4}_[0-9]{2}_[0-9]{2}$')
				AND to_date(
					substring(c.relname FROM '[0-9]{4}_[0-9]{2}_[0-9]{2}$'),
					'YYYY_MM_DD'
				) < start_day
		LOOP
			EXECUTE format('DROP TABLE IF EXISTS %I', drop_name);
		END LOOP;
	END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at ON steam_api_schema_alerts;
DROP TABLE IF EXISTS steam_api_schema_alerts;

ALTER TABLE steam_api_requests
	DROP COLUMN IF EXISTS response_body;
