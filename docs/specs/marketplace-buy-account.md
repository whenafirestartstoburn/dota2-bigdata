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

- `count` 1–10. Each unit is a **separate** local row and a separate Dark Shopping `order/create` with `quantity=1` and `idempotence_id` = our order UUID.
- The handler waits **up to 2 minutes** for Dark Shopping `completed`/`ok`, then provisions. Bun `idleTimeout` is 0 so the request is not cut at 10s.
- Missing `DARK_SHOPPING_API_KEY` → 503.
- Rate limit: **≤ 2 req/s** to Dark Shopping (shared slot, 500 ms). 429 retries with backoff.
- `imapHost` optional: skip auto-detect / probe and LOGIN that host. Outlook/Hotmail still fails for `type=api_key`.

## CLI

Same orchestrator as the HTTP handler:

```bash
bun run steam:guard buy-account --count 1 --product-id 80841 --type api_key --store dark_shopping
bun run steam:guard buy-account --count 1 --product-id 160810 --type gc --test-on-match-id 8979241530
bun run steam:guard buy-account --product-id 80841 --type api_key --imap-host imap.firstmail.ltd
```

`--store` defaults to `dark_shopping`. Prints the same `{ orders: [...] }` JSON on stdout. Progress goes to stderr: Dark Shopping method/path/params (API key redacted) and a truncated response body, then `login` + `email` of the bought account (passwords never logged), then IMAP / Steam Guard / `/dev/requestkey` / GC steps. Exit 1 if any order is not `success`.

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

`pending` means Dark Shopping had not finished within 2 minutes; the local row stays `pending`. Provision (IMAP / Guard / GC) is **not** bounded by those 2 minutes.

## Postgres

`marketplace_orders`: store, kind (`api_key` | `gc`), product, status, idempotence id, external order id, optional `steam_account_id`, `test_on_match_id`, `error_message`, `test_result` jsonb.

## After delivery

Delivery text is parsed for Steam credentials. Two layouts are accepted: `LOGIN:PASSWORD:EMAIL:EMAILPASSWORD` after `Ваш заказ:` (api_key goods), and labeled `Login Steam` / `Password Steam` / `Email Login` / `Email Password` (some GC goods; the banner is optional). Logs redact both password fields.

**`type=api_key`:** resolve IMAP (or use `imapHost` / `--imap-host` when given). Outlook/Hotmail → fail immediately, money already spent; smakmail / firstmail known hosts; other domains probed including firstmail/smakmail. Enroll Guard from email if needed, issue `/dev/requestkey`, test with `GetLiveLeagueGames` → `liveGamesIds`.

**`type=gc`:** bind a GC proxy, steam-user password login on **this** account (not the worker pool), persist refresh token. SOCKS5 cannot use Steam TCP CMs (`steam-user` forces WebSocket). If the CM websocket dies with `Socket closed` **before** Guard, that proxy is disabled and the account is rebound — after SOCKS, the next pick prefers HTTP. After Guard, the same proxy is retried with `authCode` (steam-user disconnects on purpose while IMAP runs). Up to 4 logOn attempts. If `testOnMatchId` is set, `CMsgGCMatchDetailsRequest` → `replayUrl`. Re-run without buying:

```bash
bun run steam:guard scrape-match --login <login> --match-id 8979241530
```
