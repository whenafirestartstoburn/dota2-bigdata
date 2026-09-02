import env from '#src/utils/env'

export function objectStore(): Bun.S3Client {
	return new Bun.S3Client({
		accessKeyId: env.S3_ACCESS_KEY,
		secretAccessKey: env.S3_SECRET_KEY,
		bucket: env.S3_BUCKET,
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
