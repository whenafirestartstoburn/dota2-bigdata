# Live ticks back to ClickHouse

- [x] Specs: CH `live_*_ticks` MergeTree, no `FINAL`, writers leave PG
- [x] DDL: restore CH tables with codecs + `id` for backfill
- [x] Live jobs insert ticks to ClickHouse (after the PG transaction)
- [x] One-time PG → CH drain script (idempotent, parallel)
- [ ] Deploy, then run `scripts/migrate-live-ticks.sh` on `dota2-bigdata`
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

## Run (after deploy)

```bash
ssh olegr@dota2-bigdata
cd /var/www/dota2-bigdata
BATCH=100000 WORKERS=4 ./scripts/migrate-live-ticks.sh
```
