# Worker architecture

Companions: [`data-schema.md`](./data-schema.md), [`adr-technology.md`](./adr-technology.md), [`job-graph.md`](./job-graph.md) (every identifier: calls, status, inserts).

One image (`packages/worker`), three processes, one Postgres, one
ClickHouse, one S3. graphile-worker tables are a **shared** queue: a
process only registers the task identifiers it owns, so a live poll
never runs on the historical container. The 1 rps mutex stays in
Postgres (`SELECT … FOR UPDATE` on `steam_api_keys`), so three
processes cannot double-fire the same key.

`WORKER_ROLE` selects the process: `live`, `historical`,
`match-processing`. Unset / `all` registers every task (local
`bun run worker`). Compose always sets a role.

The HTTP API stays a thin test harness plus admin purchase
(`POST /api/buy-account`,
[`marketplace-buy-account.md`](./marketplace-buy-account.md)).
`match-processing` replenishes API keys / GC accounts from
`marketplace_products` when `settings` say the ready pool is short.
Collection must work if the API is down.

```
                    ┌──────────────────┐
                    │ Steam Web API    │  ≤ 1 rps / key  (PG mutex)
                    └────────┬─────────┘
           ┌─────────────────┼─────────────────┐
           ▼                 ▼                 ▼
   worker-live     worker-historical   worker-match-processing
   live feeds      GetMatchHistory     GC + download
                   + seq-num details
           └─────────────────┼─────────────────┘
                             ▼
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
     Postgres           ClickHouse            S3 .dem.bz2
     (matches, jobs)    (ticks, replay_*)     (download)
```

| Role | Jobs | graphile concurrency |
|---|---|---|
| `live` | `poll_live_games`, `poll_top_live`, `poll_realtime_stats`, `poll_finished_history`, `fetch_seq_details`, `walk_seq_history`, `fetch_seq_window` (+ `run_scheduled_job`) | 8 |
| `historical` | `walk_league_history`, `poll_finished_history`, `fetch_seq_details`, `walk_seq_history`, `fetch_seq_window`, `fetch_leagues`, `process_league`, `sync_catalogs` (+ `run_scheduled_job`) | 4 |
| `match-processing` | `fetch_match_details`, `download_replay`, `archive_parsed_replays`, `maintain_request_logs`, `replenish_accounts`, `settle_marketplace_orders`, `retest_disabled_resources` (+ `run_scheduled_job`) | 35 |

graphile `priority`: lower number runs first. Live poll / live details / live seq / live replay = 0, historical details / seq = 10, history walk / historical replay = 20. `fetch_match_details` uses five named queues (`details:0`…`details:4`, `match_id % 5`) so at most five GC jobs run at once. `fetch_seq_details` uses five `seq:0`…`seq:4` shards so seq and GC for the same match run in parallel. `download_replay` uses ten live and ten historical queues (`replay-live:0`…`replay-live:9`, `replay-historical:0`…`replay-historical:9`, `match_id % 10`). On a free shard, live (priority 0) is picked before historical (priority 10 / 20).

Named queues hold **only immediate work** (graphile `maxAttempts = 1`). A future `runAt` or a thrown retry parks as `run_scheduled_job` with no `queue_name` (`jobKey = later:…`). When that instant comes, the hop enqueues back onto the named shard. Every worker role registers the hop. Delayed hops still count toward `history_details_enqueue_limit` / `history_replay_enqueue_limit`. Graphile must not retry in-place on a named queue — that held the shard after a crash.

Match truth lives on `matches` (status, counters, last error). GC account / proxy that fetched salt live on `match_replays`. graphile-worker tables are the queue, not the pipeline status.

---

## Steam Web API budget

Hard rules:

- **1 request per second per API key**, including retries (`settings.steam_api_min_interval_ms`).
- Never parallelise two Web API calls on the same key.
- Professional matches only. Discovery is `GetMatchHistory` (`league_id`). After a seqnum is known, `GetMatchHistoryBySequenceNum` (`matches_requested = 1`) runs **in parallel** with GC `CMsgDOTAMatch` — the stream seq indexer can expose the match earlier than GC. Replay locator (cluster/salt) still comes from GC.

