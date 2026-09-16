# Plan: archive parsed replays to cold storage

Spec: [`docs/specs/worker-architecture.md`](../specs/worker-architecture.md)
(Replay archive), [`docs/specs/data-schema.md`](../specs/data-schema.md).

- [x] Spec: job, env (bucket / prefix / storage class), `archived_at`
- [x] Postgres: `match_replays.archived_at` + settings knobs; `db:pull`
- [x] Object-store copy/delete (GCS rewrite, S3 stream/write) + dest helpers
- [x] `archive_parsed_replays` on match-processing (startup + self-reschedule)
- [x] Metrics + Grafana; tests for key/dest/settings/roles
- [x] `.env.example`: same bucket, `cold/` prefix (dota2-bigdata)
