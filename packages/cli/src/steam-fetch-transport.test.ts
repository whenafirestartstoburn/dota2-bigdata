import { describe, expect, test } from 'bun:test'
import { pickReadyProxy } from '@app/shared/src/components/proxies'
import { runWithProxy } from '@app/shared/src/steam/http'
import { FetchWebApiTransport, webApiPath } from './steam-fetch-transport'

describe('webApiPath', () => {
	test('matches steam-session WebApiTransport paths', () => {
		expect(webApiPath('Authentication', 'GetPasswordRSAPublicKey', 1)).toBe(
			'IAuthenticationService/GetPasswordRSAPublicKey/v1',
		)
	})
})

describe('FetchWebApiTransport', () => {
	test('GetPasswordRSAPublicKey returns protobuf instead of hanging', async () => {
		const proxy = await pickReadyProxy('api')
		const result = await runWithProxy(proxy.url, () =>
			new FetchWebApiTransport(proxy.url).sendRequest({
				apiInterface: 'Authentication',
				apiMethod: 'GetPasswordRSAPublicKey',
				apiVersion: 1,
				requestData: Buffer.from('CgR0ZXN0', 'base64'),
			}),
		)
		expect(result.result).toBe(1)
		expect(Buffer.isBuffer(result.responseData)).toBe(true)
		expect((result.responseData as Buffer).length).toBeGreaterThan(0)
	}, 20_000)
})
