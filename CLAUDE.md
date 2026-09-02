# dota2-collector

Проект сгенерирован из шаблона монорепозитория. Разделы внутри маркеров
пересобирает генератор шаблона, текст вне маркеров не трогается.
В `.claude/skills/` лежат конвенции выбранных блоков — агент подхватывает
их сам, читать их отсюда не нужно.

## Структура

<!-- <template:structure> -->
| Путь | Что |
|---|---|
| `packages/shared` | общий код: env, подключения, утилиты; барель — `src/app.ts` |
| `packages/api` | HTTP-сервер: `Bun.serve` |
| `packages/cli` | одноразовые скрипты, запускаются по пути |
| `packages/worker` | сервис: свой `app.ts` с graceful shutdown и свой `utils/env.ts` |
<!-- </template:structure> -->

## Запуск

```bash
bun install
cp .env.example .env
```

Схема окружения читается на верхнем уровне модуля: без заполненного
`.env` импортирующий её код падает на старте, а не при первом
обращении к переменной.

## Команды

<!-- <template:commands> -->
```bash
bun run typecheck
bun run api
bun run db:pull
bun run db:down
bun run db:new
bun run db:up
bun run lint
bun run lint:fix
bun run worker
```

Первый запуск, по порядку: `bun install` → заполнить `.env` → `bun run db:up` →
`bun run db:pull` → `bun run api` → `bun run worker`.

Тесты живут в пакетах, идут против живой dev-базы и запускаются из
каталога пакета:

```bash
cd packages/shared && bun run test
cd packages/api && bun run test
cd packages/cli && bun run test
cd packages/worker && bun run test
```
<!-- </template:commands> -->

## ClickHouse

DDL is dbmate, same as Postgres: `db/clickhouse/migrations/`, dump
`db/clickhouse/schema.sql`, URL in `CHURI`. `bun run ch:up` / `ch:down` /
`ch:new`. Compose `clickhouse-migrate` is the same dbmate image as `migrate`.
The worker does not create or alter tables. dbmate is the compose
one-shot (`clickhouse-migrate`), not a library in the worker process.

## Postgres (коллектор)

Запросы — Drizzle поверх `bun.sql`, не pgtyped и не postgres.js. Таблицы
в `packages/shared/src/db/schema.ts` снимаются `bun run db:pull`. DDL —
dbmate (`bun run db:up`, compose `migrate`): в код сервисов он не
импортируется и в образ не копируется.

## Как здесь работать

- **Состояние проекта живёт в файлах, а не в переписке.** Спека («что и
  почему») и план («какими шагами») пишутся до кода — например в
  `docs/specs/` и `docs/plans/`; прогресс отмечается чекбоксами в самом
  плане и коммитами. Свежая сессия узнаёт, на чём остановились, из плана
  и `git log`, а не из вопроса «что мы делали в прошлый раз».
- **Решение, принятое в диалоге и нигде не записанное, к следующей
  сессии не существует.** Развилка закрывается правкой спеки, открытый
  вопрос — строкой в бэклоге с причиной, по которой он отложен.
- **Планы пишутся по одному, прямо перед исполнением.** Интерфейсы
  следующего шага зависят от того, что реально получилось в предыдущем,
  поэтому план на весь проект вперёд устаревает быстрее, чем пишется.
- **Правка предиката или числа тянет правку всех мест, где старое
  поведение объяснено словами.** Ни типы, ни тесты этого не ловят: дифф
  показывает изменённые строки и не показывает те, которые изменение
  сделало ложными.

<!-- <template:sections> -->
## Стек

Bun, TypeScript, Zod, biome. Код живёт в `packages/*`, скоуп пакетов — `@app`.

## Правила

- Внутри пакета импорт по алиасу `#src/...`, между пакетами — `@app/shared`.
  Алиас объявлен полем `imports` в `package.json` пакета, а не `paths` в его
  `tsconfig.json`: через `paths` он ломается, как только пакет импортирует
  чужой, — `tsc` применяет их и к чужим исходникам.
- Переменные окружения объявляются в `packages/shared/src/utils/env.ts`,
  нужные одному пакету — в его собственном `src/utils/env.ts`. Правки внутри
  маркеров перетираются генератором, вне маркеров — нет.
- Один `.env` в корне монорепозитория, по одному на пакет не заводится.
- biome: одинарные кавычки, точки с запятой `asNeeded`, ширина 80, табы.
- tsconfig strict плюс `noUncheckedIndexedAccess`: `arr[0]` имеет тип
  `T | undefined`. И `verbatimModuleSyntax`: импорт типа пишется `import type`.

## Postgres и запросы

Клиент — `bun.sql`, поверх него Drizzle (`drizzle-orm/bun-sql`) в
`packages/shared/src/utils/db.ts`. Таблицы — `packages/shared/src/db/schema.ts`,
снятые с живой базы. DDL по-прежнему пишет dbmate, не drizzle-kit migrate.

```bash
bun run db:up     # миграции dbmate
bun run db:pull   # drizzle-kit pull → schema.ts / relations.ts
```

Порядок: миграция → применить к базе → `db:pull` → писать код.

- Запрос: `db.execute(sql\`…\`)` или `db.select().from(matches)`.
  Транзакция — `db.transaction(async (tx) => { await tx.execute(sql\`…\`) })`.
  Внутри колбэка только `tx`, не `db`: иначе запрос уйдёт мимо транзакции.
