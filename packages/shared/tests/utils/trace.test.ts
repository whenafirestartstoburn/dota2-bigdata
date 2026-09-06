import { describe, expect, test } from 'bun:test'
import {
	currentTrace,
	newTraceId,
	runWithTrace,
	traceIdFromRequest,
} from '#src/utils/trace'

describe('trace', () => {
	test('newTraceId is a UUID', () => {
		expect(newTraceId()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		)
	})

	test('runWithTrace sets currentTrace for the callback', () => {
		expect(currentTrace()).toBeUndefined()
		const seen = runWithTrace({ trace_id: 't1', job: 'poll_live_games' }, () =>
			currentTrace(),
		)
		expect(seen).toEqual({ trace_id: 't1', job: 'poll_live_games' })
		expect(currentTrace()).toBeUndefined()
	})

	test('traceIdFromRequest prefers x-trace-id', () => {
		const request = new Request('http://x.test', {
			headers: {
				'x-request-id': 'req',
				'x-trace-id': 'trc',
			},
		})
		expect(traceIdFromRequest(request)).toBe('trc')
	})
})
