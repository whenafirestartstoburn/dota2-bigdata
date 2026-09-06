import { describe, expect, test } from 'bun:test'
import {
	confirmationForRequestId,
	confirmationParams,
	confirmationsToAccept,
	describeConfirmation,
	mobileAccessCookies,
	parseApiKeyFromHtml,
	parseConfirmationList,
	parseRequestKeyResponse,
	parseSteamJson,
	requestKeyForm,
	type SteamConfirmation,
	SteamConfirmationError,
	toCookieHeader,
} from '#src/steam/confirmations'
import { generateConfirmationKey, getDeviceId } from '#src/steam/totp'

const SAMPLE = 'cnOgv/KdpLoP6Nbh0GMkXkPXALQ='
const STEAM_ID = '76561198000000000'

describe('confirmationParams', () => {
	test('signs with identity_secret and the enrollment device id', () => {
		const time = 1_700_000_000
		const params = confirmationParams({
			steamId: STEAM_ID,
			identitySecret: SAMPLE,
			time,
			tag: 'conf',
		})
		expect(params.get('a')).toBe(STEAM_ID)
		expect(params.get('p')).toBe(getDeviceId(STEAM_ID))
		expect(params.get('t')).toBe(String(time))
		expect(params.get('m')).toBe('react')
		expect(params.get('tag')).toBe('conf')
		expect(params.get('k')).toBe(generateConfirmationKey(SAMPLE, time, 'conf'))
		expect(params.get('k')).toBe('rg8+26IBS5hk1/7h3/YbOD175r0=')
	})

	test('puts allow extras on the query', () => {
		const params = confirmationParams({
			steamId: STEAM_ID,
			identitySecret: SAMPLE,
			time: 1_700_000_000,
			tag: 'accept',
			extra: { op: 'allow', cid: '99', ck: 'nonce' },
		})
		expect(params.get('op')).toBe('allow')
		expect(params.get('cid')).toBe('99')
		expect(params.get('ck')).toBe('nonce')
		expect(params.get('tag')).toBe('accept')
		expect(params.get('k')).toBe(
			generateConfirmationKey(SAMPLE, 1_700_000_000, 'accept'),
		)
	})

	test('signs getlist with tag=list like the iOS app', () => {
		const params = confirmationParams({
			steamId: STEAM_ID,
			identitySecret: SAMPLE,
			time: 1_700_000_000,
			tag: 'list',
		})
		expect(params.get('tag')).toBe('list')
		expect(params.get('m')).toBe('react')
		expect(params.get('k')).toBe(
			generateConfirmationKey(SAMPLE, 1_700_000_000, 'list'),
		)
	})
})

describe('parseConfirmationList', () => {
	test('maps a mobileconf getlist payload', () => {
		const confs = parseConfirmationList({
			success: true,
			conf: [
				{
					id: '42',
					nonce: 'abc',
					type: 6,
					type_name: 'Register API Key',
					headline: 'Steam Web API',
					creator_id: '1',
					creation_time: 1_700_000_000,
				},
			],
		})
		expect(confs).toEqual([
			{
				id: '42',
				nonce: 'abc',
				type: 6,
				typeName: 'Register API Key',
				headline: 'Steam Web API',
				creatorId: '1',
				creationTime: 1_700_000_000,
			},
		])
		expect(describeConfirmation(confs[0]!)).toBe(
			'#42 Register API Key — Steam Web API',
		)
	})

	test('empty conf is no pending confirmations', () => {
		expect(parseConfirmationList({ success: true })).toEqual([])
		expect(parseConfirmationList({ success: true, conf: [] })).toEqual([])
	})

	test('needauth and success:false throw', () => {
		expect(() => parseConfirmationList({ needauth: true })).toThrow(
			SteamConfirmationError,
		)
		expect(() =>
			parseConfirmationList({ success: false, message: 'nope' }),
		).toThrow('nope')
	})
})

describe('confirmationsToAccept', () => {
	const apiKey = (id: string, creationTime: number): SteamConfirmation => ({
		id,
		nonce: id,
		type: 9,
		typeName: 'Register API Key',
		headline: 'Authorize a developer API Key with access to your account',
		creatorId: id,
		creationTime,
	})

	test('keeps the newest Register API Key request and skips older ones', () => {
		const older = apiKey('21707318832', 100)
		const newer = apiKey('21707354257', 200)
		const { accept, skipped } = confirmationsToAccept([newer, older])
		expect(accept.map((item) => item.id)).toEqual(['21707354257'])
		expect(skipped.map((item) => item.id)).toEqual(['21707318832'])
	})
})

describe('confirmationForRequestId', () => {
	const apiKey = (id: string, creatorId: string): SteamConfirmation => ({
		id,
		nonce: id,
		type: 9,
		typeName: 'Register API Key',
		headline: 'Authorize a developer API Key with access to your account',
		creatorId,
		creationTime: 1,
	})

	test('matches Register API Key by creator_id even when older requests exist', () => {
		const requestId = '4503369671282782438'
		const older = apiKey('1', '111')
		const match = apiKey('2', requestId)
		expect(confirmationForRequestId([older, match], requestId)).toEqual(match)
	})

	test('falls back to the only API key confirmation when creator_id is missing', () => {
		const only = apiKey('2', '')
		only.creatorId = null
		expect(confirmationForRequestId([only], '4503369671282782438')).toEqual(
			only,
		)
	})
})