Live writes `next_live_poll_at`; historical waits past that instant. GC is **not** in the 100k budget.

---

## Jobs

A job does one unit of work, then re-enqueues itself if more remains.
Exact Steam/GC/CDN calls, `matches.status` / `match_replays.status`
transitions, and ClickHouse / catalog inserts:
[`job-graph.md`](./job-graph.md).

| identifier | Cadence | One unit |
|---|---|---|
| `poll_live_games` | every `settings.live_poll_interval_ms` from tick start (seed 1 s); skip if `live_max_concurrent` (seed 5) live ticks are in flight | GetLiveLeagueGames → live ticks + DB finish detection |
| `poll_top_live` | same period and cap | GetTopLiveGame (`league_id > 0`) → `server_steam_id` + finish detection |
| `poll_realtime_stats` | same period and cap | GetRealtimeStats for live rows with `server_steam_id`, paced by the key limiter |
| `poll_finished_history` | every `settings.history_fast_poll_ms` (seed 5 s) | page GetMatchHistory until waiting ids are found or the league is exhausted (max 100 / call) |
| `walk_seq_history` | every `settings.seq_walk_interval_ms` (seed 1 s; 60 s after catching the tip) | claim `settings.seq_walk_cursor` windows up to `seq_walk_parallelism` (seed 2) |
| `fetch_seq_window` | on demand per claimed seqnum | `GetMatchHistoryBySequenceNum` (`matches_requested = seq_batch_size`) for that exact start; upsert `league_id > 0` |
| `fetch_leagues` | hourly + startup | GetLeagueInfoList |
| `walk_league_history` | continuous self-requeue (`steam_api_min_interval_ms`) | one GetMatchHistory page (discovery); enqueue seq + GC |
| `fetch_seq_details` | on demand after a seqnum | `GetMatchHistoryBySequenceNum` for that match; persist box score / captains |
| `fetch_match_details` | on demand | GC `CMsgGCMatchDetailsRequest` → persist `CMsgDOTAMatch` + replay URL |
| `download_replay` | after URL is stored | GET that URL → stream `.dem.bz2` to S3 |
| `archive_parsed_replays` | every `settings.replay_archive_interval_ms` + startup | copy parsed `.dem.bz2` to cold storage, then delete the hot object |
| `maintain_request_logs` | hourly + startup | create UTC daily partitions for `steam_api_requests` / `steam_gc_requests` / `replay_requests` two days ahead; drop partitions older than 3 days |
| `replenish_accounts` | every `settings.replenish_interval_ms` + startup | if ready API keys or dedicated GC accounts (plus pending orders) are below `settings`, buy the gap from the whitelist, one store order per missing unit; Telegram after a stable failed error (3 retries, 10 min cooldown) |
| `settle_marketplace_orders` | every `settings.marketplace_settle_interval_ms` + startup | poll pending `marketplace_orders`; fulfill when Dark Shopping is `completed`/`ok`; fail after `marketplace_pending_ttl_ms` (seed 1 h) if still `in_process`; same Telegram on a stable fail |
| `retest_disabled_resources` | every `settings.retest_interval_ms` + startup | probe disabled proxies / GC accounts / API keys with `retest_count` below the matching `*_retest_max`; restore on success; give up after max |
| `sync_catalogs` | worker boot (sync, before ingest jobs) + hourly | `patchnoteslist` via api proxy; on a new patch (or empty `heroes`) upsert `heroes` / `items` / `abilities` / `patches` from datafeed lists |

### Live (`poll_live_games`)

