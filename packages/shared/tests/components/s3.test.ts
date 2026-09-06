import { describe, expect, test } from 'bun:test'
import { replayObjectKey } from '#src/components/s3'
import { parseObjectLocation } from '#src/utils/object-location'

describe('replayObjectKey', () => {
	test('matches the S3 layout used by download_replay', () => {
		expect(replayObjectKey(5240837699, 236, 264754241)).toBe(
			'replays/5240837699/5240837699_264754241.dem.bz2',
		)
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
