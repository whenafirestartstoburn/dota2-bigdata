import { parseObjectLocation } from '#src/utils/object-location'

export type ArchiveDestination = {
	bucketRaw: string
	bucket: string
	kind: 'gcs' | 's3'
	prefix: string
	storageClass: string
}

const GCS_STORAGE_CLASS: Record<string, string> = {
	STANDARD: 'STANDARD',
	STANDARD_IA: 'NEARLINE',
	ONEZONE_IA: 'NEARLINE',
	INTELLIGENT_TIERING: 'NEARLINE',
	GLACIER: 'COLDLINE',
	GLACIER_IR: 'COLDLINE',
	DEEP_ARCHIVE: 'ARCHIVE',
	NEARLINE: 'NEARLINE',
	COLDLINE: 'COLDLINE',
	ARCHIVE: 'ARCHIVE',
}

export function normalizeObjectPrefix(raw: string): string {
	return raw.trim().replace(/^\/+|\/+$/g, '')
}

export function joinObjectPrefix(prefix: string, key: string): string {
	const p = normalizeObjectPrefix(prefix)
	const k = key.replace(/^\/+/, '')
	if (p === '') return k
	if (k === p || k.startsWith(`${p}/`)) return k
	return `${p}/${k}`
}

export function stripObjectPrefix(prefix: string, key: string): string {
	const p = normalizeObjectPrefix(prefix)
	if (p === '') return key.replace(/^\/+/, '')
	const k = key.replace(/^\/+/, '')
	if (k === p) return ''
	const head = `${p}/`
	return k.startsWith(head) ? k.slice(head.length) : k
}

export function sameObjectBucket(a: string, b: string): boolean {
	const left = parseObjectLocation(a).bucket
	const right = parseObjectLocation(b).bucket
	return left !== '' && left === right
}

export function gcsStorageClass(raw: string): string | undefined {
	const key = raw.trim().toUpperCase()
	if (key === '') return undefined
	return GCS_STORAGE_CLASS[key] ?? raw.trim()
}

export function resolveArchiveDestination(input: {
	hotBucket: string
	archiveBucket: string
	prefix: string
	storageClass: string
}):
	| { dest: ArchiveDestination; ok: true }
	| { dest: ArchiveDestination; ok: false; reason: string } {
	const hot = parseObjectLocation(input.hotBucket)
	const archiveRaw =
		input.archiveBucket.trim() === '' ? input.hotBucket : input.archiveBucket
	const loc = parseObjectLocation(archiveRaw)
	const dest: ArchiveDestination = {
		bucketRaw: archiveRaw,
		bucket: loc.bucket,
		kind: loc.kind,
		prefix: normalizeObjectPrefix(input.prefix),
		storageClass: input.storageClass.trim(),
	}
	if (loc.bucket === '') {
		return { dest, ok: false, reason: 'archive bucket is empty' }
	}
	if (hot.kind !== dest.kind) {
		return {
			dest,
			ok: false,
			reason: 'S3_ARCHIVE_BUCKET must be the same kind as S3_BUCKET',
		}
	}
	if (dest.bucket === hot.bucket && dest.prefix === '') {
		return {
			dest,
			ok: false,
			reason:
				'same-bucket archive needs S3_ARCHIVE_PREFIX (or a different bucket)',
		}
	}
	return { dest, ok: true }
}
