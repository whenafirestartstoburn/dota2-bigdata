import { describe, expect, test } from 'bun:test'
import { replayUrl } from './web-api'

describe('replayUrl', () => {
	test('builds the Valve CDN path from cluster, match id, and salt', () => {
		expect(replayUrl(236, 5240837699, 264754241)).toBe(
			'http://replay236.valve.net/570/5240837699_264754241.dem.bz2',
		)
	})
})
