import { afterAll, describe, expect, test } from 'bun:test'
import {
	joinObjectPrefix,
	resolveArchiveDestination,
} from '#src/components/archive-dest'
import type { ObjectStore } from '#src/components/s3'
import { runArchiveParsedReplays } from '#src/jobs/archive-parsed-replays'
import { getReplay } from '#src/store/replays'
import { db, sql } from '#src/utils/db'
import env from '#src/utils/env'
import { parseObjectLocation } from '#src/utils/object-location'

const MATCH_ID = 9_900_070_001
const HOT_KEY = `replays/${MATCH_ID}/${MATCH_ID}_1.dem.bz2`

async function cleanup(): Promise<void> {
	await db.execute(sql`DELETE FROM matches WHERE match_id = ${MATCH_ID}`)
}

afterAll(cleanup)

function fakeStore(bucket: string): ObjectStore {
	return {
		kind: 's3',
		bucket,
		async write() {},
		async stat() {
			return { size: 12 }
		},
		file() {
			return {
				async bytes() {
					return new Uint8Array()
				},
			}
		},
		async delete() {},
	}
}

describe('runArchiveParsedReplays', () => {
	test('copies a parsed replay to the archive prefix and stamps archived_at', async () => {
		await cleanup()
		const resolved = resolveArchiveDestination({
			hotBucket: env.S3_BUCKET,
			archiveBucket: env.S3_ARCHIVE_BUCKET,
			prefix: env.S3_ARCHIVE_PREFIX,
			storageClass: env.S3_ARCHIVE_STORAGE_CLASS,
		})
		if (!resolved.ok) {
			throw new Error(resolved.reason)
		}
		const destKey = joinObjectPrefix(resolved.dest.prefix, HOT_KEY)
		const hotBucket = parseObjectLocation(env.S3_BUCKET).bucket
		const copies: string[] = []
		const deletes: string[] = []
		const objects = new Set([`${hotBucket}:${HOT_KEY}`])

		await db.execute(sql`
			INSERT INTO matches (match_id, status)
			VALUES (${MATCH_ID}, 'parsed'::match_status)
		`)
		await db.execute(sql`
			INSERT INTO match_replays (
				match_id, status, s3_bucket, s3_key, parsed_at
			)
			VALUES (
				${MATCH_ID},
				'parsed'::replay_status,
				${hotBucket},
				${HOT_KEY},
				now()
			)
		`)

		const result = await runArchiveParsedReplays(
			{
				sourceStore: (bucket) => fakeStore(bucket),
				destStore: () => fakeStore(resolved.dest.bucket),
				async exists(store, key) {
					return objects.has(`${store.bucket}:${key}`)
				},
				async copy(input) {
					copies.push(`${input.srcKey}->${input.destKey}`)
					objects.add(`${input.dest.bucket}:${input.destKey}`)
				},
				async delete(store, key) {
					deletes.push(`${store.bucket}:${key}`)
					objects.delete(`${store.bucket}:${key}`)
				},
			},
			{ matchId: MATCH_ID },
		)

		expect(result.skipped).toBe(false)
		expect(result.archived).toBe(1)
		expect(copies).toEqual([`${HOT_KEY}->${destKey}`])
		expect(deletes).toEqual([`${hotBucket}:${HOT_KEY}`])
		const row = await getReplay(MATCH_ID)
		expect(row?.s3_key).toBe(destKey)
		expect(row?.s3_bucket).toBe(resolved.dest.bucket)
		expect(row?.archived_at).not.toBeNull()
	})
})