GetLiveLeagueGames. Upsert live matches/players/draft. Append CH `live_match_ticks` / `live_player_ticks` (`source = GetLiveLeagueGames`) after the Postgres transaction. Add `GetLiveLeagueGames` to `ingest_sources`. Store `live_duration_max` from the scoreboard clock. Finish detection is **in Postgres**: increment `live_league_missed_polls` for `status = live` rows that have this ingest source and are absent from the response; reset to 0 when seen. Empty-list guard: do not increment. A match leaves `live` only when **every feed that listed it** has crossed `settings.live_missing_threshold`. If `live_duration_max > 0` (horn happened): `status = awaiting_history`. If the clock never left 0 (empty lobby / ghost listing): `status = not_started`, `last_error_kind = not_started` — do **not** poll GetMatchHistory. Either live feed can drop a still-running match (Steam glitch) and list it again: a later sighting flaps `not_started`, `awaiting_history`, `awaiting_details`, and `failed` back to `live` (clears `finished_at` / history waiter). GetLiveLeagueGames may only `noteLiveFeedSeen` when the scoreboard hash is unchanged — that path must flap too, because the in-memory hash survives a finish on the other worker. `details_ready` / replay / parse stay put. Walk/history listing still promotes `not_started` to `awaiting_details` if Valve later publishes the id. Finish (`live_duration_max > 0`) enqueues `fetch_match_details` so GC starts without waiting for history, and arms `history_next_poll_at` so the waiter keeps looking for a seqnum even after GC / replay advance status. Does **not** enqueue download.

### Top live (`poll_top_live`)

GetTopLiveGame (`partner=0`). Keep `league_id > 0`. Upsert `server_steam_id` (Steam uint64 as decimal text — `Number` rounds it), `ingest_sources += GetTopLiveGame`, `status = live` unless already past details. A later sighting uses the same flap as GetLiveLeagueGames (`touchMatchLive` always, no hash short-circuit). Fields this feed does **not** have (`series_*`, team names, lobby, logos) are written as SQL NULL so `COALESCE(excluded, matches)` keeps the GetLiveLeagueGames values. Same miss-counter pattern on `top_live_missed_polls`. Same finish rule as the live poller (both feeds must be done if both listed the match).

A match seen in **both** feeds is one `matches` row: `ingest_sources` accumulates both names, GetLiveLeagueGames fills roster / draft / lobby / logos / series, GetTopLiveGame fills `server_steam_id` (which unlocks GetRealtimeStats). Nothing from either feed is dropped.

### Realtime stats (`poll_realtime_stats`)

Whole match, same cadence as live poll. Select `status = live` rows with `server_steam_id`, oldest `last_realtime_at` first. Call GetRealtimeStats through the shared 1 rps limiter until `live_poll_interval_ms` elapses; leftovers wait for the next tick. Upsert PG teams / players / draft / score. Append CH ticks with `source = GetRealtimeStats` (`game_state`, `server_steam_id`, backpack `item6`–`item8`). That blob has no GPM/XPM/ultimate/respawn — those stay `0` on the GetRealtimeStats tick; GetLiveLeagueGames fills them when the scoreboard has them. If the server hosts a pub (`league_id <= 0`), clear `server_steam_id` and stop scanning that id.

### Finished-history waiter (`poll_finished_history`)

Coalesce by **league**: page GetMatchHistory for each due `league_id` (armed `history_next_poll_at`, no `match_seq_num` yet, `history_next_poll_at <= now()`) until every waiting id is found or the league is exhausted. Newest first, `matches_requested = settings.history_page_size` (Valve max 100). Stop paging when remaining ids are newer than the newest listed row (not indexed yet) or older than the last page. Counters apply to every waiting match that this crawl did not hit. Status is **not** the gate — a match whose GC / replay branch already reached `details_ready` / `parsed` stays in the waiter until a seqnum or timeout.

Live finish also enqueues `fetch_match_details` immediately so GC runs in parallel with this waiter.

