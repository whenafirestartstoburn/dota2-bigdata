# Player / team FKs on match rows

- [x] Spec: nullable `player_id` → `players.id`; `account_id` always kept
- [x] Spec: `team_id` on `match_players` (Valve id → `teams.team_id`)
- [x] Migration: columns, backfill, child FK to `match_players`, indexes
- [x] Writers: look up `player_id` if the player row exists; derive `team_id`
- [x] Parser: copy links onto draft / objectives
- [x] Tests + typecheck

Apply when Postgres is up: `bun run db:up` then `bun run db:pull`.
