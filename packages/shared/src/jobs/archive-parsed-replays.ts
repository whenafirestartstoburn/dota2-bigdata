import {
	joinObjectPrefix,
	resolveArchiveDestination,
	sameObjectBucket,
} from '#src/components/archive-dest'
import {
	archiveObjectStore,
	copyObject,
	deleteObject,
	type ObjectStore,
	objectExistsIn,
	objectStoreForBucket,
} from '#src/components/s3'
import { getAppSettings } from '#src/components/settings'
import { observeReplayArchive } from '#src/metrics/observe'
import { errorMessage } from '#src/store/coerce'
import {
	listParsedUnarchived,
	markReplayArchived,
	type UnarchivedReplay,
	updateReplay,
} from '#src/store/replays'
import env from '#src/utils/env'
import { logger } from '#src/utils/logger'

export type ArchiveObjectOps = {
	sourceStore(bucket: string): ObjectStore
	destStore(): ObjectStore
	exists(store: ObjectStore, key: string): Promise<boolean>
	copy(input: {
		src: ObjectStore
		srcKey: string
		dest: ObjectStore
		destKey: string
		storageClass?: string
	}): Promise<void>
	delete(store: ObjectStore, key: string): Promise<void>
}

const defaultOps: ArchiveObjectOps = {
	sourceStore: objectStoreForBucket,
	destStore: archiveObjectStore,
	exists: objectExistsIn,
	copy: copyObject,
	delete: deleteObject,
}

export async function runArchiveParsedReplays(
	ops: ArchiveObjectOps = defaultOps,
	opts?: { matchId?: number },
): Promise<{ archived: number; skipped: boolean; more: boolean }> {
	const resolved = resolveArchiveDestination({
		hotBucket: env.S3_BUCKET,
		archiveBucket: env.S3_ARCHIVE_BUCKET,
		prefix: env.S3_ARCHIVE_PREFIX,
		storageClass: env.S3_ARCHIVE_STORAGE_CLASS,
	})
	if (!resolved.ok) {
		logger.warn({ reason: resolved.reason }, 'replay archive skipped')
		return { archived: 0, skipped: true, more: false }
	}
	const settings = await getAppSettings()
	const limit = opts?.matchId != null ? 1 : settings.replayArchiveBatchSize
	const rows = await listParsedUnarchived(limit, opts?.matchId)
	let archived = 0
	for (const row of rows) {
		const started = performance.now()
		try {
			const did = await archiveOne(row, resolved.dest, ops)
			if (did) archived++
		} catch (error) {
			const message = errorMessage(error)
			observeReplayArchive('error', started)
			await updateReplay(row.matchId, { error: message })
			logger.warn(
				{ matchId: row.matchId, err: message },
				'replay archive failed',
			)
		}
	}
	return {
		archived,
		skipped: false,
		more: rows.length >= settings.replayArchiveBatchSize,
	}
}

async function archiveOne(
	row: UnarchivedReplay,
	dest: {
		bucket: string
		prefix: string
		storageClass: string
	},
	ops: ArchiveObjectOps,
): Promise<boolean> {
	const srcBucket = row.s3Bucket === '' ? env.S3_BUCKET : row.s3Bucket
	const destKey = joinObjectPrefix(dest.prefix, row.s3Key)
	const src = ops.sourceStore(srcBucket)
	const destStore = ops.destStore()
	const alreadyThere =
		sameObjectBucket(srcBucket, dest.bucket) && row.s3Key === destKey
	const started = performance.now()

	if (!alreadyThere) {
		const destExists = await ops.exists(destStore, destKey)
		if (!destExists) {
			const srcExists = await ops.exists(src, row.s3Key)
			if (!srcExists) {
				throw new Error(`replay object missing at ${src.bucket}/${row.s3Key}`)
			}
			await ops.copy({
				src,
				srcKey: row.s3Key,
				dest: destStore,
				destKey,
				storageClass: dest.storageClass === '' ? undefined : dest.storageClass,
			})
		}
	}

	await markReplayArchived(row.matchId, dest.bucket, destKey)

	if (
		!alreadyThere &&
		!(sameObjectBucket(srcBucket, dest.bucket) && row.s3Key === destKey)
	) {
		try {
			await ops.delete(src, row.s3Key)
		} catch (error) {
			logger.warn(
				{
					matchId: row.matchId,
					key: row.s3Key,
					err: errorMessage(error),
				},
				'replay archive: source object delete failed',
			)
		}
	}

	observeReplayArchive(alreadyThere ? 'already' : 'success', started, row.bytes)
	logger.info(
		{
			matchId: row.matchId,
			bucket: dest.bucket,
			key: destKey,
			already: alreadyThere,
		},
		'archived replay',
	)
	return true
}
