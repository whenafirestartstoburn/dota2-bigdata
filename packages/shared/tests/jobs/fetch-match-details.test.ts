import { describe, expect, test } from 'bun:test'
import { matchOrigin } from '#src/jobs/fetch-match-details'

describe('matchOrigin', () => {
	test('only the live source stays live; everything else is historical', () => {
		expect(matchOrigin('live')).toBe('live')
		expect(matchOrigin('historical')).toBe('historical')
		expect(matchOrigin(undefined)).toBe('historical')
		expect(matchOrigin('GetLiveLeagueGames')).toBe('historical')
	})
})
