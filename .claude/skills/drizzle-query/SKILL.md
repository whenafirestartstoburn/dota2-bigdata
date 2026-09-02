---
name: drizzle-query
description: >-
  Используется при написании SQL-запроса к Postgres — Drizzle + bun.sql,
  schema.ts после db:pull, execute/select, транзакции db.transaction, sqlValues.
---

# Запросы через Drizzle и bun.sql

Клиент — нативный `Bun.SQL`, поверх него Drizzle
(`drizzle-orm/bun-sql`). DDL пишет dbmate, не drizzle-kit migrate/push.
Типы таблиц снимаются с живой базы:

```
DDL → bun run db:up → bun run db:pull → писать код
```

`db:pull` гоняет `drizzle-kit pull` (casing `preserve`, только `public`,
без `schema_migrations`), удаляет timestamped SQL-снимок, который kit
кладёт рядом, и прогоняет biome по `schema.ts` / `relations.ts`.

Без живой базы pull невозможен. `graphile_worker` в схему не входит —
его поднимает worker в рантайме.

## Где что живёт

| Путь | Что |
|---|---|
| `packages/shared/src/utils/db.ts` | `new SQL({ url: env.PGURI })`, `db`, `sql`, `sqlValues`, `sqlIn` |
| `packages/shared/src/db/schema.ts` | таблицы и enum, результат pull |
| `packages/shared/src/db/relations.ts` | связи pull |
| `drizzle.config.ts` | dialect, `PGURI`, `introspect.casing: preserve` |
| `scripts/db-pull.ts` | локальный/CI pull; в образ сервиса не копируется |

`schema.ts` руками не правят: следующий pull затрёт. Исключение — если
kit снял `bigint` без `{ mode: 'number' }`; это нужно вернуть, иначе
int8 станет `bigint` в TS.

## Вызов

```ts
import { db, sql, type Executor } from '#src/utils/db'
import { matches } from '#src/db/schema'
import { eq } from 'drizzle-orm'

const rows = await db.execute(sql`
  SELECT match_id FROM matches WHERE league_id = ${leagueId}
`)

const [match] = await db
  .select()
  .from(matches)
  .where(eq(matches.match_id, matchId))
  .limit(1)
```

`select()` идёт через схему: `bigint({ mode: 'number' })` даёт `number`.
`execute(sql\`…\`)` — сырой драйвер: int8 вне i32 приходит строкой
(у bun.sql `bigint: false` по умолчанию). Там, где нужен number, —
`Number(row.match_id)` или query builder.

Транзакция:

```ts
await db.transaction(async (tx) => {
  await upsertTeam(tx, teamId, name)
  await tx.execute(sql`UPDATE matches SET …`)
})
```

`tx` и `db` имеют один интерфейс (`Executor`). Внутри колбэка только
`tx`: запрос на `db` уйдёт мимо транзакции молча.

## Плейсхолдеры

Drizzle **опускает** `undefined` как SQL-чанк, а не биндит NULL. Для
SQL NULL всегда `?? null`.

Массив в `ANY($1::bigint[])` через `execute` ненадёжен — список через
`sqlIn`:

```ts
sql`WHERE match_id IN ${sqlIn(matchIds)}`
```

Bulk INSERT с `ON CONFLICT` — `sqlValues(rows)` (колонки из ключей
первой строки, VALUES-кортежи):

```ts
await tx.execute(sql`
  INSERT INTO match_draft ${sqlValues(rows)}
  ON CONFLICT (match_id, ord) DO NOTHING
`)
```

Имена колонок идут через `sql.identifier`, в том числе зарезервированные
(`key`). JSON в SQL — `JSON.stringify(payload)`, не отдельный хелпер.

Закрытие пула на shutdown: `await db.$client.end({ timeout: 5 })`.

## Тесты против живой базы

Тестовой базы нет: пакеты ходят в ту же dev-базу. Запуск из каталога
пакета — `bun run test` (`--env-file=../../.env`, `NODE_ENV=development`).
Прямой `bun test <файл>` окружение не подхватывает.

Фикстура каждого теста своя (`beforeAll` самого теста), мутации —
с фильтром по своему ключу, не по всей таблице.
