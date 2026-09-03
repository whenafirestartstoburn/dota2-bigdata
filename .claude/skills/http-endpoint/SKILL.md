---
name: http-endpoint
description: Используется при добавлении или изменении HTTP-эндпоинта — Bun.serve, объект routes, http.ts, Zod, CORS_ORIGINS.
---

# HTTP-эндпоинт на Bun.serve

Сервер — встроенный `Bun.serve`, без Fastify и без oRPC. Процесс живёт в
`packages/api/src/app.ts`. Новые пути **не** дописывают в `app.ts`: их
кладут в таблицу `routes` в `packages/api/src/routes.ts`.

| Файл | Что |
|---|---|
| `src/app.ts` | `Bun.serve`, `/healthz`, shutdown |
| `src/http.ts` | `json`, `readJson`, `methods`, CORS, `HttpError` |
| `src/routes.ts` | ключ = путь, значение = `{ GET, POST, OPTIONS }` |

Пример формы, который блок кладёт в `routes.ts`:

```
GET  /healthz
GET  /api/health
GET  /api/echo/:id
POST /api/echo/:id   { "message": "..." }
```

## Новый путь

```ts
'/api/items/:id': methods({
	GET: async (request) => {
		const id = (request as RoutedRequest).params.id
		if (id === undefined) {
			return json(request, { error: 'not found' }, 404)
		}
		return json(request, { id })
	},
	POST: async (request) => {
		try {
			const parsed = bodySchema.safeParse(await readJson(request))
			if (!parsed.success) {
				return json(
					request,
					{ error: z.prettifyError(parsed.error) },
					400,
				)
			}
			return json(request, parsed.data, 201)
		} catch (error) {
			return handleError(request, error)
		}
	},
}),
```

`methods({...})` добавляет `OPTIONS` для CORS. Origin сверяется с
`CORS_ORIGINS`. Пустой список — ни одного чужого origin.

Параметр пути — `request.params` на совпавшем маршруте (`RoutedRequest` из
`http.ts`). При `noUncheckedIndexedAccess` поле — `string | undefined`.

Ошибка с понятным статусом — `throw new HttpError(404, 'not found')` внутри
`try/catch`, который зовёт `handleError`. Timestamps из SQL — `asIso` из
`@app/shared/src/store/coerce`, не локальный `function asIso`.

`.test.ts` в `routes.ts` не кладут.

Если в проекте есть блок `postgres`, запросы к базе — по скиллу
`drizzle-query`. Этот скилл Postgres не утверждает: блок `api` его не
тянет.
