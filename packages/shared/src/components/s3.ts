import {
	gcsStorageClass,
	joinObjectPrefix,
	resolveArchiveDestination,
} from '#src/components/archive-dest'
import env from '#src/utils/env'
import { parseObjectLocation } from '#src/utils/object-location'

export type ObjectWriteOpts = { type?: string; storageClass?: string }

export type ObjectStore = {
	kind: 'gcs' | 's3'
	bucket: string
	write(
		key: string,
		data: Request | Response | Blob | ArrayBuffer | Uint8Array | string,
		opts?: ObjectWriteOpts,
	): Promise<unknown>
	stat(key: string): Promise<{ size: number }>
	file(key: string): { bytes(): Promise<Uint8Array> }
	delete(key: string): Promise<void>
}

type S3Creds = {
	accessKeyId: string
	secretAccessKey: string
	region: string
	endpoint?: string
	virtualHostedStyle: boolean
}

export function objectBucket(): string {
	return parseObjectLocation(env.S3_BUCKET).bucket
}

export function objectStore(): ObjectStore {
	return storeFor(parseObjectLocation(env.S3_BUCKET), hotCreds())
}

export function archiveObjectStore(): ObjectStore {
	const resolved = resolveArchiveDestination({
		hotBucket: env.S3_BUCKET,
		archiveBucket: env.S3_ARCHIVE_BUCKET,
		prefix: env.S3_ARCHIVE_PREFIX,
		storageClass: env.S3_ARCHIVE_STORAGE_CLASS,
	})
	return storeFor(parseObjectLocation(resolved.dest.bucketRaw), archiveCreds())
}

/** Store for a locator already written to match_replays.s3_bucket. */
export function objectStoreForBucket(bucketName: string): ObjectStore {
	const loc = parseObjectLocation(bucketName)
	const hot = parseObjectLocation(env.S3_BUCKET)
	const resolved = resolveArchiveDestination({
		hotBucket: env.S3_BUCKET,
		archiveBucket: env.S3_ARCHIVE_BUCKET,
		prefix: env.S3_ARCHIVE_PREFIX,
		storageClass: env.S3_ARCHIVE_STORAGE_CLASS,
	})
	const creds =
		resolved.ok && loc.bucket === resolved.dest.bucket
			? archiveCreds()
			: hotCreds()
	return storeFor({ kind: hot.kind, bucket: loc.bucket }, creds)
}

function storeFor(
	loc: { kind: 'gcs' | 's3'; bucket: string },
	creds: S3Creds,
): ObjectStore {
	if (loc.kind === 'gcs') return gcsStore(loc.bucket)
	if (creds.accessKeyId === '' || creds.secretAccessKey === '') {
		throw new Error(
			'S3_ACCESS_KEY and S3_SECRET_KEY are required unless S3_BUCKET is gs://…',
		)
	}
	return s3Store(loc.bucket, creds)
}

function hotCreds(): S3Creds {
	return {
		accessKeyId: env.S3_ACCESS_KEY,
		secretAccessKey: env.S3_SECRET_KEY,
		region: env.S3_REGION,
		endpoint: env.S3_ENDPOINT,
		virtualHostedStyle: !env.S3_FORCE_PATH_STYLE,
	}
}

function archiveCreds(): S3Creds {
	const hot = hotCreds()
	return {
		accessKeyId:
			env.S3_ARCHIVE_ACCESS_KEY === ''
				? hot.accessKeyId
				: env.S3_ARCHIVE_ACCESS_KEY,
		secretAccessKey:
			env.S3_ARCHIVE_SECRET_KEY === ''
				? hot.secretAccessKey
				: env.S3_ARCHIVE_SECRET_KEY,
		region: env.S3_ARCHIVE_REGION === '' ? hot.region : env.S3_ARCHIVE_REGION,
		endpoint: env.S3_ARCHIVE_ENDPOINT ?? hot.endpoint,
		virtualHostedStyle: hot.virtualHostedStyle,
	}
}

export function replayObjectKey(
	matchId: number,
	_cluster: number,
	salt: number,
): string {
	return `replays/${matchId}/${matchId}_${salt}.dem.bz2`
}

export type ReplayObjectHit = {
	bucket: string
	key: string
	archived: boolean
}

/** Row locator (if any), then hot key, then cold archive key. */
export function replayObjectCandidates(
	hotKey: string,
	existing?: { bucket?: string | null; key?: string | null },
): ReplayObjectHit[] {
	const hotBucket = objectBucket()
	const resolved = resolveArchiveDestination({
		hotBucket: env.S3_BUCKET,
		archiveBucket: env.S3_ARCHIVE_BUCKET,
		prefix: env.S3_ARCHIVE_PREFIX,
		storageClass: env.S3_ARCHIVE_STORAGE_CLASS,
	})
	const destKey = resolved.ok
		? joinObjectPrefix(resolved.dest.prefix, hotKey)
		: null
	const hits: ReplayObjectHit[] = []
	const seen = new Set<string>()
	const push = (hit: ReplayObjectHit) => {
		if (hit.bucket === '' || hit.key === '') return
		const id = `${hit.bucket}\0${hit.key}`
		if (seen.has(id)) return
		seen.add(id)
		hits.push(hit)
	}
	const existingKey = existing?.key?.trim() ?? ''
	if (existingKey !== '') {
		const rawBucket = existing?.bucket?.trim() ?? ''
		const bucket =
			rawBucket === '' ? hotBucket : parseObjectLocation(rawBucket).bucket
		push({
			bucket,
			key: existingKey,
			archived:
				resolved.ok &&
				destKey != null &&
				bucket === resolved.dest.bucket &&
				existingKey === destKey,
		})
	}
	push({ bucket: hotBucket, key: hotKey, archived: false })
	if (resolved.ok && destKey != null) {
		push({
			bucket: resolved.dest.bucket,
			key: destKey,
			archived: true,
		})
	}
	return hits
}

