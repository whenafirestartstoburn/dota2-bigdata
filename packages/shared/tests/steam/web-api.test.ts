import { describe, expect, test } from 'bun:test'
import { replayUrl, unpublishedReplayCdnReason } from '#src/steam/web-api'

describe('replayUrl', () => {
	test('builds the Valve CDN path from cluster, match id, and salt', () => {
		expect(replayUrl(236, 5240837699, 264754241)).toBe(
			'http://replay236.valve.net/570/5240837699_264754241.dem.bz2',
		)
	})

	test('cluster 0/1 have no Valve CDN host', () => {
		expect(unpublishedReplayCdnReason(1)).toMatch(/cluster 1/)
		expect(unpublishedReplayCdnReason(0)).toMatch(/cluster 0/)
		expect(unpublishedReplayCdnReason(236)).toBeNull()
		expect(
			unpublishedReplayCdnReason(
				236,
				'http://replay1.valve.net/570/1_2.dem.bz2',
			),
		).toMatch(/replay1\.valve\.net/)
	})
})
