import { afterAll, describe, expect, test } from 'bun:test'
import {
	adoptExistingReplayObject,
	replayHotKey,
} from '#src/jobs/adopt-replay-object'
import { getReplay } from '#src/store/replays'
import { db, sql } from '#src/utils/db'

const MATCH_ID = 9_900_070_101

async function cleanup(): Promise<void> {
	await db.execute(sql`DELETE FROM matches WHERE match_id = ${MATCH_ID}`)
}

afterAll(cleanup)

describe('replayHotKey', () => {
	test('uses the canonical hot key when salt is known', () => {
		expect(
			replayHotKey(5240837699, { cluster: 236, replay_salt: 264754241 }),
		).toBe('replays/5240837699/5240837699_264754241.dem.bz2')
	})

	test('falls back to the row locator when salt is missing', () => {
		expect(replayHotKey(1, { s3_key: 'cold/replays/1/1_2.dem.bz2' })).toBe(
			'cold/replays/1/1_2.dem.bz2',
		)
	})

	test('is null when neither salt nor key is present', () => {
		expect(replayHotKey(1, { status: 'pending' })).toBeNull()
	})
})

describe('adoptExistingReplayObject', () => {
	test('promotes a pending row to stored on a hot hit', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO matches (match_id, status)
			VALUES (${MATCH_ID}, 'details_ready'::match_status)
		`)
		await db.execute(sql`
			INSERT INTO match_replays (
				match_id, status, cluster, replay_salt
			)
			VALUES (
				${MATCH_ID}, 'pending'::replay_status, 236, 264754241
			)
		`)
		const row = await getReplay(MATCH_ID)
		const adopted = await adoptExistingReplayObject(
			MATCH_ID,
			row,
			async () => ({
				bucket: 'hot-bucket',
				key: 'replays/9900070101/9900070101_264754241.dem.bz2',
				archived: false,
			}),
		)
		expect(adopted?.kept).toBe(false)
		expect(adopted?.hit.archived).toBe(false)
		const after = await getReplay(MATCH_ID)
		expect(after?.status).toBe('stored')
		expect(after?.s3_bucket).toBe('hot-bucket')
		expect(after?.archived_at).toBeNull()
	})

	test('keeps parsed status and the existing locator', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO matches (match_id, status)
			VALUES (${MATCH_ID}, 'parsed'::match_status)
		`)
		await db.execute(sql`
			INSERT INTO match_replays (
				match_id, status, cluster, replay_salt, s3_bucket, s3_key
			)
			VALUES (
				${MATCH_ID},
				'parsed'::replay_status,
				236,
				264754241,
				'cold-bucket',
				'cold/replays/9900070101/9900070101_264754241.dem.bz2'
			)
		`)
		const row = await getReplay(MATCH_ID)
		const adopted = await adoptExistingReplayObject(
			MATCH_ID,
			row,
			async () => ({
				bucket: 'cold-bucket',
				key: 'cold/replays/9900070101/9900070101_264754241.dem.bz2',
				archived: true,
			}),
		)
		expect(adopted?.kept).toBe(true)
		const after = await getReplay(MATCH_ID)
		expect(after?.status).toBe('parsed')
		expect(after?.s3_key).toBe(
			'cold/replays/9900070101/9900070101_264754241.dem.bz2',
		)
	})

	test('keeps archived_at on a cold hit', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO matches (match_id, status)
			VALUES (${MATCH_ID}, 'details_ready'::match_status)
		`)
		await db.execute(sql`
			INSERT INTO match_replays (
				match_id, status, cluster, replay_salt, archived_at
			)
			VALUES (
				${MATCH_ID},
				'pending'::replay_status,
				236,
				264754241,
				now()
			)
		`)
		const row = await getReplay(MATCH_ID)
		await adoptExistingReplayObject(MATCH_ID, row, async () => ({
			bucket: 'cold-bucket',
			key: 'cold/replays/9900070101/9900070101_264754241.dem.bz2',
			archived: true,
		}))
		const after = await getReplay(MATCH_ID)
		expect(after?.status).toBe('stored')
		expect(after?.s3_bucket).toBe('cold-bucket')
		expect(after?.archived_at).not.toBeNull()
	})

	test('returns null when the object is not in storage', async () => {
		await cleanup()
		await db.execute(sql`
			INSERT INTO matches (match_id, status)
			VALUES (${MATCH_ID}, 'details_ready'::match_status)
		`)
		await db.execute(sql`
			INSERT INTO match_replays (match_id, status, cluster, replay_salt)
			VALUES (${MATCH_ID}, 'pending'::replay_status, 236, 264754241)
		`)
		const row = await getReplay(MATCH_ID)
		const adopted = await adoptExistingReplayObject(
			MATCH_ID,
			row,
			async () => null,
		)
		expect(adopted).toBeNull()
		expect((await getReplay(MATCH_ID))?.status).toBe('pending')
	})
})