- `undefined` в SQL-плейсхолдере Drizzle **опускает** кусок запроса, а не
  биндит NULL. Для SQL NULL — `?? null`.
- int8 в схеме — `bigint({ mode: 'number' })`. Сырой `execute` отдаёт типы
  драйвера (строка/bigint для значений вне i32); `select()` проходит через
  схему.
- `sqlValues(rows)` — VALUES-список для bulk INSERT. `sqlIn(ids)` — список
  для `IN`.
- `schema.ts` / `relations.ts` руками лучше не править: их перезаписывает
  `db:pull`. После pull прогнать biome.

## Миграции

dbmate — отдельный бинарь, через bun он не ставится:
`brew install dbmate` (или см. github.com/amacneil/dbmate). URL базы берётся
из переменной `PGURI`.

```bash
bun run db:new create_users   # db/migrations/<timestamp>_create_users.sql
bun run db:up                 # применить и обновить db/schema.sql
bun run db:down               # откатить последнюю
```

- Миграция состоит из секций `-- migrate:up` и `-- migrate:down`.
- `db/schema.sql` — дамп схемы, он коммитится.
- `CREATE INDEX CONCURRENTLY` выносится в отдельную миграцию с директивой
  `-- migrate:up transaction:false`: dbmate оборачивает в транзакцию
  каждую миграцию, а внутри транзакции такая команда не выполняется.
- После DDL переснять схему Drizzle: `bun run db:pull`. Watch за файлами
  `.ts` схему базы сам не увидит — новые колонки и значения enum появятся
  в `schema.ts` только после pull.

## HTTP-сервер

`packages/api` — `Bun.serve`. `src/app.ts` поднимает процесс, `src/http.ts` —
ответы и CORS, `src/routes.ts` — таблица путей. Отдельного HTTP-фреймворка
в зависимостях нет.

Пример формы (лежит в `routes.ts`):

```
GET  /healthz
GET  /api/health
GET  /api/echo/:id
POST /api/echo/:id   { "message": "..." }
```

- Новый эндпоинт — ключ в объекте `routes` (`/api/things/:id` с
  `request.params`). Скелет процесса не трогают.
- Тело запроса читается через `readJson`, форма проверяется Zod, ответ —
  `json(request, body, status)`.
- `methods({ GET, POST })` добавляет OPTIONS для CORS. Origin сверяется с
  `CORS_ORIGINS` (список через запятую). Пустой список — ни одного чужого
  origin, а не «любой».
- Ошибка с понятным статусом — `throw new HttpError(status, message)` внутри
  `try/catch`, который зовёт `handleError`.
- Процессу нужен заполненный `.env`: схема читается на старте модуля.
- Хендлер импортирует `pool` / `sql` из `@app/shared` сам: отдельного
  контекста у `Bun.serve` нет.

## Логирование

`packages/shared/src/utils/logger.ts` отдаёт настроенный `pino`.

- `pino-pretty` подключается только при `NODE_ENV=development`: в проде
  вывод обязан оставаться построчным JSON, иначе его не разберёт сборщик
  логов.
- Уровень задаётся `LOG_LEVEL` и меняется без пересборки.

## Образы

Каждому сервису генератор кладёт `packages/<сервис>/Dockerfile`. Контекст
сборки — корень монорепозитория, а не каталог пакета:

```bash
docker build -f packages/api/Dockerfile -t api .
```

- Внутри маркеров `# <template:runtime>` пишет генератор: список копируемых
  исходников зависит от workspace-зависимостей сервиса и обновляется на
  `template add`. Свои шаги — сертификаты, healthcheck, дополнительные
  `COPY` — дописываются снаружи маркеров, там пересборка не трогает.
- **Порт.** Платформа передаёт номер порта переменной `PORT`, а схема
  окружения читает своё имя (`SERVER_PORT`, `WS_PORT`) и дефолта не имеет,
  поэтому образ проставляет его строкой `ENV` сам. Без неё контейнер падает
  `ZodError` на верхнем уровне модуля ещё до старта сервера.
- **Сгенерированный код едет в образ готовым.** Реестр SQL-доменов и типы
  запросов лежат под `src/` и обязаны быть закоммичены: внутри образа их не
  пересобрать — генераторы импортируют код, который разбирает окружение и
  ходит в базу.
- Манифесты копируются все (`COPY --parents packages/*/package.json`): лок-файл
  описывает воркспейсы разом, и отсутствующий манифест соседа bun считает
  изменением дерева. Сама установка сужена до сервиса флагом `--filter`.
- `.env` в образ не уезжает (`.dockerignore`) — переменные задаёт платформа.
- **Миграции остаются снаружи образа.** Каталог `db/` в него не копируется, а
  dbmate ходит в базу сам — из CI или руками, до выката новой версии. Образ,
  применяющий миграции на старте, делал бы это в каждой реплике разом.
<!-- </template:sections> -->

## Маршруты коллектора

Эти пути — домен проекта, шаблон про них не знает.

- `GET /healthz`, `GET /readyz` — liveness / Postgres.
- `GET /api/health` — uptime.
- `POST /api/leagues/process-finished` — тело `{ league_id, matches_limit? }`.
- `GET /api/leagues/ingest-runs/:id` — статус ingest-прогона.

