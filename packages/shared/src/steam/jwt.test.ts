import { describe, expect, test } from 'bun:test'
import {
	jwtExpiresAt,
	jwtHasAudience,
	jwtSteamId,
	refreshTokenUsable,
} from './jwt'

function jwt(payload: Record<string, unknown>): string {
	const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
	return `hdr.${json}.sig`
}

describe('steam jwt', () => {
	test('reads exp and sub from a refresh-token-shaped JWT', () => {
		const token = jwt({
			sub: '76561198000000000',
			exp: 2_000_000_000,
		})
		expect(jwtSteamId(token)).toBe('76561198000000000')
		expect(jwtExpiresAt(token)?.toISOString()).toBe('2033-05-18T03:33:20.000Z')
	})

	test('jwtHasAudience reads aud from a mobile refresh token', () => {
		const token = jwt({
			sub: '76561198000000000',
			aud: ['web', 'mobile'],
		})
		expect(jwtHasAudience(token, 'mobile')).toBe(true)
		expect(jwtHasAudience(token, 'client')).toBe(false)
	})

	test('refreshTokenUsable rejects empty and expired tokens', () => {
		expect(refreshTokenUsable(null)).toBe(false)
		expect(refreshTokenUsable('')).toBe(false)
		const expired = jwt({ exp: 1_000_000_000 })
		expect(refreshTokenUsable(expired)).toBe(false)
		const live = jwt({ exp: Math.floor(Date.now() / 1000) + 86_400 })
		expect(refreshTokenUsable(live)).toBe(true)
	})
})
