# Plan: replay parser

Spec: [`docs/specs/replay-parser.md`](../specs/replay-parser.md).

- [x] Spec: commit protocol, status, parallelism, schema gaps
- [x] Postgres: `parser_parallelism` setting, `match_replays.parse_run_id`
- [x] ClickHouse: `parse_run_id` + action/ping/cosmetic columns
- [x] Go service: claim, S3, manta extract, CH commit/rollback, PG publish
- [x] docker-compose `parser` + docs / settings
- [x] Tests on the three attached demos
- [x] Patch fixture test (7.39 from attached demos; older Valve CDN files are expired)