- Hit: persist listing fields, `ingest_sources += GetMatchHistory`, `match_seq_num`, clear `history_next_poll_at`. Promote only early statuses to `awaiting_details`. Enqueue `fetch_seq_details` and `fetch_match_details` (live priority). Replay delay is **not** applied here.
- Miss: bump `history_poll_fast_count` (limit `settings.history_fast_poll_limit` seed 720, interval `history_fast_poll_ms` — 60 min) then `history_poll_slow_count` (limit `history_slow_poll_limit` seed 180, interval `history_slow_poll_ms` — 3 h). After both limits: clear `history_next_poll_at`. `status = failed` / `last_error_kind = history_timeout` only while the row is still `awaiting_history`.

### Seq-num catch-up (`walk_seq_history` / `fetch_seq_window`)

Safety net for professional matches that never appeared in a live feed.
Does **not** replace the live-disappear waiter. Live + historical both
register the pair (`WORKER_HISTORICAL_REPLICAS` is 0 today). Shared
`jobKey = walk_seq_history`. Priority 20 so live polls win the
graphile slots.

`walk_seq_history` fills in-flight `fetch_seq_window` jobs up to
`settings.seq_walk_parallelism` (seed 2):

1. Read `settings.seq_walk_cursor` (seed `7561931158`).
2. Idempotency: `jobKey = seq_window:{start_at}`. If that key is
   already queued or locked, do not enqueue it again.
3. Claim: enqueue the window, then CAS-advance the cursor by
   `settings.seq_batch_size` (Valve max 100). Updating the cursor
   **only after a successful fetch** would serialize the two workers
   on the same start.
4. Respect `seq_walk_cooldown_until` (set when a window hits the tip).

`fetch_seq_window` retries that exact `start_at`. One
`GetMatchHistoryBySequenceNum` (`matches_requested = seq_batch_size`).

- Success with matches: persist `league_id > 0` via `persistMatchRecord`
  (`fetched: 'seq'`) — same seq blob as `fetch_seq_details`, so do
  **not** enqueue another seq job. Enqueue `fetch_match_details` when
  `details_fetched_at` is still null (origin from `matches.source`).
  Cursor `GREATEST(cursor, highest match_seq_num)` so a late sibling
  cannot rewind a claimed window. Write-only
  `seq_walk_latest_start_time` = highest `start_time` in the response,
  `YYYY-MM-DD HH:MM:SS UTC` (lexicographic `GREATEST` so parallel
  windows keep the later clock). Then try to enqueue the next window
  so parallelism stays full.
- Success with no matches (caught the tip): cursor =
  `max(1, start_at - 2000)`, set `seq_walk_cooldown_until` to now +
  1 minute, do not enqueue more windows.
- Failure: throw; graphile retries the same `seq_window:{start_at}`.

Pubs (`league_id <= 0`) still move the cursor and the write-only
clock — they are the global stream. Real parallelism needs two ready
API keys; one key stays 1 rps.

### Historical discovery (`walk_league_history`)

One GetMatchHistory page (`settings.history_page_size`, newest or older cursor). Persist listed matches (`source` stays `live` if already live; otherwise `historical`). `ingest_sources += GetMatchHistory`. Set `status = awaiting_details` when the row is still `discovered`, `awaiting_history`, or `not_started`. Enqueue `fetch_match_details` for rows still missing `details_fetched_at` (live first, then `leagues.tier` desc, then `start_time` desc), capped by `settings.history_details_enqueue_limit` (runnable jobs only — exhausted retries and jobs waiting on a locked `details:*` queue do not fill the cap). An empty page marks the league `history_exhausted` and the next tick picks another league (never self-requeue the same empty id). After every tick, self-requeue on `jobKey = walk_league_history` at `settings.steam_api_min_interval_ms`; the shared 1 rps limiter still yields to live. Older pages of the current league stay on the payload; otherwise `pickNextHistoryLeague` (`tier` desc, then newest: `most_recent_activity`, `start_timestamp`, `league_id` desc). A 5-minute cron with `preserve_run_at` is only a watchdog. Listed matches with a seqnum enqueue `fetch_seq_details` in parallel with `fetch_match_details`. Does **not** enqueue download.

