\restrict dbmate

-- Dumped from database version 16.15
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: graphile_worker; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphile_worker;


--
-- Name: job_spec; Type: TYPE; Schema: graphile_worker; Owner: -
--

CREATE TYPE graphile_worker.job_spec AS (
	identifier text,
	payload json,
	queue_name text,
	run_at timestamp with time zone,
	max_attempts smallint,
	job_key text,
	priority smallint,
	flags text[]
);


--
-- Name: account_purchase_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_purchase_kind AS ENUM (
    'api_key',
    'gc'
);


--
-- Name: ingest_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ingest_run_status AS ENUM (
    'queued',
    'running',
    'succeeded',
    'failed'
);


--
-- Name: league_lifecycle; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.league_lifecycle AS ENUM (
    'UPCOMING',
    'LIVE',
    'FINISHED'
);


--
-- Name: marketplace_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.marketplace_order_status AS ENUM (
    'pending',
    'success',
    'failed'
);


--
-- Name: marketplace_store; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.marketplace_store AS ENUM (
    'dark_shopping'
);


--
-- Name: match_phase; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.match_phase AS ENUM (
    'discovered',
    'live',
    'awaiting_details',
    'details_ready',
    'awaiting_replay',
    'replay_stored',
    'replay_unavailable',
    'failed',
    'awaiting_history',
    'parsed',
    'not_started'
);


--
-- Name: match_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.match_source AS ENUM (
    'live',
    'historical'
);


--
-- Name: proxy_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.proxy_kind AS ENUM (
    'http',
    'socks5'
);


--
-- Name: proxy_purpose; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.proxy_purpose AS ENUM (
    'api',
    'gc',
    'both'
);


--
-- Name: replay_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.replay_priority AS ENUM (
    'live',
    'historical'
);


--
-- Name: replay_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.replay_status AS ENUM (
    'pending',
    'awaiting_gc',
    'downloading',
    'stored',
    'parsing',
    'parsed',
    'unavailable',
    'failed'
);


--
-- Name: resource_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resource_kind AS ENUM (
    'proxy',
    'gc_account',
    'api_key'
);


--
-- Name: resource_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.resource_status AS ENUM (
    'ready',
    'active',
    'rate_limited',
    'disabled'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _private_jobs; Type: TABLE; Schema: graphile_worker; Owner: -
--

CREATE TABLE graphile_worker._private_jobs (
    id bigint NOT NULL,
    job_queue_id integer,
    task_id integer NOT NULL,
    payload json DEFAULT '{}'::json NOT NULL,
    priority smallint DEFAULT 0 NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts smallint DEFAULT 0 NOT NULL,
    max_attempts smallint DEFAULT 25 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    key text,
    locked_at timestamp with time zone,
    locked_by text,
    revision integer DEFAULT 0 NOT NULL,
    flags jsonb,
    is_available boolean GENERATED ALWAYS AS (((locked_at IS NULL) AND (attempts < max_attempts))) STORED NOT NULL,
    CONSTRAINT jobs_key_check CHECK (((length(key) > 0) AND (length(key) <= 512))),
    CONSTRAINT jobs_max_attempts_check CHECK ((max_attempts >= 1))
);


--
-- Name: add_job(text, json, text, timestamp with time zone, integer, text, integer, text[], text); Type: FUNCTION; Schema: graphile_worker; Owner: -
--

CREATE FUNCTION graphile_worker.add_job(identifier text, payload json DEFAULT NULL::json, queue_name text DEFAULT NULL::text, run_at timestamp with time zone DEFAULT NULL::timestamp with time zone, max_attempts integer DEFAULT NULL::integer, job_key text DEFAULT NULL::text, priority integer DEFAULT NULL::integer, flags text[] DEFAULT NULL::text[], job_key_mode text DEFAULT 'replace'::text) RETURNS graphile_worker._private_jobs
    LANGUAGE plpgsql
    AS $$
declare
  v_job "graphile_worker"._private_jobs;
begin
  if (job_key is null or job_key_mode is null or job_key_mode in ('replace', 'preserve_run_at')) then
    select * into v_job
    from "graphile_worker".add_jobs(
      ARRAY[(
        identifier,
        payload,
        queue_name,
        run_at,
        max_attempts::smallint,
        job_key,
        priority::smallint,
        flags
      )::"graphile_worker".job_spec],
      (job_key_mode = 'preserve_run_at')
    )
    limit 1;
    return v_job;
  elsif job_key_mode = 'unsafe_dedupe' then
    -- Ensure all the tasks exist
    insert into "graphile_worker"._private_tasks as tasks (identifier)
    values (add_job.identifier)
    on conflict do nothing;
    -- Ensure all the queues exist
    if add_job.queue_name is not null then
      insert into "graphile_worker"._private_job_queues as job_queues (queue_name)
      values (add_job.queue_name)
      on conflict do nothing;
    end if;
    -- Insert job, but if one already exists then do nothing, even if the
    -- existing job has already started (and thus represents an out-of-date
    -- world state). This is dangerous because it means that whatever state
    -- change triggered this add_job may not be acted upon (since it happened
    -- after the existing job started executing, but no further job is being
    -- scheduled), but it is useful in very rare circumstances for
    -- de-duplication. If in doubt, DO NOT USE THIS.
    insert into "graphile_worker"._private_jobs as jobs (
      job_queue_id,
      task_id,
      payload,
      run_at,
      max_attempts,
      key,
      priority,
      flags
    )
      select
        job_queues.id,
        tasks.id,
        coalesce(add_job.payload, '{}'::json),
        coalesce(add_job.run_at, now()),
        coalesce(add_job.max_attempts::smallint, 25::smallint),
        add_job.job_key,
        coalesce(add_job.priority::smallint, 0::smallint),
        (
          select jsonb_object_agg(flag, true)
          from unnest(add_job.flags) as item(flag)
        )
      from "graphile_worker"._private_tasks as tasks
      left join "graphile_worker"._private_job_queues as job_queues
      on job_queues.queue_name = add_job.queue_name
      where tasks.identifier = add_job.identifier
    on conflict (key)
      -- Bump the updated_at so that there's something to return
      do update set
        revision = jobs.revision + 1,
        updated_at = now()
      returning *
      into v_job;
    if v_job.revision = 0 then
      perform pg_notify('jobs:insert', '{"r":' || random()::text || ',"count":1}');
    end if;
    return v_job;
  else
    raise exception 'Invalid job_key_mode value, expected ''replace'', ''preserve_run_at'' or ''unsafe_dedupe''.' using errcode = 'GWBKM';
  end if;
end;
$$;


--
-- Name: add_jobs(graphile_worker.job_spec[], boolean); Type: FUNCTION; Schema: graphile_worker; Owner: -
--

CREATE FUNCTION graphile_worker.add_jobs(specs graphile_worker.job_spec[], job_key_preserve_run_at boolean DEFAULT false) RETURNS SETOF graphile_worker._private_jobs
    LANGUAGE plpgsql
    AS $$
begin
  -- Ensure all the tasks exist
  insert into "graphile_worker"._private_tasks as tasks (identifier)
  select distinct spec.identifier
  from unnest(specs) spec
  on conflict do nothing;
  -- Ensure all the queues exist
  insert into "graphile_worker"._private_job_queues as job_queues (queue_name)
  select distinct spec.queue_name
  from unnest(specs) spec
  where spec.queue_name is not null
  on conflict do nothing;
  -- Ensure any locked jobs have their key cleared - in the case of locked
  -- existing job create a new job instead as it must have already started
  -- executing (i.e. it's world state is out of date, and the fact add_job
  -- has been called again implies there's new information that needs to be
  -- acted upon).
  update "graphile_worker"._private_jobs as jobs
  set
    key = null,
    attempts = jobs.max_attempts,
    updated_at = now()
  from unnest(specs) spec
  where spec.job_key is not null
  and jobs.key = spec.job_key
  and is_available is not true;

  -- WARNING: this count is not 100% accurate; 'on conflict' clause will cause it to be an overestimate
  perform pg_notify('jobs:insert', '{"r":' || random()::text || ',"count":' || array_length(specs, 1)::text || '}');

  -- TODO: is there a risk that a conflict could occur depending on the
  -- isolation level?
  return query insert into "graphile_worker"._private_jobs as jobs (
    job_queue_id,
    task_id,
    payload,
    run_at,
    max_attempts,
    key,
    priority,
    flags
  )
    select
      job_queues.id,
      tasks.id,
      coalesce(spec.payload, '{}'::json),
      coalesce(spec.run_at, now()),
      coalesce(spec.max_attempts, 25),
      spec.job_key,
      coalesce(spec.priority, 0),
      (
        select jsonb_object_agg(flag, true)
        from unnest(spec.flags) as item(flag)
      )
    from unnest(specs) spec
    inner join "graphile_worker"._private_tasks as tasks
    on tasks.identifier = spec.identifier
    left join "graphile_worker"._private_job_queues as job_queues
    on job_queues.queue_name = spec.queue_name
  on conflict (key) do update set
    job_queue_id = excluded.job_queue_id,
    task_id = excluded.task_id,
    payload =
      case
      when json_typeof(jobs.payload) = 'array' and json_typeof(excluded.payload) = 'array' then
        (jobs.payload::jsonb || excluded.payload::jsonb)::json
      else
        excluded.payload
      end,
    max_attempts = excluded.max_attempts,
    run_at = (case
      when job_key_preserve_run_at is true and jobs.attempts = 0 then jobs.run_at
      else excluded.run_at
    end),
    priority = excluded.priority,
    revision = jobs.revision + 1,
    flags = excluded.flags,
    -- always reset error/retry state
    attempts = 0,
    last_error = null,
    updated_at = now()
  where jobs.locked_at is null
  returning *;
end;
$$;


--
-- Name: complete_jobs(bigint[]); Type: FUNCTION; Schema: graphile_worker; Owner: -
--

CREATE FUNCTION graphile_worker.complete_jobs(job_ids bigint[]) RETURNS SETOF graphile_worker._private_jobs
    LANGUAGE sql
    AS $$
  delete from "graphile_worker"._private_jobs as jobs
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < now() - interval '4 hours'
    )
    returning *;
