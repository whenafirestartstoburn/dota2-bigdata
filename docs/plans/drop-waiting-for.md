# Drop `matches.waiting_for`

- [x] Specs: next stage is `status`; drop the synonym column
- [x] DDL: drop check, index, column
- [x] Stop writing `waiting_for` in store / parser / tests
- [x] `bun run db:up` / `db:pull`
- [x] Drop unused `matches.attempts` and `recordMatchError`
- [x] Restored `matches.attempts` / `next_attempt_at` for seq-details retry
  (`docs/plans/restore-seq-details.md`)

## Why

`waiting_for` is 1:1 with `match_status`. Workers filter `status`.
Terminals (`parsed` / `failed` / `not_started` / `replay_unavailable`)
all store `null`, so the column is weaker than `status`.
