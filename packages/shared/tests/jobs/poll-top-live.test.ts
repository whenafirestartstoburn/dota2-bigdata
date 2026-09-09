import { describe, expect, test } from 'bun:test'
import { proTopLiveMatchId } from '#src/jobs/poll-top-live'

describe('proTopLiveMatchId', () => {
	test('keeps league games and drops pubs / missing ids', () => {
		expect(proTopLiveMatchId({ match_id: 8_412_001, league_id: 15728 })).toBe(
			8_412_001,
		)
		expect(proTopLiveMatchId({ match_id: '8412002', league_id: 1 })).toBe(
			8_412_002,
		)
		expect(proTopLiveMatchId({ match_id: 8_412_003, league_id: 0 })).toBeNull()
		expect(proTopLiveMatchId({ match_id: 0, league_id: 15728 })).toBeNull()
		expect(proTopLiveMatchId({ match_id: null, league_id: 15728 })).toBeNull()
	})
})