$$;


--
-- Name: force_unlock_workers(text[]); Type: FUNCTION; Schema: graphile_worker; Owner: -
--

CREATE FUNCTION graphile_worker.force_unlock_workers(worker_ids text[]) RETURNS void
    LANGUAGE sql
    AS $$
update "graphile_worker"._private_jobs as jobs
set locked_at = null, locked_by = null
where locked_by = any(worker_ids);
update "graphile_worker"._private_job_queues as job_queues
set locked_at = null, locked_by = null
where locked_by = any(worker_ids);
$$;


--
-- Name: permanently_fail_jobs(bigint[], text); Type: FUNCTION; Schema: graphile_worker; Owner: -
--

CREATE FUNCTION graphile_worker.permanently_fail_jobs(job_ids bigint[], error_message text DEFAULT NULL::text) RETURNS SETOF graphile_worker._private_jobs
    LANGUAGE sql
    AS $$
  update "graphile_worker"._private_jobs as jobs
    set
      last_error = coalesce(error_message, 'Manually marked as failed'),
      attempts = max_attempts,
      updated_at = now()
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$;


--
-- Name: remove_job(text); Type: FUNCTION; Schema: graphile_worker; Owner: -
--

CREATE FUNCTION graphile_worker.remove_job(job_key text) RETURNS graphile_worker._private_jobs
    LANGUAGE plpgsql STRICT
    AS $$
declare
  v_job "graphile_worker"._private_jobs;
begin
  -- Delete job if not locked
  delete from "graphile_worker"._private_jobs as jobs
    where key = job_key
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
  returning * into v_job;
  if not (v_job is null) then
    perform pg_notify('jobs:insert', '{"r":' || random()::text || ',"count":-1}');
    return v_job;
  end if;
  -- Otherwise prevent job from retrying, and clear the key
  update "graphile_worker"._private_jobs as jobs
  set
    key = null,
    attempts = jobs.max_attempts,
    updated_at = now()
  where key = job_key
  returning * into v_job;
  return v_job;
end;
$$;


--
-- Name: reschedule_jobs(bigint[], timestamp with time zone, integer, integer, integer); Type: FUNCTION; Schema: graphile_worker; Owner: -
--

CREATE FUNCTION graphile_worker.reschedule_jobs(job_ids bigint[], run_at timestamp with time zone DEFAULT NULL::timestamp with time zone, priority integer DEFAULT NULL::integer, attempts integer DEFAULT NULL::integer, max_attempts integer DEFAULT NULL::integer) RETURNS SETOF graphile_worker._private_jobs
    LANGUAGE sql
    AS $$
  update "graphile_worker"._private_jobs as jobs
    set
      run_at = coalesce(reschedule_jobs.run_at, jobs.run_at),
      priority = coalesce(reschedule_jobs.priority::smallint, jobs.priority),
      attempts = coalesce(reschedule_jobs.attempts::smallint, jobs.attempts),
      max_attempts = coalesce(reschedule_jobs.max_attempts::smallint, jobs.max_attempts),
      updated_at = now()
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	NEW.created_at = OLD.created_at;
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;


--
-- Name: _private_job_queues; Type: TABLE; Schema: graphile_worker; Owner: -
--

CREATE TABLE graphile_worker._private_job_queues (
    id integer NOT NULL,
    queue_name text NOT NULL,
    locked_at timestamp with time zone,
    locked_by text,
    is_available boolean GENERATED ALWAYS AS ((locked_at IS NULL)) STORED NOT NULL,
    CONSTRAINT job_queues_queue_name_check CHECK ((length(queue_name) <= 128))
);


--
-- Name: _private_known_crontabs; Type: TABLE; Schema: graphile_worker; Owner: -
--

CREATE TABLE graphile_worker._private_known_crontabs (
    identifier text NOT NULL,
    known_since timestamp with time zone NOT NULL,
    last_execution timestamp with time zone
);


--
-- Name: _private_tasks; Type: TABLE; Schema: graphile_worker; Owner: -
--

CREATE TABLE graphile_worker._private_tasks (
    id integer NOT NULL,
    identifier text NOT NULL,
    CONSTRAINT tasks_identifier_check CHECK ((length(identifier) <= 128))
);


--
-- Name: job_queues_id_seq; Type: SEQUENCE; Schema: graphile_worker; Owner: -
--

ALTER TABLE graphile_worker._private_job_queues ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME graphile_worker.job_queues_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: jobs; Type: VIEW; Schema: graphile_worker; Owner: -
--

CREATE VIEW graphile_worker.jobs AS
 SELECT jobs.id,
    job_queues.queue_name,
    tasks.identifier AS task_identifier,
    jobs.priority,
    jobs.run_at,
    jobs.attempts,
    jobs.max_attempts,
    jobs.last_error,
    jobs.created_at,
    jobs.updated_at,
    jobs.key,
    jobs.locked_at,
    jobs.locked_by,
    jobs.revision,
    jobs.flags
   FROM ((graphile_worker._private_jobs jobs
     JOIN graphile_worker._private_tasks tasks ON ((tasks.id = jobs.task_id)))
     LEFT JOIN graphile_worker._private_job_queues job_queues ON ((job_queues.id = jobs.job_queue_id)));


