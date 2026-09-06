import { describe, expect, test } from 'bun:test'
import { replayObjectKey } from '#src/components/s3'

describe('replayObjectKey', () => {
	test('matches the S3 layout used by download_replay', () => {
		expect(replayObjectKey(5240837699, 236, 264754241)).toBe(
			'replays/5240837699/5240837699_264754241.dem.bz2',
		)
	})
})