describe('parseSteamJson', () => {
	test('keeps a 19-digit request_id that JSON.parse would round', () => {
		const raw = '{"success":22,"request_id":4503369671282782438}'
		const rounded = String(
			(JSON.parse(raw) as { request_id: number }).request_id,
		)
		expect(rounded).not.toBe('4503369671282782438')
		const parsed = parseSteamJson(raw) as {
			success: number
			request_id: string
		}
		expect(parsed.success).toBe(22)
		expect(parsed.request_id).toBe('4503369671282782438')
	})

	test('leaves an already-quoted request_id as a string', () => {
		const parsed = parseSteamJson(
			'{"success":22,"request_id":"4503369671282782438"}',
		) as { request_id: string }
		expect(parsed.request_id).toBe('4503369671282782438')
	})

	test('keeps GetTopLiveGame server_steam_id that JSON.parse would round', () => {
		const raw = '{"server_steam_id":90292220717473792,"league_id":19944}'
		const parsed = parseSteamJson(raw) as {
			server_steam_id: string
			league_id: number
		}
		expect(parsed.server_steam_id).toBe('90292220717473792')
		expect(parsed.league_id).toBe(19944)
	})
})

describe('parseRequestKeyResponse', () => {
	test('maps the pending Register response from steamcommunity /dev/requestkey', () => {
		expect(
			parseRequestKeyResponse({
				success: 22,
				requires_confirmation: 1,
				api_key: null,
				request_id: '4503369671282782438',
			}),
		).toEqual({
			eresult: 22,
			apiKey: null,
			requestId: '4503369671282782438',
			requiresConfirmation: true,
		})
	})

	test('maps a finalized key', () => {
		expect(
			parseRequestKeyResponse({
				success: 1,
				requires_confirmation: 0,
				api_key: '0123456789ABCDEF0123456789ABCDEF',
				request_id: '4503369671282782438',
			}),
		).toEqual({
			eresult: 1,
			apiKey: '0123456789ABCDEF0123456789ABCDEF',
			requestId: '4503369671282782438',
			requiresConfirmation: false,
		})
	})
})

describe('requestKeyForm', () => {
	test('starts a new request with request_id=0', () => {
		const form = requestKeyForm({
			domain: 'localhost',
			requestId: '0',
			sessionId: 'abc',
		})
		expect(form.get('domain')).toBe('localhost')
		expect(form.get('request_id')).toBe('0')
		expect(form.get('sessionid')).toBe('abc')
		expect(form.get('agreeToTerms')).toBe('true')
	})

	test('finalizes with the pending request_id as a string', () => {
		const form = requestKeyForm({
			domain: 'localhost',
			requestId: '4503369671282782438',
			sessionId: 'abc',
		})
		expect(form.get('request_id')).toBe('4503369671282782438')
	})
})

describe('parseApiKeyFromHtml', () => {
	test('reads the hex key from the English apikey page', () => {
		const html = '<p>Key: 0123456789ABCDEF0123456789ABCDEF</p>'
		expect(parseApiKeyFromHtml(html)).toBe('0123456789ABCDEF0123456789ABCDEF')
		expect(parseApiKeyFromHtml('<p>no key</p>')).toBeNull()
	})
})

describe('toCookieHeader', () => {
	test('keeps steamcommunity Set-Cookie and drops store/login domains', () => {
		const header = toCookieHeader([
			'steamLoginSecure=storetoken; Path=/; Domain=store.steampowered.com',
			'steamLoginSecure=communitytoken; Path=/; HttpOnly; Domain=steamcommunity.com',
			'sessionid=abc; Path=/; Secure; SameSite=None; Domain=steamcommunity.com',
			'steamRefresh_steam=refresh; Domain=login.steampowered.com',
		])
		expect(header).toBe('steamLoginSecure=communitytoken; sessionid=abc')
	})

	test('passes through mobile name=value cookies with no Domain', () => {
		expect(
			toCookieHeader([
				'steamLoginSecure=76561198000000000%7C%7Cjwt',
				'sessionid=deadbeef',
			]),
		).toBe('steamLoginSecure=76561198000000000%7C%7Cjwt; sessionid=deadbeef')
	})

	test('keeps iOS mobileClient cookies used on /mobileconf', () => {
		const header = toCookieHeader(
			mobileAccessCookies({
				steamId: STEAM_ID,
				accessToken: 'tok',
				sessionId: 'sess',
			}),
		)
		expect(header).toContain(`steamLoginSecure=${STEAM_ID}%7C%7Ctok`)
		expect(header).toContain('sessionid=sess')
		expect(header).toContain('mobileClient=ios')
		expect(header).toContain('mobileClientVersion=777777 3.10.9')
		expect(header).toContain('Steam_Language=english')
	})
})
