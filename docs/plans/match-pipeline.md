# Plan: match ingest pipeline

Specs: [`docs/specs/worker-architecture.md`](../specs/worker-architecture.md),
[`docs/specs/data-schema.md`](../specs/data-schema.md).

Notion 18.1 / `example_projects/steam-dota-league` are API evidence, not
architecture to copy.

- [x] Specs: phase table, `ingest_sources`, jobs, settings
- [x] Postgres + ClickHouse migrations; `db:pull`; settings knobs
- [x] DB-backed live finish; `poll_finished_history` (5 s / 60 s / 100+100)
- [x] Narrow `walk_league_history`; `fetch_match_details` does seq then GC
- [x] `poll_top_live` + `poll_realtime_stats`
- [x] Parser sets `matches.phase = parsed`
- [x] Tests: finish detection, history backoff, sticky `source`, seq dedupe
- [x] Live listings that never horn (`live_duration_max = 0`) leave as `not_started`, not history polling