--
-- Name: jobs_id_seq1; Type: SEQUENCE; Schema: graphile_worker; Owner: -
--

ALTER TABLE graphile_worker._private_jobs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME graphile_worker.jobs_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: migrations; Type: TABLE; Schema: graphile_worker; Owner: -
--

CREATE TABLE graphile_worker.migrations (
    id integer NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    breaking boolean DEFAULT false NOT NULL
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: graphile_worker; Owner: -
--

ALTER TABLE graphile_worker._private_tasks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME graphile_worker.tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: abilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abilities (
    ability_id integer NOT NULL,
    name text NOT NULL,
    localized_name text DEFAULT ''::text NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL,
    CONSTRAINT abilities_kind_check CHECK ((kind = ANY (ARRAY['spell'::text, 'talent'::text, 'innate'::text, 'item'::text, 'other'::text])))
);


--
-- Name: abilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.abilities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: abilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.abilities_id_seq OWNED BY public.abilities.id;


--
-- Name: clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clusters (
    cluster integer NOT NULL,
    region integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: clusters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clusters_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clusters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clusters_id_seq OWNED BY public.clusters.id;


--
-- Name: game_modes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_modes (
    game_mode integer NOT NULL,
    name text NOT NULL,
    balanced boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: game_modes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_modes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_modes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_modes_id_seq OWNED BY public.game_modes.id;


--
-- Name: hero_abilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hero_abilities (
    hero_id integer NOT NULL,
    ability_id integer NOT NULL,
    slot integer NOT NULL,
    is_talent boolean DEFAULT false NOT NULL,
    talent_level integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: hero_abilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hero_abilities_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hero_abilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hero_abilities_id_seq OWNED BY public.hero_abilities.id;


--
-- Name: hero_facets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hero_facets (
    hero_id integer NOT NULL,
    facet_id integer NOT NULL,
    name text NOT NULL,
    localized_name text DEFAULT ''::text NOT NULL,
    icon text,
    color text,
    deprecated boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: hero_facets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hero_facets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hero_facets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hero_facets_id_seq OWNED BY public.hero_facets.id;


--
-- Name: heroes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heroes (
    hero_id integer NOT NULL,
    name text NOT NULL,
    localized_name text DEFAULT ''::text NOT NULL,
    primary_attr text,
    attack_type text,
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: heroes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.heroes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: heroes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.heroes_id_seq OWNED BY public.heroes.id;


--
-- Name: ingest_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingest_cursors (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: ingest_cursors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ingest_cursors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ingest_cursors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ingest_cursors_id_seq OWNED BY public.ingest_cursors.id;


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    item_id integer NOT NULL,
    name text NOT NULL,
    localized_name text DEFAULT ''::text NOT NULL,
    cost integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.items_id_seq OWNED BY public.items.id;


--
-- Name: league_ingest_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.league_ingest_runs (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    league_id integer NOT NULL,
    matches_limit integer,
    status public.ingest_run_status DEFAULT 'queued'::public.ingest_run_status NOT NULL,
    matches_listed integer DEFAULT 0 NOT NULL,
    matches_detailed integer DEFAULT 0 NOT NULL,
    replays_enqueued integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: league_ingest_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.league_ingest_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: league_ingest_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.league_ingest_runs_id_seq OWNED BY public.league_ingest_runs.id;


--
-- Name: leagues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leagues (
    league_id integer NOT NULL,
    name text NOT NULL,
    tier integer DEFAULT 0 NOT NULL,
    region integer DEFAULT 0 NOT NULL,
    total_prize_pool bigint DEFAULT 0 NOT NULL,
    start_timestamp bigint DEFAULT 0 NOT NULL,
    end_timestamp bigint DEFAULT 0 NOT NULL,
    most_recent_activity bigint DEFAULT 0 NOT NULL,
    valve_status integer DEFAULT 0 NOT NULL,
    status public.league_lifecycle NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_match_seq_num bigint,
    history_head_match_id bigint,
    history_tail_match_id bigint,
    history_exhausted boolean DEFAULT false NOT NULL,
    history_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: leagues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.leagues_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: leagues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.leagues_id_seq OWNED BY public.leagues.id;


--
-- Name: lobby_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lobby_types (
    lobby_type integer NOT NULL,
    name text NOT NULL,
    balanced boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: lobby_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lobby_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lobby_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lobby_types_id_seq OWNED BY public.lobby_types.id;


--
-- Name: marketplace_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_orders (
    order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    store public.marketplace_store NOT NULL,
    kind public.account_purchase_kind NOT NULL,
    product_id integer NOT NULL,
    status public.marketplace_order_status DEFAULT 'pending'::public.marketplace_order_status NOT NULL,
    idempotence_id text NOT NULL,
    external_order_id text,
    steam_account_id bigint,
    test_on_match_id bigint,
    error_message text,
    test_result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    id bigint NOT NULL
);


--
-- Name: marketplace_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketplace_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketplace_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketplace_orders_id_seq OWNED BY public.marketplace_orders.id;


--
-- Name: marketplace_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_products (
    id bigint NOT NULL,
    store public.marketplace_store NOT NULL,
    kind public.account_purchase_kind NOT NULL,
    product_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketplace_products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketplace_products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketplace_products_id_seq OWNED BY public.marketplace_products.id;


--
-- Name: match_broadcasters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_broadcasters (
    match_id bigint NOT NULL,
    seq integer NOT NULL,
    country_code text,
    description text,
    language_code text,
    account_id bigint,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_broadcasters_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_broadcasters_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_broadcasters_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_broadcasters_id_seq OWNED BY public.match_broadcasters.id;


--
-- Name: match_coaches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_coaches (
    match_id bigint NOT NULL,
    account_id bigint NOT NULL,
    coach_name text,
    coach_rating integer,
    coach_team integer,
    coach_party_id bigint,
    is_private_coach boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_coaches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_coaches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_coaches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_coaches_id_seq OWNED BY public.match_coaches.id;


--
-- Name: match_draft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_draft (
    match_id bigint NOT NULL,
    ord integer NOT NULL,
    is_pick boolean NOT NULL,
    hero_id integer NOT NULL,
    team smallint NOT NULL,
    player_slot integer,
    clock integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_draft_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_draft_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_draft_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_draft_id_seq OWNED BY public.match_draft.id;


--
-- Name: match_objectives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_objectives (
    match_id bigint NOT NULL,
    seq integer NOT NULL,
    "time" integer NOT NULL,
    kind text NOT NULL,
    team smallint,
    slot integer,
    key text,
    value integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_objectives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_objectives_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_objectives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_objectives_id_seq OWNED BY public.match_objectives.id;


--
-- Name: match_player_ability_upgrades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_player_ability_upgrades (
    match_id bigint NOT NULL,
    player_slot integer NOT NULL,
    seq integer NOT NULL,
    ability_id integer NOT NULL,
    "time" integer,
    level integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_player_ability_upgrades_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_player_ability_upgrades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_player_ability_upgrades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_player_ability_upgrades_id_seq OWNED BY public.match_player_ability_upgrades.id;


--
-- Name: match_player_buffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_player_buffs (
    match_id bigint NOT NULL,
    player_slot integer NOT NULL,
    buff_id integer NOT NULL,
    stacks integer DEFAULT 1 NOT NULL,
    grant_time integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_player_buffs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_player_buffs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_player_buffs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_player_buffs_id_seq OWNED BY public.match_player_buffs.id;


--
-- Name: match_player_damage_breakdown; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_player_damage_breakdown (
    match_id bigint NOT NULL,
    player_slot integer NOT NULL,
    direction text NOT NULL,
    damage_type integer NOT NULL,
    pre_reduction integer,
    post_reduction integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_player_damage_breakdown_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_player_damage_breakdown_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_player_damage_breakdown_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_player_damage_breakdown_id_seq OWNED BY public.match_player_damage_breakdown.id;


--
-- Name: match_player_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_player_units (
    match_id bigint NOT NULL,
    player_slot integer NOT NULL,
    unit_name text NOT NULL,
    item_0 integer,
    item_1 integer,
    item_2 integer,
    item_3 integer,
    item_4 integer,
    item_5 integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_player_units_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_player_units_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_player_units_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_player_units_id_seq OWNED BY public.match_player_units.id;


--
-- Name: match_players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_players (
    match_id bigint NOT NULL,
    account_id bigint NOT NULL,
    player_slot integer NOT NULL,
    hero_id integer DEFAULT 0 NOT NULL,
    player_name text,
    team_number integer,
    team_slot integer,
    side text,
    kills integer,
    deaths integer,
    assists integer,
    last_hits integer,
    denies integer,
    gold integer,
    level integer,
    gold_per_min integer,
    xp_per_min integer,
    net_worth integer,
    hero_variant integer,
    gold_spent integer,
    hero_damage integer,
    tower_damage integer,
    hero_healing integer,
    scaled_hero_damage integer,
    scaled_tower_damage integer,
    scaled_hero_healing integer,
    item_0 integer,
    item_1 integer,
    item_2 integer,
    item_3 integer,
    item_4 integer,
    item_5 integer,
    item_neutral integer,
    backpack_0 integer,
    backpack_1 integer,
    backpack_2 integer,
    backpack_3 integer,
    ability_upgrades integer[],
    leaver_status integer,
    party_id bigint,
    party_size integer,
    lane integer,
    lane_role integer,
    is_roaming boolean,
    stuns real,
    teamfight_participation real,
    towers_killed integer,
    roshans_killed integer,
    observers_placed integer,
    sentries_placed integer,
    camps_stacked integer,
    creeps_stacked integer,
    rune_pickups integer,
    firstblood_claimed integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    item_neutral2 integer,
    item_6 integer,
    item_7 integer,
    item_8 integer,
    item_9 integer,
    item_10 integer,
    item_10_lvl integer,
    selected_facet integer,
    aghanims_scepter integer,
    aghanims_shard integer,
    moonshard integer,
    claimed_farm_gold integer,
    support_gold integer,
    claimed_denies integer,
    claimed_misses integer,
    misses integer,
    support_ability_value integer,
    scaled_kills real,
    scaled_deaths real,
    scaled_assists real,
    hero_pick_order integer,
    hero_was_randomed boolean,
    seconds_dead integer,
    gold_lost_to_death integer,
    lane_selection_flags integer,
    bounty_runes integer,
    outposts_captured integer,
    disable_duration integer,
    pro_name text,
    real_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: match_players_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_players_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_players_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_players_id_seq OWNED BY public.match_players.id;


--
-- Name: match_replays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_replays (
    match_id bigint NOT NULL,
    status public.replay_status DEFAULT 'pending'::public.replay_status NOT NULL,
    priority public.replay_priority DEFAULT 'historical'::public.replay_priority NOT NULL,
    cluster integer,
    replay_salt bigint,
    replay_state integer,
    source_url text,
    s3_bucket text,
    s3_key text,
    bytes bigint,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    last_error_at timestamp with time zone,
    next_attempt_at timestamp with time zone,
    steam_account_id bigint,
    proxy_id bigint,
    parser_version integer,
    parsed_at timestamp with time zone,
    stored_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL,
    parse_run_id bigint
);


--
-- Name: match_replays_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.match_replays_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: match_replays_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.match_replays_id_seq OWNED BY public.match_replays.id;


--
-- Name: matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matches (
    match_id bigint NOT NULL,
    league_id integer,
    match_seq_num bigint,
    start_time bigint,
    duration integer,
    pre_game_duration integer,
    radiant_win boolean,
    lobby_type integer,
    game_mode integer,
    cluster integer,
    replay_salt bigint,
    series_id bigint,
    series_type integer,
    radiant_series_wins integer,
    dire_series_wins integer,
    radiant_team_id integer,
    dire_team_id integer,
    league_node_id integer,
    stream_delay_s integer,
    phase public.match_phase DEFAULT 'discovered'::public.match_phase NOT NULL,
    source public.match_source DEFAULT 'historical'::public.match_source NOT NULL,
    live_seen_at timestamp with time zone,
    live_disappeared_at timestamp with time zone,
    live_disappeared_count integer DEFAULT 0 NOT NULL,
    details_fetched_at timestamp with time zone,
    finished_at timestamp with time zone,
    replay_available_at timestamp with time zone,
    radiant_score integer,
    dire_score integer,
    tower_status_radiant integer,
    tower_status_dire integer,
    barracks_status_radiant integer,
    barracks_status_dire integer,
    first_blood_time integer,
    engine integer,
    human_players integer,
    radiant_team_name text,
    dire_team_name text,
    radiant_team_complete smallint,
    dire_team_complete smallint,
    radiant_captain bigint,
    dire_captain bigint,
    positive_votes integer,
    negative_votes integer,
    patch text,
    last_error text,
    last_error_at timestamp with time zone,
    last_api_key_id bigint,
    last_steam_account_id bigint,
    last_proxy_id bigint,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lobby_id bigint,
    match_flags integer,
    match_outcome integer,
    game_balance real,
    radiant_team_logo bigint,
    dire_team_logo bigint,
    radiant_team_logo_url text,
    dire_team_logo_url text,
    radiant_team_tag text,
    dire_team_tag text,
    radiant_guild_id integer,
    dire_guild_id integer,
    tournament_id integer,
    tournament_round integer,
    league_series_id integer,
    league_game_id integer,
    game_number integer,
    stage_name text,
    league_tier integer,
    id bigint NOT NULL,
    ingest_sources text[] DEFAULT '{}'::text[] NOT NULL,
    waiting_for text,
    last_error_kind text,
    server_steam_id bigint,
    live_league_missed_polls integer DEFAULT 0 NOT NULL,
    top_live_missed_polls integer DEFAULT 0 NOT NULL,
    history_poll_fast_count integer DEFAULT 0 NOT NULL,
    history_poll_slow_count integer DEFAULT 0 NOT NULL,
    history_last_polled_at timestamp with time zone,
    history_next_poll_at timestamp with time zone,
    seq_fetched_at timestamp with time zone,
    last_realtime_at timestamp with time zone,
    live_duration_max real DEFAULT 0 NOT NULL,
    CONSTRAINT matches_last_error_kind_check CHECK (((last_error_kind IS NULL) OR (last_error_kind = ANY (ARRAY['network'::text, 'rate_limit'::text, 'auth'::text, 'not_ready'::text, 'unavailable'::text, 'history_timeout'::text, 'not_started'::text, 'other'::text])))),
    CONSTRAINT matches_waiting_for_check CHECK (((waiting_for IS NULL) OR (waiting_for = ANY (ARRAY['live_end'::text, 'history'::text, 'seq'::text, 'gc'::text, 'replay'::text, 'parse'::text]))))
);


--
-- Name: matches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.matches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: matches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.matches_id_seq OWNED BY public.matches.id;


--
-- Name: patches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patches (
    patch text NOT NULL,
    released_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: patches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.patches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: patches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.patches_id_seq OWNED BY public.patches.id;


--
-- Name: permanent_buffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permanent_buffs (
    buff_id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: permanent_buffs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.permanent_buffs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: permanent_buffs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.permanent_buffs_id_seq OWNED BY public.permanent_buffs.id;


--
-- Name: players; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.players (
    account_id bigint NOT NULL,
    steam_id text,
    persona_name text,
    is_pro boolean DEFAULT false NOT NULL,
    current_team_id integer,
    last_match_id bigint,
    last_match_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: players_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.players_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: players_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.players_id_seq OWNED BY public.players.id;


--
-- Name: proxies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proxies (
    id bigint NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    kind public.proxy_kind DEFAULT 'http'::public.proxy_kind NOT NULL,
    purpose public.proxy_purpose DEFAULT 'both'::public.proxy_purpose NOT NULL,
    region text,
    supports_udp boolean DEFAULT false NOT NULL,
    status public.resource_status DEFAULT 'ready'::public.resource_status NOT NULL,
    rate_limited_until timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retest_count integer DEFAULT 0 NOT NULL
);


--
-- Name: proxies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proxies_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proxies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proxies_id_seq OWNED BY public.proxies.id;


--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    region integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: regions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.regions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: regions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.regions_id_seq OWNED BY public.regions.id;


--
-- Name: resource_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_attempts (
    id bigint NOT NULL,
    kind public.resource_kind NOT NULL,
    resource_id bigint NOT NULL,
    ok boolean NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resource_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.resource_attempts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: resource_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.resource_attempts_id_seq OWNED BY public.resource_attempts.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: series; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.series (
    series_id bigint NOT NULL,
    league_id integer,
    radiant_team_id integer,
    dire_team_id integer,
    series_type integer DEFAULT 0 NOT NULL,
    radiant_wins integer DEFAULT 0 NOT NULL,
    dire_wins integer DEFAULT 0 NOT NULL,
    first_match_id bigint,
    last_match_id bigint,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: series_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.series_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: series_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.series_id_seq OWNED BY public.series.id;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.settings.id;


--
-- Name: steam_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steam_accounts (
    id bigint NOT NULL,
    login text NOT NULL,
    password text NOT NULL,
    shared_secret text,
    identity_secret text,
    steam_id text,
    proxy_id bigint,
    status public.resource_status DEFAULT 'ready'::public.resource_status NOT NULL,
    rate_limited_until timestamp with time zone,
    last_login_at timestamp with time zone,
    last_error text,
    shared_secret_broken boolean DEFAULT false NOT NULL,
    email text,
    email_password text,
    email_imap_host text,
    refresh_token text,
    refresh_token_expires_at timestamp with time zone,
    machine_auth_token text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retest_count integer DEFAULT 0 NOT NULL
);


--
-- Name: steam_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.steam_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: steam_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.steam_accounts_id_seq OWNED BY public.steam_accounts.id;


--
-- Name: steam_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steam_api_keys (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    api_key text NOT NULL,
    proxy_id bigint,
    status public.resource_status DEFAULT 'ready'::public.resource_status NOT NULL,
    daily_quota integer,
    rate_limited_until timestamp with time zone,
    last_used_at timestamp with time zone,
    last_called_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retest_count integer DEFAULT 0 NOT NULL
);


--
-- Name: steam_api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.steam_api_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: steam_api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.steam_api_keys_id_seq OWNED BY public.steam_api_keys.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    team_id integer NOT NULL,
    name text NOT NULL,
    tag text,
    logo_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: teams_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.teams_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: teams_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.teams_id_seq OWNED BY public.teams.id;


--
-- Name: xp_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.xp_levels (
    level integer NOT NULL,
    xp integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL
);


--
-- Name: xp_levels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.xp_levels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: xp_levels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.xp_levels_id_seq OWNED BY public.xp_levels.id;


--
-- Name: abilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abilities ALTER COLUMN id SET DEFAULT nextval('public.abilities_id_seq'::regclass);


--
-- Name: clusters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clusters ALTER COLUMN id SET DEFAULT nextval('public.clusters_id_seq'::regclass);


--
-- Name: game_modes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_modes ALTER COLUMN id SET DEFAULT nextval('public.game_modes_id_seq'::regclass);


--
-- Name: hero_abilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_abilities ALTER COLUMN id SET DEFAULT nextval('public.hero_abilities_id_seq'::regclass);


--
-- Name: hero_facets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_facets ALTER COLUMN id SET DEFAULT nextval('public.hero_facets_id_seq'::regclass);


--
-- Name: heroes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heroes ALTER COLUMN id SET DEFAULT nextval('public.heroes_id_seq'::regclass);


--
-- Name: ingest_cursors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingest_cursors ALTER COLUMN id SET DEFAULT nextval('public.ingest_cursors_id_seq'::regclass);


--
-- Name: items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items ALTER COLUMN id SET DEFAULT nextval('public.items_id_seq'::regclass);


--
-- Name: league_ingest_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_ingest_runs ALTER COLUMN id SET DEFAULT nextval('public.league_ingest_runs_id_seq'::regclass);


--
-- Name: leagues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues ALTER COLUMN id SET DEFAULT nextval('public.leagues_id_seq'::regclass);


--
-- Name: lobby_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lobby_types ALTER COLUMN id SET DEFAULT nextval('public.lobby_types_id_seq'::regclass);


--
-- Name: marketplace_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders ALTER COLUMN id SET DEFAULT nextval('public.marketplace_orders_id_seq'::regclass);


--
-- Name: marketplace_products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products ALTER COLUMN id SET DEFAULT nextval('public.marketplace_products_id_seq'::regclass);


--
-- Name: match_broadcasters id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_broadcasters ALTER COLUMN id SET DEFAULT nextval('public.match_broadcasters_id_seq'::regclass);


--
-- Name: match_coaches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_coaches ALTER COLUMN id SET DEFAULT nextval('public.match_coaches_id_seq'::regclass);


--
-- Name: match_draft id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_draft ALTER COLUMN id SET DEFAULT nextval('public.match_draft_id_seq'::regclass);


--
-- Name: match_objectives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_objectives ALTER COLUMN id SET DEFAULT nextval('public.match_objectives_id_seq'::regclass);


--
-- Name: match_player_ability_upgrades id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_ability_upgrades ALTER COLUMN id SET DEFAULT nextval('public.match_player_ability_upgrades_id_seq'::regclass);


--
-- Name: match_player_buffs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_buffs ALTER COLUMN id SET DEFAULT nextval('public.match_player_buffs_id_seq'::regclass);


--
-- Name: match_player_damage_breakdown id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_damage_breakdown ALTER COLUMN id SET DEFAULT nextval('public.match_player_damage_breakdown_id_seq'::regclass);


--
-- Name: match_player_units id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_units ALTER COLUMN id SET DEFAULT nextval('public.match_player_units_id_seq'::regclass);


--
-- Name: match_players id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_players ALTER COLUMN id SET DEFAULT nextval('public.match_players_id_seq'::regclass);


--
-- Name: match_replays id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_replays ALTER COLUMN id SET DEFAULT nextval('public.match_replays_id_seq'::regclass);


--
-- Name: matches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches ALTER COLUMN id SET DEFAULT nextval('public.matches_id_seq'::regclass);


--
-- Name: patches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patches ALTER COLUMN id SET DEFAULT nextval('public.patches_id_seq'::regclass);


--
-- Name: permanent_buffs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permanent_buffs ALTER COLUMN id SET DEFAULT nextval('public.permanent_buffs_id_seq'::regclass);


--
-- Name: players id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players ALTER COLUMN id SET DEFAULT nextval('public.players_id_seq'::regclass);


--
-- Name: proxies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxies ALTER COLUMN id SET DEFAULT nextval('public.proxies_id_seq'::regclass);


--
-- Name: regions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions ALTER COLUMN id SET DEFAULT nextval('public.regions_id_seq'::regclass);


--
-- Name: resource_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_attempts ALTER COLUMN id SET DEFAULT nextval('public.resource_attempts_id_seq'::regclass);


--
-- Name: series id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series ALTER COLUMN id SET DEFAULT nextval('public.series_id_seq'::regclass);


--
-- Name: settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: steam_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_accounts ALTER COLUMN id SET DEFAULT nextval('public.steam_accounts_id_seq'::regclass);


--
-- Name: steam_api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_api_keys ALTER COLUMN id SET DEFAULT nextval('public.steam_api_keys_id_seq'::regclass);


--
-- Name: teams id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams ALTER COLUMN id SET DEFAULT nextval('public.teams_id_seq'::regclass);


--
-- Name: xp_levels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_levels ALTER COLUMN id SET DEFAULT nextval('public.xp_levels_id_seq'::regclass);


--
-- Name: _private_job_queues job_queues_pkey1; Type: CONSTRAINT; Schema: graphile_worker; Owner: -
--

ALTER TABLE ONLY graphile_worker._private_job_queues
    ADD CONSTRAINT job_queues_pkey1 PRIMARY KEY (id);


--
-- Name: _private_job_queues job_queues_queue_name_key; Type: CONSTRAINT; Schema: graphile_worker; Owner: -
--

ALTER TABLE ONLY graphile_worker._private_job_queues
    ADD CONSTRAINT job_queues_queue_name_key UNIQUE (queue_name);


--
-- Name: _private_jobs jobs_key_key1; Type: CONSTRAINT; Schema: graphile_worker; Owner: -
--

ALTER TABLE ONLY graphile_worker._private_jobs
    ADD CONSTRAINT jobs_key_key1 UNIQUE (key);


--
-- Name: _private_jobs jobs_pkey1; Type: CONSTRAINT; Schema: graphile_worker; Owner: -
--

ALTER TABLE ONLY graphile_worker._private_jobs
    ADD CONSTRAINT jobs_pkey1 PRIMARY KEY (id);


--
-- Name: _private_known_crontabs known_crontabs_pkey; Type: CONSTRAINT; Schema: graphile_worker; Owner: -
--

ALTER TABLE ONLY graphile_worker._private_known_crontabs
    ADD CONSTRAINT known_crontabs_pkey PRIMARY KEY (identifier);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: graphile_worker; Owner: -
--

ALTER TABLE ONLY graphile_worker.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: _private_tasks tasks_identifier_key; Type: CONSTRAINT; Schema: graphile_worker; Owner: -
--

ALTER TABLE ONLY graphile_worker._private_tasks
    ADD CONSTRAINT tasks_identifier_key UNIQUE (identifier);


--
-- Name: _private_tasks tasks_pkey; Type: CONSTRAINT; Schema: graphile_worker; Owner: -
--

ALTER TABLE ONLY graphile_worker._private_tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: abilities abilities_ability_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abilities
    ADD CONSTRAINT abilities_ability_id_key UNIQUE (ability_id);


--
-- Name: abilities abilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abilities
    ADD CONSTRAINT abilities_pkey PRIMARY KEY (id);


--
-- Name: clusters clusters_cluster_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clusters
    ADD CONSTRAINT clusters_cluster_key UNIQUE (cluster);


--
-- Name: clusters clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clusters
    ADD CONSTRAINT clusters_pkey PRIMARY KEY (id);


--
-- Name: game_modes game_modes_game_mode_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_modes
    ADD CONSTRAINT game_modes_game_mode_key UNIQUE (game_mode);


--
-- Name: game_modes game_modes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_modes
    ADD CONSTRAINT game_modes_pkey PRIMARY KEY (id);


--
-- Name: hero_abilities hero_abilities_hero_id_slot_is_talent_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_abilities
    ADD CONSTRAINT hero_abilities_hero_id_slot_is_talent_key UNIQUE (hero_id, slot, is_talent);


--
-- Name: hero_abilities hero_abilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_abilities
    ADD CONSTRAINT hero_abilities_pkey PRIMARY KEY (id);


--
-- Name: hero_facets hero_facets_hero_id_facet_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_facets
    ADD CONSTRAINT hero_facets_hero_id_facet_id_key UNIQUE (hero_id, facet_id);


--
-- Name: hero_facets hero_facets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_facets
    ADD CONSTRAINT hero_facets_pkey PRIMARY KEY (id);


--
-- Name: heroes heroes_hero_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heroes
    ADD CONSTRAINT heroes_hero_id_key UNIQUE (hero_id);


--
-- Name: heroes heroes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heroes
    ADD CONSTRAINT heroes_pkey PRIMARY KEY (id);


--
-- Name: ingest_cursors ingest_cursors_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingest_cursors
    ADD CONSTRAINT ingest_cursors_key_key UNIQUE (key);


--
-- Name: ingest_cursors ingest_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingest_cursors
    ADD CONSTRAINT ingest_cursors_pkey PRIMARY KEY (id);


--
-- Name: items items_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_item_id_key UNIQUE (item_id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: league_ingest_runs league_ingest_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_ingest_runs
    ADD CONSTRAINT league_ingest_runs_pkey PRIMARY KEY (id);


--
-- Name: league_ingest_runs league_ingest_runs_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.league_ingest_runs
    ADD CONSTRAINT league_ingest_runs_run_id_key UNIQUE (run_id);


--
-- Name: leagues leagues_league_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_league_id_key UNIQUE (league_id);


--
-- Name: leagues leagues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leagues
    ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);


--
-- Name: lobby_types lobby_types_lobby_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lobby_types
    ADD CONSTRAINT lobby_types_lobby_type_key UNIQUE (lobby_type);


--
-- Name: lobby_types lobby_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lobby_types
    ADD CONSTRAINT lobby_types_pkey PRIMARY KEY (id);


--
-- Name: marketplace_orders marketplace_orders_idempotence_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_idempotence_id_key UNIQUE (idempotence_id);


--
-- Name: marketplace_orders marketplace_orders_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_order_id_key UNIQUE (order_id);


--
-- Name: marketplace_orders marketplace_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_pkey PRIMARY KEY (id);


--
-- Name: marketplace_products marketplace_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_pkey PRIMARY KEY (id);


--
-- Name: marketplace_products marketplace_products_store_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_store_kind_key UNIQUE (store, kind);


--
-- Name: marketplace_products marketplace_products_store_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_products
    ADD CONSTRAINT marketplace_products_store_product_id_key UNIQUE (store, product_id);


--
-- Name: match_broadcasters match_broadcasters_match_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_broadcasters
    ADD CONSTRAINT match_broadcasters_match_id_seq_key UNIQUE (match_id, seq);


--
-- Name: match_broadcasters match_broadcasters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_broadcasters
    ADD CONSTRAINT match_broadcasters_pkey PRIMARY KEY (id);


--
-- Name: match_coaches match_coaches_match_id_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_coaches
    ADD CONSTRAINT match_coaches_match_id_account_id_key UNIQUE (match_id, account_id);


--
-- Name: match_coaches match_coaches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_coaches
    ADD CONSTRAINT match_coaches_pkey PRIMARY KEY (id);


--
-- Name: match_draft match_draft_match_id_ord_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_draft
    ADD CONSTRAINT match_draft_match_id_ord_key UNIQUE (match_id, ord);


--
-- Name: match_draft match_draft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_draft
    ADD CONSTRAINT match_draft_pkey PRIMARY KEY (id);


--
-- Name: match_objectives match_objectives_match_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_objectives
    ADD CONSTRAINT match_objectives_match_id_seq_key UNIQUE (match_id, seq);


--
-- Name: match_objectives match_objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_objectives
    ADD CONSTRAINT match_objectives_pkey PRIMARY KEY (id);


--
-- Name: match_player_ability_upgrades match_player_ability_upgrades_match_slot_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_ability_upgrades
    ADD CONSTRAINT match_player_ability_upgrades_match_slot_seq_key UNIQUE (match_id, player_slot, seq);


--
-- Name: match_player_ability_upgrades match_player_ability_upgrades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_ability_upgrades
    ADD CONSTRAINT match_player_ability_upgrades_pkey PRIMARY KEY (id);


--
-- Name: match_player_buffs match_player_buffs_match_slot_buff_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_buffs
    ADD CONSTRAINT match_player_buffs_match_slot_buff_key UNIQUE (match_id, player_slot, buff_id);


--
-- Name: match_player_buffs match_player_buffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_buffs
    ADD CONSTRAINT match_player_buffs_pkey PRIMARY KEY (id);


--
-- Name: match_player_damage_breakdown match_player_damage_breakdown_natural_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_damage_breakdown
    ADD CONSTRAINT match_player_damage_breakdown_natural_key UNIQUE (match_id, player_slot, direction, damage_type);


--
-- Name: match_player_damage_breakdown match_player_damage_breakdown_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_damage_breakdown
    ADD CONSTRAINT match_player_damage_breakdown_pkey PRIMARY KEY (id);


--
-- Name: match_player_units match_player_units_match_slot_unit_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_units
    ADD CONSTRAINT match_player_units_match_slot_unit_key UNIQUE (match_id, player_slot, unit_name);


--
-- Name: match_player_units match_player_units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_units
    ADD CONSTRAINT match_player_units_pkey PRIMARY KEY (id);


--
-- Name: match_players match_players_match_id_player_slot_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_players
    ADD CONSTRAINT match_players_match_id_player_slot_key UNIQUE (match_id, player_slot);


--
-- Name: match_players match_players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_players
    ADD CONSTRAINT match_players_pkey PRIMARY KEY (id);


--
-- Name: match_replays match_replays_match_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_replays
    ADD CONSTRAINT match_replays_match_id_key UNIQUE (match_id);


--
-- Name: match_replays match_replays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_replays
    ADD CONSTRAINT match_replays_pkey PRIMARY KEY (id);


--
-- Name: matches matches_match_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_match_id_key UNIQUE (match_id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: patches patches_patch_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patches
    ADD CONSTRAINT patches_patch_key UNIQUE (patch);


--
-- Name: patches patches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patches
    ADD CONSTRAINT patches_pkey PRIMARY KEY (id);


--
-- Name: permanent_buffs permanent_buffs_buff_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permanent_buffs
    ADD CONSTRAINT permanent_buffs_buff_id_key UNIQUE (buff_id);


--
-- Name: permanent_buffs permanent_buffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permanent_buffs
    ADD CONSTRAINT permanent_buffs_pkey PRIMARY KEY (id);


--
-- Name: players players_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_account_id_key UNIQUE (account_id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: proxies proxies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxies
    ADD CONSTRAINT proxies_pkey PRIMARY KEY (id);


--
-- Name: proxies proxies_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proxies
    ADD CONSTRAINT proxies_url_key UNIQUE (url);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- Name: regions regions_region_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_region_key UNIQUE (region);


--
-- Name: resource_attempts resource_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_attempts
    ADD CONSTRAINT resource_attempts_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: series series_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_pkey PRIMARY KEY (id);


--
-- Name: series series_series_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_series_id_key UNIQUE (series_id);


--
-- Name: settings settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_key_key UNIQUE (key);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: steam_accounts steam_accounts_login_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_accounts
    ADD CONSTRAINT steam_accounts_login_key UNIQUE (login);


--
-- Name: steam_accounts steam_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_accounts
    ADD CONSTRAINT steam_accounts_pkey PRIMARY KEY (id);


--
-- Name: steam_api_keys steam_api_keys_api_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_api_keys
    ADD CONSTRAINT steam_api_keys_api_key_key UNIQUE (api_key);


--
-- Name: steam_api_keys steam_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_api_keys
    ADD CONSTRAINT steam_api_keys_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: teams teams_team_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_team_id_key UNIQUE (team_id);


--
-- Name: xp_levels xp_levels_level_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_levels
    ADD CONSTRAINT xp_levels_level_key UNIQUE (level);


--
-- Name: xp_levels xp_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_levels
    ADD CONSTRAINT xp_levels_pkey PRIMARY KEY (id);


--
-- Name: jobs_main_index; Type: INDEX; Schema: graphile_worker; Owner: -
--

CREATE INDEX jobs_main_index ON graphile_worker._private_jobs USING btree (priority, run_at) INCLUDE (id, task_id, job_queue_id) WHERE (is_available = true);


--
-- Name: jobs_no_queue_index; Type: INDEX; Schema: graphile_worker; Owner: -
--

CREATE INDEX jobs_no_queue_index ON graphile_worker._private_jobs USING btree (priority, run_at) INCLUDE (id, task_id) WHERE ((is_available = true) AND (job_queue_id IS NULL));


--
-- Name: league_ingest_runs_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX league_ingest_runs_league_idx ON public.league_ingest_runs USING btree (league_id, created_at DESC);


--
-- Name: leagues_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leagues_activity_idx ON public.leagues USING btree (most_recent_activity DESC);


--
-- Name: leagues_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leagues_status_idx ON public.leagues USING btree (status);


--
-- Name: marketplace_orders_store_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX marketplace_orders_store_status_idx ON public.marketplace_orders USING btree (store, status);


--
-- Name: match_replays_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX match_replays_status_idx ON public.match_replays USING btree (status);


--
-- Name: matches_history_poll_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_history_poll_idx ON public.matches USING btree (league_id, history_next_poll_at) WHERE (phase = 'awaiting_history'::public.match_phase);


--
-- Name: matches_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_league_idx ON public.matches USING btree (league_id);


--
-- Name: matches_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_phase_idx ON public.matches USING btree (phase);


--
-- Name: matches_realtime_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_realtime_idx ON public.matches USING btree (last_realtime_at) WHERE ((phase = 'live'::public.match_phase) AND (server_steam_id IS NOT NULL));


--
-- Name: matches_replay_available_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_replay_available_idx ON public.matches USING btree (replay_available_at) WHERE (phase = ANY (ARRAY['details_ready'::public.match_phase, 'awaiting_replay'::public.match_phase]));


--
-- Name: matches_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_seq_idx ON public.matches USING btree (match_seq_num);


--
-- Name: matches_source_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_source_phase_idx ON public.matches USING btree (source, phase);


--
-- Name: matches_start_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matches_start_time_idx ON public.matches USING btree (league_id, start_time DESC);


--
-- Name: resource_attempts_kind_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resource_attempts_kind_id_idx ON public.resource_attempts USING btree (kind, resource_id, id DESC);


--
-- Name: series_league_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX series_league_idx ON public.series USING btree (league_id);


--
-- Name: abilities set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.abilities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: clusters set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.clusters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: game_modes set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.game_modes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hero_abilities set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.hero_abilities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hero_facets set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.hero_facets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: heroes set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.heroes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ingest_cursors set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ingest_cursors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: items set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: league_ingest_runs set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.league_ingest_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: leagues set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.leagues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: lobby_types set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lobby_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: marketplace_orders set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.marketplace_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: marketplace_products set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.marketplace_products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_broadcasters set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_broadcasters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_coaches set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_coaches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_draft set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_draft FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_objectives set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_objectives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_player_ability_upgrades set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_player_ability_upgrades FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_player_buffs set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_player_buffs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_player_damage_breakdown set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_player_damage_breakdown FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_player_units set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_player_units FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_players set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_players FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: match_replays set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.match_replays FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: matches set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: patches set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.patches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: permanent_buffs set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.permanent_buffs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: players set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: proxies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.proxies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: regions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.regions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: resource_attempts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.resource_attempts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: series set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.series FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: settings set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: steam_accounts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.steam_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: steam_api_keys set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.steam_api_keys FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: teams set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: xp_levels set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.xp_levels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: clusters clusters_region_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clusters
    ADD CONSTRAINT clusters_region_fkey FOREIGN KEY (region) REFERENCES public.regions(region) ON DELETE SET NULL;


--
-- Name: hero_abilities hero_abilities_ability_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_abilities
    ADD CONSTRAINT hero_abilities_ability_id_fkey FOREIGN KEY (ability_id) REFERENCES public.abilities(ability_id) ON DELETE CASCADE;


--
-- Name: hero_abilities hero_abilities_hero_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_abilities
    ADD CONSTRAINT hero_abilities_hero_id_fkey FOREIGN KEY (hero_id) REFERENCES public.heroes(hero_id) ON DELETE CASCADE;


--
-- Name: hero_facets hero_facets_hero_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hero_facets
    ADD CONSTRAINT hero_facets_hero_id_fkey FOREIGN KEY (hero_id) REFERENCES public.heroes(hero_id) ON DELETE CASCADE;


--
-- Name: marketplace_orders marketplace_orders_steam_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_steam_account_id_fkey FOREIGN KEY (steam_account_id) REFERENCES public.steam_accounts(id) ON DELETE SET NULL;


--
-- Name: match_broadcasters match_broadcasters_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_broadcasters
    ADD CONSTRAINT match_broadcasters_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_coaches match_coaches_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_coaches
    ADD CONSTRAINT match_coaches_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_draft match_draft_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_draft
    ADD CONSTRAINT match_draft_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_objectives match_objectives_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_objectives
    ADD CONSTRAINT match_objectives_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_player_ability_upgrades match_player_ability_upgrades_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_ability_upgrades
    ADD CONSTRAINT match_player_ability_upgrades_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_player_buffs match_player_buffs_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_buffs
    ADD CONSTRAINT match_player_buffs_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_player_damage_breakdown match_player_damage_breakdown_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_damage_breakdown
    ADD CONSTRAINT match_player_damage_breakdown_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_player_units match_player_units_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_player_units
    ADD CONSTRAINT match_player_units_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_players match_players_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_players
    ADD CONSTRAINT match_players_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_replays match_replays_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_replays
    ADD CONSTRAINT match_replays_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(match_id) ON DELETE CASCADE;


--
-- Name: match_replays match_replays_proxy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_replays
    ADD CONSTRAINT match_replays_proxy_id_fkey FOREIGN KEY (proxy_id) REFERENCES public.proxies(id) ON DELETE SET NULL;


--
-- Name: match_replays match_replays_steam_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_replays
    ADD CONSTRAINT match_replays_steam_account_id_fkey FOREIGN KEY (steam_account_id) REFERENCES public.steam_accounts(id) ON DELETE SET NULL;


--
-- Name: matches matches_dire_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_dire_team_id_fkey FOREIGN KEY (dire_team_id) REFERENCES public.teams(team_id) ON DELETE SET NULL;


--
-- Name: matches matches_last_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_last_api_key_id_fkey FOREIGN KEY (last_api_key_id) REFERENCES public.steam_api_keys(id) ON DELETE SET NULL;


--
-- Name: matches matches_last_proxy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_last_proxy_id_fkey FOREIGN KEY (last_proxy_id) REFERENCES public.proxies(id) ON DELETE SET NULL;


--
-- Name: matches matches_last_steam_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_last_steam_account_id_fkey FOREIGN KEY (last_steam_account_id) REFERENCES public.steam_accounts(id) ON DELETE SET NULL;


--
-- Name: matches matches_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(league_id) ON DELETE SET NULL;


--
-- Name: matches matches_patch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_patch_fkey FOREIGN KEY (patch) REFERENCES public.patches(patch) ON DELETE SET NULL;


--
-- Name: matches matches_radiant_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_radiant_team_id_fkey FOREIGN KEY (radiant_team_id) REFERENCES public.teams(team_id) ON DELETE SET NULL;


--
-- Name: matches matches_series_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.series(series_id) ON DELETE SET NULL;


--
-- Name: players players_current_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_current_team_id_fkey FOREIGN KEY (current_team_id) REFERENCES public.teams(team_id) ON DELETE SET NULL;


--
-- Name: series series_dire_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_dire_team_id_fkey FOREIGN KEY (dire_team_id) REFERENCES public.teams(team_id) ON DELETE SET NULL;


--
-- Name: series series_league_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(league_id) ON DELETE SET NULL;


--
-- Name: series series_radiant_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.series
    ADD CONSTRAINT series_radiant_team_id_fkey FOREIGN KEY (radiant_team_id) REFERENCES public.teams(team_id) ON DELETE SET NULL;


--
-- Name: steam_accounts steam_accounts_proxy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_accounts
    ADD CONSTRAINT steam_accounts_proxy_id_fkey FOREIGN KEY (proxy_id) REFERENCES public.proxies(id) ON DELETE SET NULL;


--
-- Name: steam_api_keys steam_api_keys_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_api_keys
    ADD CONSTRAINT steam_api_keys_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.steam_accounts(id) ON DELETE CASCADE;


--
-- Name: steam_api_keys steam_api_keys_proxy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_api_keys
    ADD CONSTRAINT steam_api_keys_proxy_id_fkey FOREIGN KEY (proxy_id) REFERENCES public.proxies(id) ON DELETE SET NULL;


--
-- Name: _private_job_queues; Type: ROW SECURITY; Schema: graphile_worker; Owner: -
--

ALTER TABLE graphile_worker._private_job_queues ENABLE ROW LEVEL SECURITY;

--
-- Name: _private_jobs; Type: ROW SECURITY; Schema: graphile_worker; Owner: -
--

ALTER TABLE graphile_worker._private_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: _private_known_crontabs; Type: ROW SECURITY; Schema: graphile_worker; Owner: -
--

ALTER TABLE graphile_worker._private_known_crontabs ENABLE ROW LEVEL SECURITY;

--
-- Name: _private_tasks; Type: ROW SECURITY; Schema: graphile_worker; Owner: -
--

ALTER TABLE graphile_worker._private_tasks ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260830000000'),
    ('20260830000001'),
    ('20260903000000'),
    ('20260903200000'),
    ('20260903210000'),
    ('20260903220000'),
    ('20260905220000'),
    ('20260905230000'),
    ('20260906010000'),
    ('20260906010100'),
    ('20260906020000'),
    ('20260906030000'),
    ('20260906104000'),
    ('20260906104100'),
    ('20260906124400');
