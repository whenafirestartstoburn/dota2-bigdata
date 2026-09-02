---
name: db-migration
description: Используется при любом изменении схемы Postgres или ClickHouse — dbmate, секции migrate:up и migrate:down, дампы db/schema.sql и db/clickhouse/schema.sql, CREATE INDEX CONCURRENTLY, bun run db:pull после DDL Postgres.
---

# Миграции через dbmate

Схема базы меняется только миграцией. Руками применённый к базе `ALTER` не
воспроизведётся ни у соседа, ни на проде — файла, который его накатит, нет, —
а в дампе `db/schema.sql` он всплывёт изменением, за которым не стоит ни
одной миграции.

Примеры ниже иллюстративные: доменного кода в шаблоне нет, имена таблиц и
колонок придуманы ради формы.

## Установка

dbmate — отдельный Go-бинарь, а не npm-пакет: через `bun install` он не
ставится и в `package.json` его нет. Из `packages/*/src` его не
импортируют: сервисы миграции не применяют. Образ `api`/`worker` каталог
`db/` не копирует (`.dockerignore`). Накатка — `bun run db:up` / `ch:up`
или one-shot в compose (`migrate`, `clickhouse-migrate`), до старта
реплик, не из процесса приложения.

```bash
brew install dbmate   # или см. github.com/amacneil/dbmate
```

URL базы берётся из переменной `PGURI` (Postgres) или `CHURI` (ClickHouse) —
это они стоят в скриптах флагом `--env`. Без флага dbmate искал бы
`DATABASE_URL`. Переменные живут в корневом `.env`, том же, из которого
читает всё остальное в проекте; экспортировать их отдельно не нужно.

## Цикл

Postgres (умолчания dbmate: `db/migrations`, `db/schema.sql`):

```bash
bun run db:new create_users   # db/migrations/<timestamp>_create_users.sql
bun run db:up                 # применить и обновить db/schema.sql
bun run db:down               # откатить последнюю
```

ClickHouse (отдельный каталог, тот же dbmate):

```bash
bun run ch:new add_live_column   # db/clickhouse/migrations/<timestamp>_….sql
bun run ch:up                    # применить и обновить db/clickhouse/schema.sql
bun run ch:down
```

`CHURI` — native TCP (`clickhouse://user:pass@host:9000/dota`), не HTTP
`CLICKHOUSE_URL` приложения. DDL ClickHouse пишется с
`-- migrate:up transaction:false`: у CH нет транзакций как у Postgres.
Один блок `-- migrate:up` — один statement: ClickHouse не принимает
несколько команд в одном запросе. Несколько таблиц в одном файле —
это пары `-- migrate:up` / `-- migrate:down` подряд (так умеет dbmate).

Созданный файл состоит из двух секций:

```sql
-- migrate:up
CREATE TABLE users (
	uuid UUID PRIMARY KEY,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE users;
```

Порядок применения задаёт timestamp в имени файла, поэтому имя не правится
после того, как миграция уехала в общую ветку: у соседей она уже применена
под старым именем.

Каталог и дамп Postgres — умолчания dbmate (`db/migrations`, `db/schema.sql`).
ClickHouse задаётся флагами в скриптах `ch:*` (`db/clickhouse/migrations`,
`db/clickhouse/schema.sql`). В чужой каталог миграции не кладут.

## `db/schema.sql` коммитится

Это дамп схемы: единственное место, где она видна целиком, не собираясь в
голове из цепочки миграций. Руками он не пишется — его перезаписывает каждый
`db:up` / `db:down` (Postgres) и `ch:up` / `ch:down` (ClickHouse,
`db/clickhouse/schema.sql`). Дамп входит в коммит вместе с миграцией.

**Ловушка версии `pg_dump`.** Если локальный `pg_dump` старше сервера
Postgres, `db:up` МОЛЧА не перезаписывает дамп: команда завершается нулевым
кодом, миграция к базе применяется, а `db/schema.sql` в репозитории остаётся
прежним — dbmate не поднимает наружу несовпадение версий, случившееся внутри
вызова `pg_dump`. Признак — пустой diff дампа после миграции, которая точно
что-то изменила. Лечится тем, что в `PATH` первым идёт `pg_dump` версии
сервера (`brew --prefix postgresql@18`/`bin`).

## `CREATE INDEX CONCURRENTLY` — отдельной миграцией

dbmate оборачивает каждую миграцию в транзакцию, а `CREATE INDEX
CONCURRENTLY` внутри транзакции не выполняется. Поэтому такой индекс живёт в
собственном файле с директивой на секции:

```sql
-- migrate:up transaction:false
CREATE INDEX CONCURRENTLY users_created_at_idx ON users (created_at);

-- migrate:down
DROP INDEX IF EXISTS users_created_at_idx;
```

Отдельный файл — не аккуратность, а следствие: директива снимает транзакцию
со всей секции, и любой соседний `ALTER`, дописанный в тот же файл, потеряет
атомарность — упав посередине, он оставит схему в промежуточном состоянии, а
запись о миграции не появится, и следующий `db:up` начнёт её заново.

## После DDL переснять схему Drizzle

Типы таблиц даёт `drizzle-kit pull`, а не watch за файлами. Новая колонка,
новое значение enum, сменившийся тип — ничего из этого в `schema.ts` само
не появится.

```bash
bun run db:up
bun run db:pull
```

Конвенции запросов — в скилле `drizzle-query`.

## Обратимость

Секция `down` пишется всегда, даже когда откат кажется невероятным: она
нужна не только на проде, но и локально — при переключении веток и при
переделке своей же миграции.

Обратим при этом дамп схемы, но не данные: `down` у `DROP COLUMN` вернёт
колонку, а её содержимое — нет. Поэтому необратимое изменение оформляется
двумя шагами и двумя миграциями:

1. Код перестаёт читать и писать колонку, миграция снимает с неё то, что
   мешает жить дальше (`NOT NULL`, значение по умолчанию, внешний ключ), —
   такой шаг откатывается полностью.
2. Уже после того, как первый шаг выкачен и отработал, отдельной миграцией
   идёт сам `DROP COLUMN`.

Между шагами схема остаётся рабочей и для старой, и для новой версии кода, а
откат первого шага не теряет ничего. Точка невозврата — ровно второй шаг,
и он делается отдельно и осознанно, а не заодно с первым.