### Seq-num details (`fetch_seq_details`)

After GetMatchHistory stored `match_seq_num`. Five `seq:{match_id % 5}`
shards, same priority and hop retry as GC (`maxAttempts` 5,
`jobRetryDelayMs`). Stamps `matches.attempts` / `matches.next_attempt_at`.
One `GetMatchHistoryBySequenceNum` with `matches_requested = 1` starting
at that seqnum. Persist via `persistMatchRecord` (`fetched: 'seq'`):
additive fill of box score, draft, backpack, timed
`ability_upgrades`, **captains** (does not overwrite GC / replay /
a prior seq write). `seq_fetched_at`,
`ingest_sources += GetMatchHistoryBySequenceNum`.
Does **not** enqueue download (no replay salt). Skip if `seq_fetched_at`
is already set. Empty window throws (retry). Valve skip inside the
window logs and returns.

### Match details (`fetch_match_details`)

Shared by live-finished and historical matches. At most five run at once
(`details:{match_id % 5}`). Live origin is priority 0 and is picked before
historical (priority 10) on a free shard. Runs **in parallel** with
`fetch_seq_details` (different named queues).

1. GC `CMsgGCMatchDetailsRequest`. Persist `CMsgDOTAMatch` (box score, draft, `item_6..8` as backpack, `match_outcome` → `radiant_win`). Copy cluster/salt, set `match_replays.source_url` and `details_fetched_at`. Result 15 (`EResult.AccessDenied`) is match-level (same session still serves other ids): `match_replays.status = unavailable`, `matches.status = replay_unavailable`, `last_error_kind = unavailable`, job succeeds. Do **not** throw — a retry would hold a `details:{n}` shard.
2. Enqueue `download_replay` unless the `.dem.bz2` is already on hot or cold S3 (or the row is already `parsed` / `parsing`). Live origin: `run_at = replay_available_at` (`finished_at + settings.replay_live_delay_ms`, seed 30 s) if that instant is still in the future. Historical runs immediately. Unpublished cluster 0/1 is marked only after that S3 miss.

`match_seq_num` comes from GetMatchHistory, not GC. Captains are on the seq blob (and replay metadata if seq missed them). Leftover backpack / neutrals / Aghs that both omitted are filled on parse.

### Replay download

Requires `source_url` already on `match_replays` unless the object is
already on hot or cold S3. No GC. Looks up the row locator, then the
hot key, then the cold archive key — a hit is `already_stored`, no
Valve GET. Cluster 0/1 (`replay1.valve.net`) has no Valve CDN host —
mark `unavailable` only after that miss, do not retry. 404 →
`replayBackoffMs` (1 m, 1 m, 3 m × 20, 1 h × 24) then
`match_replays.status = unavailable`, `matches.status = replay_unavailable`,
`last_error_kind = unavailable`. Stops at `stored` in S3; parse is a
later job. Sets `matches.status = replay_stored`. Run cap is ten live
+ ten historical (`REPLAY_PARALLELISM`); historical enqueue is still
`settings.history_replay_enqueue_limit`.

### Replay parse

Separate Go process (`packages/parser`). Polls `match_replays` with `status = stored`, downloads the S3 object, decodes the demo with our Source 2 parser, writes ClickHouse `replay_*` (re-parse deletes the previous `match_id` first), then sets `match_replays.status = parsed` **and** `matches.status = parsed`. Parallelism is `settings.parser_parallelism` (prod `8`). A demo decode keeps only the entity classes the extract reads (heroes,
resource, rules, items, …) and flushes high-volume `replay_*` rows in
batches. Parser cgroup is 3.00 CPU / 8 GiB so that width can run;
0.90 / 4 GiB made anything past ~6 CFS-bound. Spec:
[`replay-parser.md`](./replay-parser.md).

### Replay archive

