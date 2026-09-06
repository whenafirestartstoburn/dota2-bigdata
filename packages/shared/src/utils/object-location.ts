export type ObjectLocation = {
	kind: 'gcs' | 's3'
	bucket: string
}

/** `gs://bucket/` is GCS (instance ADC). Anything else is the S3 API. */
export function parseObjectLocation(raw: string): ObjectLocation {
	const trimmed = raw.trim()
	if (trimmed.startsWith('gs://')) {
		const path = trimmed.slice('gs://'.length).replace(/^\/+|\/+$/g, '')
		const slash = path.indexOf('/')
		const bucket = slash === -1 ? path : path.slice(0, slash)
		return { kind: 'gcs', bucket }
	}
	return { kind: 's3', bucket: trimmed.replace(/\/+$/, '') }
}
