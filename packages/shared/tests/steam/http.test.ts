import { describe, expect, test } from 'bun:test'
import { MissingProxyError, steamFetch } from '#src/steam/http'

describe('steamFetch', () => {
	test('refuses to call Steam without a proxy', async () => {
		await expect(steamFetch('https://example.com/')).rejects.toBeInstanceOf(
			MissingProxyError,
		)
	})
})
