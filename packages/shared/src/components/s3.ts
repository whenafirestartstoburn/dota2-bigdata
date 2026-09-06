import env from '#src/utils/env'
import { parseObjectLocation } from '#src/utils/object-location'

export type ObjectStore = {
	write(
		key: string,
		data: Request | Response | Blob | ArrayBuffer | Uint8Array | string,
		opts?: { type?: string },
	): Promise<unknown>
	stat(key: string): Promise<{ size: number }>
	file(key: string): { bytes(): Promise<Uint8Array> }
}

export function objectBucket(): string {
	return parseObjectLocation(env.S3_BUCKET).bucket
}

export function objectStore(): ObjectStore {
	const loc = parseObjectLocation(env.S3_BUCKET)
	if (loc.kind === 'gcs') return gcsStore(loc.bucket)
	if (env.S3_ACCESS_KEY === '' || env.S3_SECRET_KEY === '') {
		throw new Error(
			'S3_ACCESS_KEY and S3_SECRET_KEY are required unless S3_BUCKET is gs://…',
		)
	}
	return new Bun.S3Client({
		accessKeyId: env.S3_ACCESS_KEY,
		secretAccessKey: env.S3_SECRET_KEY,
		bucket: loc.bucket,
		region: env.S3_REGION,
		virtualHostedStyle: !env.S3_FORCE_PATH_STYLE,
		...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
	})
}

export function replayObjectKey(
	matchId: number,
	_cluster: number,
	salt: number,
): string {
	return `replays/${matchId}/${matchId}_${salt}.dem.bz2`
}

export async function objectExists(key: string): Promise<boolean> {
	try {
		const stat = await objectStore().stat(key)
		return stat.size > 0
	} catch {
		return false
	}
}

type GcsToken = { accessToken: string; expiresAt: number }

let gcsToken: GcsToken | null = null

const METADATA_TOKEN_URLS = [
	'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
	'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
]

function gcsStore(bucket: string): ObjectStore {
	return {
		async write(key, data, opts) {
			const { body, type, length } = await writeBody(data, opts?.type)
			const token = await gcsAccessToken()
			const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`
			const headers: Record<string, string> = {
				Authorization: `Bearer ${token}`,
				'Content-Type': type,
			}
			if (length != null) headers['Content-Length'] = String(length)
			const res = await fetch(url, { method: 'POST', headers, body })
			if (!res.ok) {
				throw new Error(
					`gcs write ${bucket}/${key}: HTTP ${String(res.status)}`,
				)
			}
		},
		async stat(key) {
			const token = await gcsAccessToken()
			const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`
			const res = await fetch(url, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (!res.ok) {
				throw new Error(`gcs stat ${bucket}/${key}: HTTP ${String(res.status)}`)
			}
			const json = (await res.json()) as { size?: string }
			const size = Number(json.size ?? 0)
			if (!Number.isFinite(size)) {
				throw new Error(`gcs stat ${bucket}/${key}: bad size`)
			}
			return { size }
		},
		file(key) {
			return {
				async bytes() {
					const token = await gcsAccessToken()
					const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`
					const res = await fetch(url, {
						headers: { Authorization: `Bearer ${token}` },
					})
					if (!res.ok) {
						throw new Error(
							`gcs get ${bucket}/${key}: HTTP ${String(res.status)}`,
						)
					}
					return new Uint8Array(await res.arrayBuffer())
				},
			}
		},
	}
}

async function writeBody(
	data: Request | Response | Blob | ArrayBuffer | Uint8Array | string,
	type: string | undefined,
): Promise<{ body: BodyInit; type: string; length: number | null }> {
	const fallback = type ?? 'application/octet-stream'
	if (typeof data === 'string') {
		return {
			body: data,
			type: fallback,
			length: new TextEncoder().encode(data).length,
		}
	}
	if (data instanceof Uint8Array) {
		return { body: data, type: fallback, length: data.byteLength }
	}
	if (data instanceof ArrayBuffer) {
		return { body: data, type: fallback, length: data.byteLength }
	}
	if (data instanceof Blob) {
		const blobType = data.type === '' ? fallback : data.type
		return {
			body: data,
			type: type ?? blobType,
			length: data.size,
		}
	}
	if (data instanceof Request || data instanceof Response) {
		const headerType = data.headers.get('content-type')
		const headerLen = Number(data.headers.get('content-length'))
		if (data.body != null && Number.isFinite(headerLen) && headerLen > 0) {
			return {
				body: data.body,
				type: type ?? headerType ?? fallback,
				length: headerLen,
			}
		}
		const buf = await data.arrayBuffer()
		return {
			body: buf,
			type: type ?? headerType ?? fallback,
			length: buf.byteLength,
		}
	}
	throw new Error('gcs write: unsupported body')
}

async function gcsAccessToken(): Promise<string> {
	const now = Date.now()
	if (gcsToken != null && gcsToken.expiresAt > now + 60_000) {
		return gcsToken.accessToken
	}
	let lastError: Error | null = null
	for (const url of METADATA_TOKEN_URLS) {
		try {
			const res = await fetch(url, {
				headers: { 'Metadata-Flavor': 'Google' },
				signal: AbortSignal.timeout(3_000),
			})
			if (!res.ok) {
				lastError = new Error(`metadata token HTTP ${String(res.status)}`)
				continue
			}
			const json = (await res.json()) as {
				access_token?: string
				expires_in?: number
			}
			if (json.access_token == null || json.access_token === '') {
				lastError = new Error('metadata token missing access_token')
				continue
			}
			const ttlMs = Math.max(0, (json.expires_in ?? 0) * 1000)
			gcsToken = {
				accessToken: json.access_token,
				expiresAt: now + ttlMs,
			}
			return gcsToken.accessToken
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))
		}
	}
	throw new Error(`gcs metadata token: ${lastError?.message ?? 'unreachable'}`)
}
