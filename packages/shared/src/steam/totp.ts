import { steamFetch } from '#src/steam/http'

const STEP_SEC = 30
const ALPHABET = '23456789BCDFGHJKMNPQRTVWXY'
const SECRET_BYTES = 20

export class SteamTotpError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SteamTotpError'
	}
}

export function unixTime(timeOffsetSec = 0): number {
	return Math.floor(Date.now() / 1000) + timeOffsetSec
}

export function decodeSecret(secret: string | Buffer): Buffer {
	if (Buffer.isBuffer(secret)) return secret
	const trimmed = secret.trim()
	if (/^[0-9a-f]{40}$/i.test(trimmed)) {
		return Buffer.from(trimmed, 'hex')
	}
	const buf = Buffer.from(trimmed, 'base64')
	if (buf.length === 0) {
		throw new SteamTotpError('shared_secret is empty or not valid base64/hex')
	}
	return buf
}

export function generateAuthCode(
	secret: string | Buffer,
	timeOffsetSec = 0,
): string {
	const key = decodeSecret(secret)
	const time = unixTime(timeOffsetSec)
	const buffer = Buffer.allocUnsafe(8)
	buffer.writeUInt32BE(0, 0)
	buffer.writeUInt32BE(Math.floor(time / STEP_SEC), 4)

	const hmac = Buffer.from(
		new Bun.CryptoHasher('sha1', key).update(buffer).digest(),
	)
	const start = hmac[19]! & 0x0f
	let fullcode = hmac.readUInt32BE(start) & 0x7fffffff

	let code = ''
	for (let i = 0; i < 5; i++) {
		code += ALPHABET.charAt(fullcode % ALPHABET.length)
		fullcode = Math.floor(fullcode / ALPHABET.length)
	}
	return code
}

export function generateConfirmationKey(
	identitySecret: string | Buffer,
	time: number,
	tag: string,
): string {
	const key = decodeSecret(identitySecret)
	const tagBytes = Buffer.from(tag.slice(0, 32), 'utf8')
	const buffer = Buffer.allocUnsafe(8 + tagBytes.length)
	buffer.writeBigUInt64BE(BigInt(time), 0)
	tagBytes.copy(buffer, 8)
	return new Bun.CryptoHasher('sha1', key).update(buffer).digest('base64')
}

export function getDeviceId(steamId: string, salt = ''): string {
	const hex = new Bun.CryptoHasher('sha1')
		.update(`${steamId}${salt}`)
		.digest('hex')
		.slice(0, 32)
	const dashed = hex.replace(
		/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/,
		'$1-$2-$3-$4-$5',
	)
	return `android:${dashed}`
}

export async function querySteamTimeOffset(proxyUrl?: string | null): Promise<{
	offset: number
	latencyMs: number
}> {
	const started = Date.now()
	const response = await steamFetch(
		'https://api.steampowered.com/ITwoFactorService/QueryTime/v1/',
		{
			method: 'POST',
			proxy: proxyUrl,
			signal: AbortSignal.timeout(8_000),
		},
	)
	if (!response.ok) {
		throw new SteamTotpError(`QueryTime HTTP ${response.status}`)
	}
	const body = (await response.json()) as {
		response?: { server_time?: string | number }
	}
	const serverTime = Number(body.response?.server_time)
	if (!Number.isFinite(serverTime)) {
		throw new SteamTotpError('QueryTime returned no server_time')
	}
	const latencyMs = Date.now() - started
	return { offset: serverTime - unixTime(), latencyMs }
}

export function assertSharedSecretShape(secret: string): void {
	const raw = decodeSecret(secret)
	if (raw.length !== SECRET_BYTES) {
		throw new SteamTotpError(
			`shared_secret must decode to ${SECRET_BYTES} bytes, got ${raw.length}`,
		)
	}
}
