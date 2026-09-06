import { afterAll, describe, expect, test } from 'bun:test'
import { asNumber } from '#src/store/coerce'
import { pickNextHistoryLeague } from '#src/store/leagues'
import { db, sql } from '#src/utils/db'

const OLD_ID = 2_000_000_001
const NEW_ID = 2_000_000_002
const ACTIVITY = 2_147_000_000

async function cleanup(): Promise<void> {
	await db.execute(sql`
		DELETE FROM leagues WHERE league_id IN (${OLD_ID}, ${NEW_ID})
	`)
}

afterAll(cleanup)

describe('pickNextHistoryLeague', () => {
	test('never-walked leagues go newest-id first when activity ties', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO leagues (
				league_id, name, status, most_recent_activity, start_timestamp
			) VALUES
				(${OLD_ID}, 'old fixture', 'FINISHED', ${ACTIVITY}, ${ACTIVITY}),
				(${NEW_ID}, 'new fixture', 'FINISHED', ${ACTIVITY}, ${ACTIVITY})
		`)
		const row = await pickNextHistoryLeague(86_400_000)
		expect(asNumber(row?.league_id)).toBe(NEW_ID)
	})
})
