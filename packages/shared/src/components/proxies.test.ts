import { afterAll, describe, expect, test } from 'bun:test'
import { MissingProxyError } from '#src/steam/http'
import { db, sql } from '#src/utils/db'
import {
	isProxyTransportError,
	markProxyUnavailable,
	NoUsableProxyError,
	pickReadyProxy,
	proxyHostPort,
	proxyUrlWithScheme,
	upsertProxy,
} from './proxies'

const PREFIX = `test-proxy-${Date.now()}`

afterAll(async () => {
	await db.execute(sql`DELETE FROM proxies WHERE name LIKE ${`${PREFIX}%`}`)
})

describe('proxy url helpers', () => {
	test('adds and rewrites the scheme to match kind', () => {
		expect(proxyUrlWithScheme('user:pass@gw.example:10000', 'socks5')).toBe(
			'socks5://user:pass@gw.example:10000',
		)
		expect(
			proxyUrlWithScheme('http://user:pass@gw.example:10005', 'http'),
		).toBe('http://user:pass@gw.example:10005')
		expect(
			proxyUrlWithScheme('http://user:pass@gw.example:10000', 'socks5'),
		).toBe('socks5://user:pass@gw.example:10000')
	})

	test('proxyHostPort strips credentials', () => {
		expect(proxyHostPort('socks5://user:pass@gw.example:10000')).toBe(
			'gw.example:10000',
		)
	})
})

describe('isProxyTransportError', () => {
	test('detects proxy/SOCKS/connect failures, not Steam HTTP or GC welcome', () => {
		expect(isProxyTransportError(new Error('SOCKS connection failed'))).toBe(
			true,
		)
		expect(isProxyTransportError(new Error('Proxy connection timed out'))).toBe(
			true,
		)
		expect(isProxyTransportError(new Error('proxy HTTP 407'))).toBe(true)
		expect(isProxyTransportError(new Error('getaddrinfo ENOTFOUND host'))).toBe(
			true,
		)
		expect(
			isProxyTransportError(
				new Error('Unable to connect. Is the computer able to access the url?'),
			),
		).toBe(true)
		expect(
			isProxyTransportError(new Error('timeout waiting for Dota GC welcome')),
		).toBe(false)
		expect(isProxyTransportError(new Error('steam HTTP 429'))).toBe(false)
		expect(isProxyTransportError(new Error('steam HTTP 403'))).toBe(false)
		expect(isProxyTransportError(new NoUsableProxyError())).toBe(false)
		expect(isProxyTransportError(new MissingProxyError())).toBe(false)
	})
})

describe('proxy pool against live db', () => {
	test('pick skips a proxy after it is marked unavailable', async () => {
		const a = await upsertProxy({
			name: `${PREFIX}-a`,
			url: `http://test:${PREFIX}@127.0.0.1:19001`,
			kind: 'http',
			purpose: 'both',
		})
		const b = await upsertProxy({
			name: `${PREFIX}-b`,
			url: `http://test:${PREFIX}@127.0.0.1:19002`,
			kind: 'http',
			purpose: 'both',
		})
		await markProxyUnavailable(a.id, 'fixture dead')
		const picked = await pickReadyProxy('api')
		expect(picked.id).not.toBe(a.id)
		expect(b.id).toBeGreaterThan(0)
	})
})
