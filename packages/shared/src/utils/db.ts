import { SQL } from 'bun'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sql'
import { relations } from '#src/db/relations'
import env from '#src/utils/env'

export { sql }

const client = new SQL({
	url: env.PGURI,
	max: 8,
	connectionTimeout: 10,
	tls: 'disable',
})

export const db = drizzle({ client, relations })

export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Executor = Db | Tx

function sqlCell(value: unknown): ReturnType<typeof sql> {
	if (Array.isArray(value)) {
		if (value.length === 0) return sql`'{}'::integer[]`
		return sql`ARRAY[${sql.join(
			value.map((item) => sql`${item ?? null}`),
			sql`, `,
		)}]::integer[]`
	}
	return sql`${value ?? null}`
}

/** Column list + VALUES tuples for a bulk INSERT. */
export function sqlValues(
	rows: ReadonlyArray<Record<string, unknown>>,
): ReturnType<typeof sql> {
	const first = rows[0]
	if (first === undefined) {
		throw new Error('sqlValues: empty')
	}
	const keys = Object.keys(first)
	const cols = sql.join(
		keys.map((key) => sql.identifier(key)),
		sql`, `,
	)
	const tuples = rows.map(
		(row) =>
			sql`(${sql.join(
				keys.map((key) => sqlCell(row[key])),
				sql`, `,
			)})`,
	)
	return sql`(${cols}) VALUES ${sql.join(tuples, sql`, `)}`
}

export function sqlIn(
	values: readonly (string | number)[],
): ReturnType<typeof sql> {
	if (values.length === 0) return sql`(NULL)`
	return sql`(${sql.join(
		values.map((value) => sql`${value}`),
		sql`, `,
	)})`
}
