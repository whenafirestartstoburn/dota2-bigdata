# Live ticks back to ClickHouse

- [x] Specs: CH `live_*_ticks` MergeTree, no `FINAL`, writers leave PG
- [x] DDL: restore CH tables with codecs + `id` for backfill
- [x] Live jobs insert ticks to ClickHouse (after the PG transaction)
- [x] One-time PG → CH drain script (idempotent, parallel)
- [x] Deploy, drain `live_player_ticks` (2026-09-19; VACUUM hit 64 MiB shm)
- [ ] Re-run script for leftover `live_match_ticks`
- [ ] Later: drop empty PG `live_*_ticks` (separate migration)

## Why

PG `live_player_ticks` is ~3.7 GiB / 1.1×10⁷ rows on `dota2-bigdata`
(2026-09-19); `live_match_ticks` is ~400 MiB / 1.2×10⁶. Insert-only
scoreboard snapshots belong in MergeTree (ADR). Nobody reads these
tables today, so the new CH copies do not change query plans. Future
aggregations go `GROUP BY (match_id, captured_at, …)` without `FINAL`.

## Restart rule

PG is the work queue. Each id range: insert into CH, then `DELETE` that
range from PG. Re-run: if CH already has the range, skip insert and
delete leftover PG rows. A failed insert leaves PG intact.

`psql -A` field separator is `|`. The drain script must use `-F $'\\t'`
or it parses `min|max|count` as one field and skips the table.

## Run (after deploy)

Postgres container `/dev/shm` is 64 MiB by default. `VACUUM ANALYZE`
after the player drain failed there (`No space left on device` on a
67 MiB DSM resize). Host disk was fine. Compose now sets `shm_size:
256mb`. The script skips VACUUM unless `VACUUM=1`.

```bash
ssh olegr@dota2-bigdata
cd /var/www/dota2-bigdata
BATCH=100000 WORKERS=4 ./scripts/migrate-live-ticks.sh
```
