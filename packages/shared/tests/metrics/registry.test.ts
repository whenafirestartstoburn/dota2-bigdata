import { afterEach, describe, expect, test } from 'bun:test'
import {
	classifyGcLogon,
	classifyGcRequest,
	classifyHttpStatus,
	classifyWebApiError,
	historyWalkMatches,
	observeHistoryWalk,
	observeMarketplaceOrder,
	observeWebApi,
	webapiRequests,
} from '#src/metrics/observe'
import {
	Counter,
	formatLabels,
	Gauge,
	Histogram,
	renderMetrics,
	resetMetrics,
} from '#src/metrics/registry'

function errorWith(
	name: string,
	message: string,
	status?: number,
): Error & { status?: number } {
	const error = new Error(message) as Error & { status?: number }
	error.name = name
	if (status != null) error.status = status
	return error
}

const testRequests = new Counter('test_requests_total', 'calls', ['result'])
const testQueue = new Gauge('test_queue', 'rows', ['status'])
const testDuration = new Histogram(
	'test_duration_seconds',
	'latency',
	['method'],
	[0.1, 0.5, 1],
)

afterEach(() => {
	resetMetrics()
})

describe('prometheus text', () => {
	test('escapes label values', () => {
		expect(formatLabels({ path: 'a="b"\\c' })).toBe('{path="a=\\"b\\"\\\\c"}')
	})

	test('renders counter, gauge, and cumulative histogram', () => {
		testRequests.inc({ result: 'ok' }, 2)
		testQueue.set({ status: 'stored' }, 4)
		testDuration.observe({ method: 'GetLiveLeagueGames' }, 0.2)
		testDuration.observe({ method: 'GetLiveLeagueGames' }, 0.8)
		const text = renderMetrics()
		expect(text).toContain('# TYPE test_requests_total counter')
		expect(text).toContain('test_requests_total{result="ok"} 2')
		expect(text).toContain('test_queue{status="stored"} 4')
		expect(text).toContain(
			'test_duration_seconds_bucket{le="0.1",method="GetLiveLeagueGames"} 0',
		)
		expect(text).toContain(
			'test_duration_seconds_bucket{le="0.5",method="GetLiveLeagueGames"} 1',
		)
		expect(text).toContain(
			'test_duration_seconds_bucket{le="1",method="GetLiveLeagueGames"} 2',
		)
		expect(text).toContain(
			'test_duration_seconds_bucket{le="+Inf",method="GetLiveLeagueGames"} 2',
		)
		expect(text).toContain(
			'test_duration_seconds_count{method="GetLiveLeagueGames"} 2',
		)
	})

	test('inventory gauges have no series until a scrape fills them', () => {
		resetMetrics()
		const text = renderMetrics()
		expect(text).toContain('# TYPE dota_matches gauge')
		expect(text).not.toContain('dota_matches{')
		expect(text).not.toContain('dota_replays{')
	})

	test('seeds idle GC series at zero', () => {
		resetMetrics()
		const text = renderMetrics()
		expect(text).toContain(
			'dota_gc_requests_total{method="match_details",result="success"} 0',
		)
		expect(text).toContain('dota_gc_logons_total{result="success"} 0')
		expect(text).toContain(
			'dota_gc_request_duration_seconds_count{method="match_details"} 0',
		)
		expect(text).toContain('dota_gc_session_up 0')
		expect(text).toContain('dota_history_walk_matches_total 0')
		expect(text).toContain('dota_history_walk_pages_total{result="hits"} 0')
	})

	test('observeWebApi increments the catalog counter', () => {
		observeWebApi('steam', 'GetLiveLeagueGames', 'http_429', 0)
		expect(
			webapiRequests.get({
				source: 'steam',
				method: 'GetLiveLeagueGames',
				result: 'http_429',
			}),
		).toBe(1)
		observeMarketplaceOrder('dark_shopping', 'gc', 'success')
		expect(renderMetrics()).toContain(
			'dota_marketplace_orders_total{kind="gc",status="success",store="dark_shopping"} 1',
		)
		observeHistoryWalk({ listed: 32, result: 'hits' })
		expect(historyWalkMatches.get()).toBe(32)
		expect(renderMetrics()).toContain(
			'dota_history_walk_pages_total{result="hits"} 1',
		)
	})
})

describe('result classification', () => {
	test('maps HTTP statuses and Steam errors', () => {
		expect(classifyHttpStatus(403)).toBe('http_403')
		expect(classifyHttpStatus(429)).toBe('http_429')
		expect(classifyHttpStatus(503)).toBe('http_5xx')
		expect(classifyHttpStatus(400)).toBe('http_4xx')
		expect(
			classifyWebApiError(errorWith('SteamApiError', 'steam HTTP 403', 403)),
		).toBe('http_403')
		expect(
			classifyWebApiError(
				errorWith('SteamApiError', 'GetLiveLeagueGames: unexpected shape'),
			),
		).toBe('parse')
		expect(
			classifyWebApiError(
				errorWith('PublicMatchError', 'server hosts public match 1'),
			),
		).toBe('public_match')
		expect(classifyWebApiError(new Error('The operation timed out'))).toBe(
			'timeout',
		)
	})

	test('maps GC failures', () => {
		expect(classifyGcRequest(new Error('GC match details timeout for 1'))).toBe(
			'timeout',
		)
		expect(
			classifyGcRequest(
				new Error('no usable Steam account for GC — need a ready account'),
			),
		).toBe('no_account')
		expect(classifyGcLogon(new Error('InvalidPassword'))).toBe(
			'invalid_password',
		)
		expect(classifyGcLogon(new Error('timeout waiting for Dota GC'))).toBe(
			'timeout',
		)
	})
})