After parse, the `.dem.bz2` is only a re-parse backup. `archive_parsed_replays`
(match-processing, `jobKey`, priority 30) copies `status = parsed` rows whose
`archived_at` is still null to cold storage, then deletes the hot object.
`matches.status` and `match_replays.status` stay `parsed`. Postgres locator
(`s3_bucket`, `s3_key`) is rewritten to the cold object. Download skips
Valve when the object is already in hot or cold storage: it points the
locator at that object and sets `stored` / `replay_stored` so the parser
claims it, or leaves `parsed` / `parsing` alone. A download that writes a
new hot file clears `archived_at` so the new object is archived again.

Destination is env, not `settings` (bucket names are connection config):

| Variable | Dev (`dota2-bigdata`) | Production |
|---|---|---|
| `S3_ARCHIVE_BUCKET` | empty → same as `S3_BUCKET` | a separate bucket |
| `S3_ARCHIVE_PREFIX` | `cold/` | empty (keep `replays/…` at bucket root) or a folder |
| `S3_ARCHIVE_STORAGE_CLASS` | empty (provider default) | e.g. `STANDARD_IA` / `GLACIER_IR` (S3) or `COLDLINE` / `ARCHIVE` (GCS) |

Optional `S3_ARCHIVE_ENDPOINT` / `S3_ARCHIVE_REGION` / `S3_ARCHIVE_ACCESS_KEY` /
`S3_ARCHIVE_SECRET_KEY` override the hot credentials when the cold bucket is
another account. Empty = reuse `S3_*`. Same-bucket with an empty prefix is
refused (that would delete the only copy). Cadence and batch size are
`settings.replay_archive_interval_ms` (seed 30 s) and
`settings.replay_archive_batch_size` (seed 10). A full batch requeues
immediately so a backlog drains; otherwise the interval applies.

GCS→GCS is a server-side rewrite. Other combinations stream through the
worker one object at a time. Glacier / Archive classes are not readable
until restored — re-parse of a frozen object needs a restore first.

---

## League status

Valve `status` is a publication flag. Our `leagues.status`:

1. `LIVE` if the id appears in GetLiveLeagueGames **or** GetTopLiveGame
2. else `UPCOMING` if `now < start_timestamp`
3. else `FINISHED` if `now > end_timestamp` **or** `valve_status = 5` **or** `most_recent_activity` older than 14 days
4. else `LIVE` only inside `[start, end]`

Historical ingest does not wait for `FINISHED`. A match is live only while a live feed still lists it.

---

## Failure

- Web API 403 → disable that key immediately (no retest). 429 retries in the request; the key is parked `rate_limited` only if every attempt 429s. A later HTTP 200 (or a successful pick) clears `rate_limited_until`. The key is pickable again when `rate_limited_until` is null or past.
- Proxy / GC-account / API-key transport and soft errors go into `resource_attempts`. Disable when the last `*_error_window` attempts are at least `*_error_threshold` percent failures. Do not disable on the first blip.
- A disabled proxy is rotated off the current key/account even before the window fills; it stays in the ready pool until the threshold hits.
- GC timeout → next Steam account; do not block live polls.
- A thrown job on a named queue does **not** graphile-retry on that shard. The wrapper parks `run_scheduled_job` (30 s, 1 m, 3 m, …) and hops back when due. After the stamped budget the job leaves the queue.
- Self-reschedule loops (`poll_live_games`, `poll_top_live`, `poll_realtime_stats`, `poll_finished_history`, `walk_league_history`, `walk_seq_history`, archive / replenish / settle / retest / request-log maintain) use `maxAttempts = 25`. `maxAttempts = 1` is only for named-queue shards. Live polls enqueue the next `jobKey` at tick start (`runAt = started + live_poll_interval_ms`) so a slow Steam call does not slip the period; a sixth overlapping tick is skipped instead of queued. If Postgres dies before that enqueue, graphile retries the same `jobKey` after LISTEN comes back. `ensure_loop_jobs` (reconnect + 1 min cron) re-enqueues a key that is missing or permafailed without touching a scheduled or locked row.
- GC `CMsgGCMatchDetailsResponse.result = 15` (AccessDenied) → not a proxy / account fault. Mark the match `replay_unavailable` and finish the job; other results still throw and retry.
- Empty GetLiveLeagueGames / GetTopLiveGame → do not finish-detect that feed.
- Download without `source_url` → fail until details ran.
- 900 history misses (720 × 5 s + 180 × 60 s, ~4 h) → `status = failed`, `last_error_kind = history_timeout`.

