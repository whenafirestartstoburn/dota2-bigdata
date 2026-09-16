import { describe, expect, test } from 'bun:test'
import {
	joinObjectPrefix,
	resolveArchiveDestination,
} from '#src/components/archive-dest'
import {
	objectBucket,
	replayObjectCandidates,
	replayObjectKey,
} from '#src/components/s3'
import env from '#src/utils/env'
import { parseObjectLocation } from '#src/utils/object-location'

describe('replayObjectKey', () => {
	test('matches the S3 layout used by download_replay', () => {
		expect(replayObjectKey(5240837699, 236, 264754241)).toBe(
			'replays/5240837699/5240837699_264754241.dem.bz2',
		)
	})
})

describe('replayObjectCandidates', () => {
	const hotKey = 'replays/1/1_2.dem.bz2'
	const hotBucket = objectBucket()
	const resolved = resolveArchiveDestination({
		hotBucket: env.S3_BUCKET,
		archiveBucket: env.S3_ARCHIVE_BUCKET,
		prefix: env.S3_ARCHIVE_PREFIX,
		storageClass: env.S3_ARCHIVE_STORAGE_CLASS,
	})

	test('checks the row locator, then hot, then cold', () => {
		if (!resolved.ok) throw new Error(resolved.reason)
		const destKey = joinObjectPrefix(resolved.dest.prefix, hotKey)
		const hits = replayObjectCandidates(hotKey, {
			bucket: resolved.dest.bucket,
			key: destKey,
		})
		expect(hits[0]).toEqual({
			bucket: resolved.dest.bucket,
			key: destKey,
			archived: true,
		})
		expect(hits).toContainEqual({
			bucket: hotBucket,
			key: hotKey,
			archived: false,
		})
		expect(hits.filter((h) => h.archived)).toHaveLength(1)
	})

	test('hot-only row still lists the cold archive key', () => {
		if (!resolved.ok) throw new Error(resolved.reason)
		const destKey = joinObjectPrefix(resolved.dest.prefix, hotKey)
		const hits = replayObjectCandidates(hotKey)
		expect(hits[0]).toEqual({
			bucket: hotBucket,
			key: hotKey,
			archived: false,
		})
		expect(hits).toContainEqual({
			bucket: resolved.dest.bucket,
			key: destKey,
			archived: true,
		})
	})
})

describe('parseObjectLocation', () => {
	test('reads a gs:// bucket and ignores a trailing slash', () => {
		expect(parseObjectLocation('gs://dl-dota2-demos/')).toEqual({
			kind: 'gcs',
			bucket: 'dl-dota2-demos',
		})
	})

	test('keeps a plain name on the S3 API', () => {
		expect(parseObjectLocation('datalouna-dota-replays')).toEqual({
			kind: 's3',
			bucket: 'datalouna-dota-replays',
		})
	})
})
