import { describe, expect, test } from 'bun:test'
import {
	gcsStorageClass,
	joinObjectPrefix,
	resolveArchiveDestination,
	sameObjectBucket,
	stripObjectPrefix,
} from '#src/components/archive-dest'

describe('joinObjectPrefix', () => {
	test('prefixes a hot replay key and is idempotent', () => {
		expect(joinObjectPrefix('cold/', 'replays/1/1_2.dem.bz2')).toBe(
			'cold/replays/1/1_2.dem.bz2',
		)
		expect(joinObjectPrefix('cold', 'cold/replays/1/1_2.dem.bz2')).toBe(
			'cold/replays/1/1_2.dem.bz2',
		)
		expect(joinObjectPrefix('', 'replays/1/1_2.dem.bz2')).toBe(
			'replays/1/1_2.dem.bz2',
		)
	})
})

describe('stripObjectPrefix', () => {
	test('removes a folder prefix once', () => {
		expect(stripObjectPrefix('cold/', 'cold/replays/1/1_2.dem.bz2')).toBe(
			'replays/1/1_2.dem.bz2',
		)
		expect(stripObjectPrefix('cold', 'replays/1/1_2.dem.bz2')).toBe(
			'replays/1/1_2.dem.bz2',
		)
	})
})

describe('sameObjectBucket', () => {
	test('compares parsed names across gs:// and plain', () => {
		expect(sameObjectBucket('gs://dl-dota2-demos/', 'dl-dota2-demos')).toBe(
			true,
		)
		expect(sameObjectBucket('a', 'b')).toBe(false)
	})
})

describe('gcsStorageClass', () => {
	test('maps S3 class names onto GCS and passes GCS through', () => {
		expect(gcsStorageClass('')).toBeUndefined()
		expect(gcsStorageClass('STANDARD_IA')).toBe('NEARLINE')
		expect(gcsStorageClass('GLACIER_IR')).toBe('COLDLINE')
		expect(gcsStorageClass('DEEP_ARCHIVE')).toBe('ARCHIVE')
		expect(gcsStorageClass('COLDLINE')).toBe('COLDLINE')
	})
})

describe('resolveArchiveDestination', () => {
	test('empty archive bucket reuses hot and requires a prefix', () => {
		const same = resolveArchiveDestination({
			hotBucket: 'gs://dl-dota2-demos/',
			archiveBucket: '',
			prefix: 'cold/',
			storageClass: '',
		})
		expect(same.ok).toBe(true)
		expect(same.dest.bucket).toBe('dl-dota2-demos')
		expect(same.dest.kind).toBe('gcs')
		expect(same.dest.prefix).toBe('cold')

		const refused = resolveArchiveDestination({
			hotBucket: 'datalouna-dota-replays',
			archiveBucket: '',
			prefix: '',
			storageClass: '',
		})
		expect(refused.ok).toBe(false)
	})

	test('another bucket may keep the hot key at root', () => {
		const dest = resolveArchiveDestination({
			hotBucket: 'hot-replays',
			archiveBucket: 'cold-replays',
			prefix: '',
			storageClass: 'STANDARD_IA',
		})
		expect(dest.ok).toBe(true)
		expect(dest.dest.bucket).toBe('cold-replays')
		expect(dest.dest.prefix).toBe('')
		expect(dest.dest.storageClass).toBe('STANDARD_IA')
	})

	test('refuses a GCS hot bucket with an S3 archive bucket', () => {
		const dest = resolveArchiveDestination({
			hotBucket: 'gs://dl-dota2-demos/',
			archiveBucket: 'aws-cold',
			prefix: '',
			storageClass: 'GLACIER_IR',
		})
		expect(dest.ok).toBe(false)
	})
})