---

## Metrics

Worker and parser expose Prometheus on `GET /metrics`. Compose scrapes them
into Prometheus; Grafana on host `:3003` loads provisioned dashboards.
Postgres inventory gauges (`dota_matches`, `dota_replays`, account
pools, …) are scraped only on `match-processing` (or `WORKER_ROLE=all`)
so the same row counts are not stored under three `role=` labels.
Catalog: [`metrics.md`](./metrics.md). Per-attempt Valve HTTP / GC / CDN
rows: [`request-logs.md`](./request-logs.md).

## Deployment

Three compose services, same image, `WORKER_ROLE` set:

| Service | Host health | Role |
|---|---|---|
| `worker-live` | `:3001` | live discovery |
| `worker-historical` | `:3004` | GetMatchHistory discovery. Scale is `WORKER_HISTORICAL_REPLICAS` (0 for now) |
| `worker-match-processing` | `:3005` | GC / replay / archive / request-log partitions / replenish |

Cron (`ensure_loop_jobs` every minute on every role; `fetch_leagues` hourly, `walk_league_history` 5-minute watchdog, `sync_catalogs` hourly on `historical` / `all`) is registered in `cronFor`. `walk_seq_history` is a boot loop on live and historical (`jobKey`). Catalog sync on boot is the same process: ingest on the other two does not wait for `heroes`.

API `POST /api/leagues/process-finished` forces `walk_league_history` for an id (reset exhausted); the historical process picks it up.

### Resource budget

Sized for `dota2-bigdata` (4 vCPU, 16 GiB). Limits across **all**
long-running compose services sum to 3.69 CPU and 14720 MiB (~92% of
the instance). Parser took CPU from Prometheus / Grafana so
six in-flight decodes are less CFS-throttled. One-shot migrate
containers are uncapped.

Long-running services use `restart: unless-stopped`. An OOM kill or
crash comes back; `docker stop` / a deliberate compose down does not.
Migrate one-shots stay `restart: no`. A `parsing` row older than 30
minutes is released to `stored` so a restarted parser can claim it.

| Service | CPU | Memory |
|---|---|---|
| postgres | 0.50 | 2048M |
| clickhouse | 0.70 | 4096M |
| worker-live | 0.30 | 768M |
| worker-historical | 0.30 | 768M |
| worker-match-processing | 0.80 | 1536M |
| parser | 3.00 | 8192M |
| api | 0.10 | 384M |
| prometheus | 0.05 | 768M |
| grafana | 0.04 | 256M |

### Catalogs (`sync_catalogs`)

`heroes` / `items` / `patches` (and abilities, facets, modes, …) are lookup tables. Match ingest writes Valve ids and never fills those rows — that is why an empty `heroes` table with a full `match_draft` is possible. Hourly `sync_catalogs` (and historical boot) asks `www.dota2.com/datafeed/patchnoteslist` through an `api` proxy; a new `patch_number` (or an empty `heroes` table) then upserts `herolist` / `itemlist` / `abilitylist` / patches. It does not delete rows and does not overwrite attack type, roles, or item cost when the list feed has none. Richer fields (facets, slots, modes, regions, XP) stay on the CLI-only `sync_catalogs_external_providers` (`bun run catalogs:sync-external`) from d2vpkr VPK + odota `json/`. The worker **blocks ingest startup** on a successful catalog sync when `heroes` is empty, and otherwise keeps the last good rows if the feed is down. CLI: `bun run catalogs:sync`.
