import { type ClickHouseClient, createClient } from '@clickhouse/client'
import env from '#src/utils/env'

export const clickhouse: ClickHouseClient = createClient({
	url: env.CLICKHOUSE_URL,
	username: env.CLICKHOUSE_USER,
	password: env.CLICKHOUSE_PASSWORD,
	database: env.CLICKHOUSE_DATABASE,
	clickhouse_settings: {
		async_insert: 1,
		wait_for_async_insert: 1,
	},
})

export async function insertJsonEachRow(
	table: string,
	rows: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
	if (rows.length === 0) return
	await clickhouse.insert({
		table,
		values: rows,
		format: 'JSONEachRow',
	})
}

export async function pingClickhouse(): Promise<boolean> {
	try {
		const result = await clickhouse.ping()
		return result.success
	} catch {
		return false
	}
}
