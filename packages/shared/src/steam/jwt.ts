export function decodeJwtPayload(
	token: string,
): Record<string, unknown> | null {
	const part = token.split('.')[1]
	if (part === undefined || part === '') return null
	try {
		const padded = part.replace(/-/g, '+').replace(/_/g, '/')
		const buf = Buffer.from(
			padded + '='.repeat((4 - (padded.length % 4)) % 4),
			'base64',
		)
		const parsed: unknown = JSON.parse(buf.toString('utf8'))
		if (typeof parsed !== 'object' || parsed === null) return null
		return parsed as Record<string, unknown>
	} catch {
		return null
	}
}

export function jwtExpiresAt(token: string): Date | null {
	const payload = decodeJwtPayload(token)
	const exp = payload?.exp
	if (typeof exp !== 'number' || !Number.isFinite(exp)) return null
	return new Date(exp * 1000)
}

export function jwtSteamId(token: string): string | null {
	const payload = decodeJwtPayload(token)
	const sub = payload?.sub
	return typeof sub === 'string' && sub !== '' ? sub : null
}

export function jwtAudiences(token: string): string[] {
	const aud = decodeJwtPayload(token)?.aud
	if (typeof aud === 'string' && aud !== '') return [aud]
	if (!Array.isArray(aud)) return []
	return aud.filter(
		(item): item is string => typeof item === 'string' && item !== '',
	)
}

export function jwtHasAudience(token: string, audience: string): boolean {
	return jwtAudiences(token).includes(audience)
}

export function refreshTokenUsable(
	token: string | null | undefined,
	expiresAt?: Date | null,
): boolean {
	if (token == null || token === '') return false
	const exp = expiresAt ?? jwtExpiresAt(token)
	if (exp === null) return true
	return exp.getTime() > Date.now() + 60_000
}