export async function objectExists(key: string): Promise<boolean> {
	return objectExistsIn(objectStore(), key)
}

export async function objectExistsIn(
	store: ObjectStore,
	key: string,
): Promise<boolean> {
	try {
		const stat = await store.stat(key)
		return stat.size > 0
	} catch {
		return false
	}
}

export async function locateReplayObject(
	hotKey: string,
	existing?: { bucket?: string | null; key?: string | null },
): Promise<ReplayObjectHit | null> {
	for (const hit of replayObjectCandidates(hotKey, existing)) {
		if (await objectExistsIn(objectStoreForBucket(hit.bucket), hit.key)) {
			return hit
		}
	}
	return null
}

export async function copyObject(input: {
	src: ObjectStore
	srcKey: string
	dest: ObjectStore
	destKey: string
	storageClass?: string
}): Promise<void> {
	if (input.src.kind === 'gcs' && input.dest.kind === 'gcs') {
		await gcsRewrite(
			input.src.bucket,
			input.srcKey,
			input.dest.bucket,
			input.destKey,
			input.storageClass,
		)
		return
	}
	const stat = await input.src.stat(input.srcKey)
	const body = await objectBody(input.src, input.srcKey)
	const headers: Record<string, string> = {
		'content-type': 'application/x-bzip2',
		'content-length': String(stat.size),
	}
	await input.dest.write(input.destKey, new Response(body, { headers }), {
		type: 'application/x-bzip2',
		storageClass: input.storageClass,
	})
}

export async function deleteObject(
	store: ObjectStore,
	key: string,
): Promise<void> {
	await store.delete(key)
}

async function objectBody(
	store: ObjectStore,
	key: string,
): Promise<ReadableStream<Uint8Array> | Uint8Array> {
	if (store.kind === 's3') {
		const file = store.file(key) as {
			stream?: () => ReadableStream<Uint8Array>
		}
		if (typeof file.stream === 'function') return file.stream()
	}
	return store.file(key).bytes()
}

function s3Store(bucket: string, creds: S3Creds): ObjectStore {
	const client = new Bun.S3Client({
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		bucket,
		region: creds.region,
		virtualHostedStyle: creds.virtualHostedStyle,
		...(creds.endpoint ? { endpoint: creds.endpoint } : {}),
	})
	return {
		kind: 's3',
		bucket,
		async write(key, data, opts) {
			await client.write(key, data as never, {
				type: opts?.type,
				...(opts?.storageClass != null && opts.storageClass !== ''
					? {
							storageClass: opts.storageClass as Bun.S3Options['storageClass'],
						}
					: {}),
			})
		},
		stat(key) {
			return client.stat(key)
		},
		file(key) {
			return client.file(key)
		},
		async delete(key) {
			await client.delete(key)
		},
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
		kind: 'gcs',
		bucket,
		async write(key, data, opts) {
			const { body, type, length } = await writeBody(data, opts?.type)
			const token = await gcsAccessToken()
			const storage = gcsStorageClass(opts?.storageClass ?? '')
			let url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`
			if (storage != null) {
				url += `&storageClass=${encodeURIComponent(storage)}`
			}
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
		async delete(key) {
			const token = await gcsAccessToken()
			const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`
			const res = await fetch(url, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.status === 404) return
			if (!res.ok) {
				throw new Error(
					`gcs delete ${bucket}/${key}: HTTP ${String(res.status)}`,
				)
			}
		},
	}
}

async function gcsRewrite(
	srcBucket: string,
	srcKey: string,
	destBucket: string,
	destKey: string,
	storageClass?: string,
): Promise<void> {
	const mapped = gcsStorageClass(storageClass ?? '')
	let token = await gcsAccessToken()
	let rewriteToken: string | undefined
	for (let i = 0; i < 32; i++) {
		const params = new URLSearchParams()
		if (rewriteToken != null) params.set('rewriteToken', rewriteToken)
		const qs = params.size > 0 ? `?${params.toString()}` : ''
		const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(srcBucket)}/o/${encodeURIComponent(srcKey)}/rewriteTo/b/${encodeURIComponent(destBucket)}/o/${encodeURIComponent(destKey)}${qs}`
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
		}
		let body: string | undefined
		if (mapped != null && rewriteToken == null) {
			headers['Content-Type'] = 'application/json'
			body = JSON.stringify({ storageClass: mapped })
		}
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(10 * 60_000),
		})
		if (res.status === 401 && i === 0) {
			gcsToken = null
			token = await gcsAccessToken()
			continue
		}
		if (!res.ok) {
			throw new Error(
				`gcs rewrite ${srcBucket}/${srcKey} → ${destBucket}/${destKey}: HTTP ${String(res.status)}`,
			)
		}
		const json = (await res.json()) as {
			done?: boolean
			rewriteToken?: string
		}
		if (json.done === true) return
		if (json.rewriteToken == null || json.rewriteToken === '') {
			throw new Error(
				`gcs rewrite ${srcBucket}/${srcKey}: incomplete without rewriteToken`,
			)
		}
		rewriteToken = json.rewriteToken
	}
	throw new Error(
		`gcs rewrite ${srcBucket}/${srcKey} → ${destBucket}/${destKey}: too many rewrite steps`,
	)
}

async function writeBody(
	data: Request | Response | Blob | ArrayBuffer | Uint8Array | string,
	type: string | undefined,
): Promise<{
	body: string | Uint8Array | ArrayBuffer | Blob | ReadableStream
	type: string
	length: number | null
}> {
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
