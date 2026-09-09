# Marketplace account purchase

Companions: [`worker-architecture.md`](./worker-architecture.md). Dark Shopping HTTP surface: [dark.shopping/developer](https://dark.shopping/developer). PHP client is investigation-only ([keystore-client-php](https://github.com/keystore-api/keystore-client-php)); this repo talks to the JSON API from TypeScript.

## Why

Bought Steam accounts land in `steam_accounts` (and `steam_api_keys` when we issue a Web API key). Other marketplaces can share the same order table and `purchaseFromMarketplace` switch; only `dark_shopping` is wired today.

## HTTP

`POST /api/buy-account`

```json
{
  "productId": 80841,
  "store": "dark_shopping",
  "type": "api_key",
  "count": 1,
  "testOnMatchId": 12389123,
  "imapHost": "imap.firstmail.ltd"
}
```

- `count` 1–`marketplace_buy_max` (seed 10). Each unit is a **separate** local row and a separate Dark Shopping `order/create` with `quantity=1` and `idempotence_id` = our order UUID.
- The handler waits **up to `marketplace_wait_ms`** (seed 2 minutes) for Dark Shopping `completed`/`ok`, then provisions. Bun `idleTimeout` is 0 so the request is not cut at 10s.
- Missing `DARK_SHOPPING_API_KEY` → 503.
- Rate limit: **≤ 2 req/s** to Dark Shopping (`marketplace_min_interval_ms`, seed 500 ms). 429 retries with backoff.
- `imapHost` optional: skip auto-detect / probe and LOGIN that host. Outlook/Hotmail still fails for `type=api_key`.

## CLI

Same orchestrator as the HTTP handler:

```bash
bun run steam:guard buy-account --count 1 --product-id 80841 --type api_key --store dark_shopping
bun run steam:guard buy-account --count 1 --product-id 160811 --type gc --test-on-match-id 8979241530
bun run steam:guard buy-account --product-id 80841 --type api_key --imap-host imap.firstmail.ltd
```

`--store` defaults to `dark_shopping`. Prints the same `{ orders: [...] }` JSON on stdout. Progress goes to stderr: order id, bought `login` + `email` (passwords never logged), IMAP / Guard / `/dev/requestkey` / GC welcome. Steam-user websocket debug is not printed. Exit 1 if any order is not `success`. Product id must be on `marketplace_products`.

Response:

```json
{
  "orders": [
    {
      "status": "success | failed | pending",
      "productId": 80841,
      "store": "dark_shopping",
      "errorMessage": null,
      "testResult": {
        "replayUrl": "http://replay….dem.bz2",
        "liveGamesIds": [1, 2]
      }
    }
  ]
}
```

`pending` means Dark Shopping had not finished within `marketplace_wait_ms`; the local row stays `pending`. Provision (IMAP / Guard / GC) is **not** bounded by that wait.

## Postgres

`marketplace_orders`: surrogate `id`, unique `order_id` (uuid), store, kind (`api_key` | `gc`), product, status, idempotence id, external order id, optional `steam_account_id`, `test_on_match_id`, `error_message`, `test_result` jsonb.

`marketplace_products`: whitelist of buyable goods. Unique `(store, kind)` so replenish knows which product to order. Seed: Dark Shopping `80841` (`api_key`), `160811` (`gc`). CLI/HTTP reject a product id that is not on this list.

`settings`: app-wide key/value with an admin `description`. Worker reads these on each job tick (no env copies). Secrets and connection URLs stay in `.env`.

Inventory and health:

| key | seed | meaning |
|---|---|---|
| `desired_api_keys` | 3 | buy when ready Web API keys fall below this |
| `desired_gc_accounts` | 10 | buy when ready dedicated GC accounts fall below this |
| `proxy_error_threshold` | 80 | percent of failures in the window that disables a proxy |
| `proxy_error_window` | 20 | last N proxy attempts counted |
| `proxy_retest_max` | 20 | disabled-proxy probes, then give up |
| `gc_account_error_threshold` | 80 | same for dedicated GC accounts |
| `gc_account_error_window` | 20 | |
| `gc_account_retest_max` | 20 | |
| `api_key_error_threshold` | 80 | same for `steam_api_keys` |
| `api_key_error_window` | 20 | |
| `api_key_retest_max` | 20 | |

Collector cadence (was env):

| key | seed | meaning |
|---|---|---|
| `live_poll_interval_ms` | 3000 | `poll_live_games` period |
| `live_missing_threshold` | 2 | missing live ticks before finish |
| `replay_live_delay_ms` | 30000 | first live replay download wait after finish. 404s: 1 m, 1 m, 3 m × 20, 1 h × 24, then `replay_unavailable` |
| `history_fast_poll_ms` | 5000 | GetMatchHistory waiter interval (first 100 misses) |
| `history_fast_poll_limit` | 100 | fast-poll attempts per finished live match |
| `history_slow_poll_ms` | 60000 | waiter interval after the fast budget |
| `history_slow_poll_limit` | 100 | slow-poll attempts before `history_timeout` |
| `history_page_size` | 100 | GetMatchHistory page (Valve max 100) |
| `history_details_enqueue_limit` | 5 | runnable historical details jobs plus parked `run_scheduled_job` hops (locked-queue waiters and exhausted retries do not count; run cap is 5 `details:*` queues) |
| `history_replay_enqueue_limit` | 50 | queued historical download_replay jobs plus parked hops (run cap is 10 `replay-historical:*` queues) |
| `seq_batch_size` | 100 | GetMatchHistoryBySequenceNum window |
| `steam_api_min_interval_ms` | 1000 | 1 rps mutex per Web API key |
| `history_newest_refresh_ms` | 3600000 | re-fetch newest history page |
| `history_exhausted_refresh_ms` | 86400000 | retry exhausted leagues |
| `replenish_interval_ms` | 60000 | inventory buy check |
| `retest_interval_ms` | 300000 | disabled-resource probe |

Marketplace / GC:

| key | seed | meaning |
|---|---|---|
| `marketplace_buy_max` | 10 | max units per buy-account call |
| `marketplace_wait_ms` | 120000 | wait for Dark Shopping completed/ok |
| `marketplace_min_interval_ms` | 500 | Dark Shopping HTTP slot (≤ 2 req/s) |
| `gc_logon_attempts` | 4 | password logOn tries when probing GC |
| `api_key_rate_limit_ms` | 60000 | cooldown after Web API 429 |
| `gc_account_rate_limit_ms` | 300000 | cooldown after GC rate-limit logon |

Pending `marketplace_orders` count toward the desired pool so two workers do not over-buy. Credential deaths (`InvalidPassword`, Web API 403) disable immediately and skip retest.

## After delivery

Delivery text is parsed for Steam credentials. Two layouts are accepted: `LOGIN:PASSWORD:EMAIL:EMAILPASSWORD` after `Ваш заказ:` (api_key goods), and labeled `Login Steam` / `Password Steam` / `Email Login` / `Email Password` (some GC goods; the banner is optional). Logs redact both password fields.

**`type=api_key`:** resolve IMAP (or use `imapHost` / `--imap-host` when given). Outlook/Hotmail → fail immediately, money already spent; smakmail / firstmail known hosts; other domains probed including firstmail/smakmail. Enroll Guard from email if needed, issue `/dev/requestkey`, test with `GetLiveLeagueGames` → `liveGamesIds`.

**`type=gc`:** bind a GC proxy, steam-user password login on **this** account (not the worker pool), persist refresh token. SOCKS5 cannot use Steam TCP CMs (`steam-user` forces WebSocket). If the CM websocket dies with `Socket closed` **before** Guard, that proxy is disabled and the account is rebound — after SOCKS, the next pick prefers HTTP. After Guard, the same proxy is retried with `authCode` (steam-user disconnects on purpose while IMAP runs). Up to 4 logOn attempts. If `testOnMatchId` is set, `CMsgGCMatchDetailsRequest` → `replayUrl`. Re-run without buying:

```bash
bun run steam:guard scrape-match --login <login> --match-id 8979241530
```
