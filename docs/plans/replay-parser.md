# Plan: replay parser

Spec: [`docs/specs/replay-parser.md`](../specs/replay-parser.md).

- [x] Spec: commit protocol, status, parallelism, schema gaps
- [x] Postgres: `parser_parallelism` setting, `match_replays.parse_run_id`
- [x] ClickHouse: `parse_run_id` + action/ping/cosmetic columns
- [x] Go service: claim, S3, own Source 2 extract, CH commit/rollback, PG publish
- [x] docker-compose `parser` + docs / settings
- [x] Tests on the three attached demos
- [x] Patch fixture test (7.39 from attached demos; older Valve CDN files are expired)
- [x] `bun run parser:fetch-patches`: leagues + PG accounts → history → GC URL → testdata
- [x] `TestParseMajorPatches` on fetched fixtures: pass 7.00–7.10, 7.20–7.22, 7.24, 7.27, 7.29–7.31, 7.33–7.39; skip 7.23 / 7.28 / 7.32 (CDN 502)
- [x] Event → CH map (`docs/specs/replay-mapping.md`); `replay_alerts` + interval vitals (`parser_version` 2)
