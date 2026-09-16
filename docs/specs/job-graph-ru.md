# Граф джоб (обзор)

Компаньон детальной спеки (вызовы, статусы, вставки):
[`job-graph.md`](./job-graph.md). Роли и очереди:
[`worker-architecture.md`](./worker-architecture.md).

Истина матча — `matches.status` и `match_replays.status`. Очередь —
таблицы graphile-worker. Парсер — отдельный процесс на Go, не
graphile-задача.

Live-финиш (`live_duration_max > 0`) сразу ставит GC и вооружает
waiter history/seq: они идут **параллельно**. Walk лиги тоже ставит
и seq, и GC.

```
live                      history / seqnum              historical
poll_live_games           poll_finished_history         walk_league_history
poll_top_live                       │                   process_league
poll_realtime_stats                 ▼                            │
        │                 fetch_seq_details                      │
        │                           │                            │
        └───────────────────────────┼────────────────────────────┘
                                    ▼
                          fetch_match_details      GC
                                    │
                                    ▼
                          download_replay          CDN → S3 hot
                                    │
                                    ▼
                          parser (Go)              CH replay_*
                                    │
                                    ▼
                          archive_parsed_replays   S3 cold
```

`matches.status`

```
live                                         historical
poll_live_games / poll_top_live              walk_league_history
        │                                             │
        ▼                                             │
      live                                            │
        │                                             │
        ├──────────────► not_started ────────────────┤  clock = 0
        │                                             │
        ▼                                             │
awaiting_history                                      │
        │                                             │
        ├──────────────► failed                         waiter exhausted
        │
        └───────────────────┬─────────────────────────┘
                            ▼
                    awaiting_details          history hit / listing
                            │
                            ├──────────────► replay_unavailable
                            ▼                 GC 15 / CDN / 404
                    details_ready             GC
                            │
                            ▼
                    replay_stored             S3
                            │
                            ▼
                    parsed                    parser
```

Live flap: пока матч не дошёл до `details_ready`, повторное появление
в live-фиде возвращает его в `live`. Архив статус не меняет.

`match_replays.status`

```
pending
        │
        ▼
downloading
        │
        ├──────────────► unavailable
        ├──────────────► failed
        │
        ▼
stored
        │
        ▼
parsing
        │
        ▼
parsed
```

---


## 1. Джобы пайплайна матча

| Этап | Джоба | Роль | Описание |
|---|---|---|---|
| Live | `poll_live_games` | live | Раз в две секунды вызывается GetLiveLeagueGames. Upsert в Postgres `matches`, `match_players`, `match_draft`, `teams`, `series`. Live-тики — в `live_match_ticks` и `live_player_ticks`. Матч сохраняется в статусе `live`. Если матч пропал из ответа и часы уже шли — `awaiting_history` и сразу GC; если часы остались 0 — `not_started`. Скачивание не ставит. |
| Live | `poll_top_live` | live | Раз в две секунды вызывается GetTopLiveGame, только лиговые матчи (`league_id > 0`). Upsert в Postgres `matches`, заполняет `server_steam_id`. Без него `poll_realtime_stats` не работает. Тики не пишет. Если матч пропал из ответа — те же `awaiting_history` / `not_started`. |
| Live | `poll_realtime_stats` | live | Для матчей в `live` с `server_steam_id` вызывается GetRealtimeStats. Upsert в Postgres `matches`, `match_players`. Тики — в `live_match_ticks` и `live_player_ticks`. Статус матча не меняет. |
| Historical | `walk_league_history` | historical | По одной странице GetMatchHistory обходит лиги. Upsert в Postgres `matches`, `match_players`, `teams`, `series`; курсоры — в `leagues`. Новые и ранние статусы → `awaiting_details`. Сразу ставит в очередь `fetch_seq_details` и `fetch_match_details`. |
| Historical | `process_league` | historical | Тот же GetMatchHistory, но для одной лиги со сбросом курсоров. HTTP `POST /api/leagues/process-finished` сейчас ставит `walk_league_history`, не этот identifier. |
| History / seqnum | `poll_finished_history` | live + historical | Раз в пять секунд для матчей без seqnum вызывается GetMatchHistory по лиге. Нашёл — пишет `match_seq_num` в `matches`, ранние статусы → `awaiting_details`, в очередь seq и GC. Не нашёл за весь бюджет и статус ещё `awaiting_history` — `failed`. Если GC уже продвинул матч, статус не меняет. |
| History / seqnum | `fetch_seq_details` | live + historical | По `match_seq_num` вызывается GetMatchHistoryBySequenceNum. Дописывает в Postgres `matches`, `match_players`, `match_draft`. Скачивание не ставит — соли нет. Параллельно с GC. |
| GC | `fetch_match_details` | match-processing | Запрос в Game Coordinator (`CMsgGCMatchDetailsRequest`). Пишет в Postgres `matches`, `match_players`, `match_draft`, `match_replays` (соль, URL). Статус `details_ready`, в очередь `download_replay`. AccessDenied или нет файла на CDN — `replay_unavailable`. |
| Скачивание | `download_replay` | match-processing | Качает `.dem.bz2` с CDN Valve в горячий S3. Пишет `match_replays`, статус матча `replay_stored`. Если объект уже есть — без GET. 404 с бюджетом — повтор, иначе `replay_unavailable`. |
| Парс | parser (Go) | parser | Отдельный процесс, не graphile. Читает `.dem.bz2` из горячего S3. Пишет ClickHouse `replay_*` и Postgres-саммари (`match_players`, `match_objectives`, `match_draft`). Статус `parsed`. |
| Архив | `archive_parsed_replays` | match-processing | Раз в 30 секунд копирует parsed `.dem.bz2` в холодный S3, удаляет горячий объект. В Postgres обновляет `match_replays` (`s3_bucket`, `s3_key`, `archived_at`). Статус не меняет. |

Очереди: `seq:{match_id % 5}` и `details:{match_id % 5}` — пять шардов,
seq и GC одного матча параллельны. Реплеи: `replay-live:{% 10}` и
`replay-historical:{% 10}`. Live приоритет 0, historical details/seq 10,
historical replay / walk 20.

---

## 2. Остальные джобы

Не двигают `matches.status`. Каталоги, лиги, аккаунты, логи, hop очереди.

| Джоба | Роль | Описание |
|---|---|---|
| `fetch_leagues` | historical | Раз в час GetLeagueInfoList (плюс live-фиды, чтобы не пропустить живые `league_id`). Upsert в Postgres `leagues` (`LIVE` / `UPCOMING` / `FINISHED`). Матчи не трогает. |
| `sync_catalogs` | historical | На старте и раз в сутки в 05:00 UTC обновляет Postgres `heroes`, `items`, `abilities`, `patches` и остальные справочники. Если `heroes` пуст — ingest не стартует. |
| `replenish_accounts` | match-processing | Если готовых API-ключей или GC-аккаунтов меньше порога — покупка на dark.shopping. Пишет `marketplace_orders`, новые строки в `steam_api_keys` / `steam_accounts`. |
| `retest_disabled_resources` | match-processing | Проверяет `disabled` прокси, GC-аккаунты и ключи. Успех — статус `ready`. Пишет `proxies`, `steam_accounts`, `steam_api_keys`. |
| `maintain_request_logs` | match-processing | Создаёт суточные партиции логов Valve на два дня вперёд, дропает старше 4 дней (`steam_api_requests`, `steam_gc_requests`, `replay_requests`). |
| `run_scheduled_job` | все роли | Именованная очередь не держит отложенный `runAt`. Когда срок наступил — возвращает работу на `details:*` / `seq:*` / `replay-*`. |
| `ensure_loop_jobs` | все роли | Раз в минуту и после reconnect graphile LISTEN. Если self-reschedule джоба (`poll_live_games` и т.п.) пропала или `attempts >= max_attempts` — ставит её снова. Живую или запланированную не трогает. |

Не джобы: CLI `persistSeqMatches` (пакетный seq), `POST /api/buy-account`
(та же покупка, что replenish), `/metrics` парсера.

---

## 3. Статусы матча

`matches.status`

| Статус | Описание |
|---|---|
| `live` | Матч есть в GetLiveLeagueGames / GetTopLiveGame. |
| `awaiting_history` | Live-фид пропал, часы уже шли. Ждём seqnum; GC уже в очереди. |
| `not_started` | Live-фид пропал, `live_duration_max` так и 0. |
| `awaiting_details` | Матч есть в GetMatchHistory. Ждём GC. |
| `details_ready` | GC сохранил боксскор, соль и URL реплея. |
| `replay_stored` | `.dem.bz2` в горячем S3. |
| `parsed` | Парсер записал ClickHouse `replay_*` и Postgres-саммари. |
| `replay_unavailable` | Реплея нет: AccessDenied, cluster 0/1 или 404 без бюджета. |
| `failed` | GetMatchHistory так и не вернул матч, статус ещё был `awaiting_history`. Если GC уже продвинул строку — статус не меняем. |

`awaiting_replay` есть в enum и пишется CLI-заглушками; ingest прыгает
`details_ready` → `replay_stored`.

`match_replays.status`

| Статус | Описание |
|---|---|
| `pending` | Строка создана, скачивание ещё не началось (или 404 ждёт повтор). |
| `downloading` | Идёт GET с CDN. |
| `stored` | Объект в S3. Зависший `parsing` старше 30 мин возвращается сюда. |
| `parsing` | Парсер взял файл. |
| `parsed` | ClickHouse `replay_*` и Postgres записаны. |
| `unavailable` | Реплея нет: GC result 15, не писали / просрочен, cluster 0/1, 404 без бюджета. |
| `failed` | Нет GC-аккаунта или ошибка CDN/S3 (не 404). Retry через `run_scheduled_job`. |
