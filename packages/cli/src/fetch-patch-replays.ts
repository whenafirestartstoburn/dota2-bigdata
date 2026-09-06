import { mkdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
	pickApiCredential,
	steamCtx,
} from '@app/shared/src/components/resources'
import { objectStore } from '@app/shared/src/components/s3'
import { REPLAY_STATE } from '@app/shared/src/gc/protobuf'
import { runFetchLeagues } from '@app/shared/src/jobs/fetch-leagues'
import { withGcSession } from '@app/shared/src/steam/gc-probe'
import { getMatchHistoryPage, replayUrl } from '@app/shared/src/steam/web-api'
import { asNumber, asText, errorMessage } from '@app/shared/src/store/coerce'
import { db, sql } from '@app/shared/src/utils/db'
import { withStatus } from '@app/shared/src/utils/status'

const DEFAULT_ROOT = join(import.meta.dir, '../../parser/testdata/patches')
const MIN_BYTES = 100_000
const MAX_LEAGUES = 5
const MAX_PAGES = 3
const MAX_CANDIDATES = 8

type PatchWindow = {
	name: string
	after: number
	until: number
}

type Candidate = {
	matchId: number
	cluster: number | null
	salt: number | null
	s3Key: string | null
	sourceUrl: string | null
}

function log(line: string): void {
	console.log(line)
}

async function loadPatches(only: Set<string>): Promise<PatchWindow[]> {
	const rows = await db.execute(sql`
		SELECT
			patch,
			extract(epoch FROM released_at)::bigint AS released
		FROM patches
		ORDER BY released_at ASC
	`)
	const raw = rows.map((row) => ({
		name: asText(row.patch) ?? '',
		after: asNumber(row.released) ?? 0,
	}))
	const now = Math.floor(Date.now() / 1000) + 86_400
	const windows: PatchWindow[] = []
	for (let i = 0; i < raw.length; i++) {
		const cur = raw[i]
		if (cur == null || cur.name === '' || cur.after === 0) continue
		if (only.size > 0 && !only.has(cur.name)) continue
		const next = raw[i + 1]
		windows.push({
			name: cur.name,
			after: cur.after,
			until: next?.after ?? now,
		})
	}
	return windows
}

async function alreadyHave(dir: string): Promise<string | null> {
	const glob = new Bun.Glob('*.dem*')
	for await (const name of glob.scan({ cwd: dir, onlyFiles: true })) {
		const path = join(dir, name)
		if (await isIntactDemo(path)) return path
		log(`  dropping corrupt ${path}`)
		await unlink(path)
	}
	return null
}

async function candidatesFromDb(patch: string): Promise<Candidate[]> {
	const rows = await db.execute(sql`
		SELECT
			m.match_id,
			m.cluster,
			m.replay_salt,
			r.s3_key,
			r.source_url,
			r.status
		FROM matches m
		LEFT JOIN match_replays r ON r.match_id = m.match_id
		WHERE m.patch = ${patch}
			AND m.league_id IS NOT NULL
		ORDER BY
			CASE WHEN r.status = 'stored' THEN 0 ELSE 1 END,
			m.start_time DESC NULLS LAST
		LIMIT 20
	`)
	return rows.map((row) => ({
		matchId: asNumber(row.match_id) ?? 0,
		cluster: asNumber(row.cluster),
		salt: asNumber(row.replay_salt),
		s3Key: asText(row.s3_key),
		sourceUrl: asText(row.source_url),
	}))
}

async function leaguesForWindow(
	after: number,
	until: number,
): Promise<Array<{ leagueId: number; name: string }>> {
	const rows = await db.execute(sql`
		SELECT league_id, name, start_timestamp, end_timestamp,
			most_recent_activity, total_prize_pool
		FROM leagues
		WHERE
			(
				start_timestamp = 0
				OR start_timestamp < ${until}
			)
			AND (
				end_timestamp = 0
				OR end_timestamp >= ${after}
				OR most_recent_activity >= ${after}
			)
		ORDER BY
			CASE
				WHEN most_recent_activity >= ${after}
					AND most_recent_activity < ${until}
				THEN 0
				ELSE 1
			END,
			total_prize_pool DESC NULLS LAST,
			league_id
		LIMIT ${MAX_LEAGUES}
	`)
	return rows.map((row) => ({
		leagueId: asNumber(row.league_id) ?? 0,
		name: asText(row.name) ?? '',
	}))
}

async function historyCandidates(input: {
	after: number
	until: number
	leagues: Array<{ leagueId: number; name: string }>
}): Promise<Candidate[]> {
	const cred = await pickApiCredential()
	const ctx = steamCtx(cred, 'historical')
	const found: Candidate[] = []
	for (const league of input.leagues) {
		if (found.length >= MAX_CANDIDATES) break
		log(`  history league ${league.leagueId} ${league.name}`)
		let startAt: number | undefined
		for (let page = 0; page < MAX_PAGES; page++) {
			const res = await getMatchHistoryPage(ctx, {
				leagueId: league.leagueId,
				startAtMatchId: startAt,
			})
			if (res.matches.length === 0) break
			for (const match of res.matches) {
				if (match.start_time >= input.after && match.start_time < input.until) {
					found.push({
						matchId: match.match_id,
						cluster: null,
						salt: null,
						s3Key: null,
						sourceUrl: null,
					})
					if (found.length >= MAX_CANDIDATES) return found
				}
			}
			const oldest = res.matches.at(-1)
			if (oldest == null || oldest.start_time < input.after) break
			if (res.resultsRemaining <= 0) break
			startAt = oldest.match_id
		}
	}
	return found
}

function demoMagic(buf: Uint8Array): boolean {
	const head = String.fromCharCode(...buf.subarray(0, 7))
	return (
		head.startsWith('BZh') ||
		head.startsWith('PBDEMS2') ||
		(buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd)
	)
}

function looksLikeDemo(buf: Uint8Array): boolean {
	return buf.length >= MIN_BYTES && demoMagic(buf)
}

async function isIntactDemo(path: string): Promise<boolean> {
	const file = Bun.file(path)
	if (file.size < MIN_BYTES) return false
	const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
	if (!demoMagic(head)) return false
	if (!String.fromCharCode(...head.subarray(0, 3)).startsWith('BZh')) {
		return true
	}
	const proc = Bun.spawn(['bzip2', '-t', path], {
		stdout: 'ignore',
		stderr: 'pipe',
	})
	return (await proc.exited) === 0
}

async function writeDemo(dest: string, buf: Uint8Array): Promise<boolean> {
	if (!looksLikeDemo(buf)) {
		log(`  not a demo (${String(buf.length)} bytes)`)
		return false
	}
	await mkdir(dirname(dest), { recursive: true })
	await Bun.write(dest, buf)
	if (!(await isIntactDemo(dest))) {
		log(`  ${dest} failed integrity check`)
		await unlink(dest)
		return false
	}
	return true
}

async function downloadHttp(url: string, dest: string): Promise<boolean> {
	const response = await fetch(url, { signal: AbortSignal.timeout(600_000) })
	if (!response.ok) {
		log(`  ${url} → HTTP ${String(response.status)}`)
		return false
	}
	const buf = new Uint8Array(await response.arrayBuffer())
	const declared = Number(response.headers.get('content-length'))
	if (Number.isFinite(declared) && declared > 0 && buf.length !== declared) {
		log(`  ${url} → truncated ${String(buf.length)}/${String(declared)}`)
		return false
	}
	return writeDemo(dest, buf)
}

async function downloadS3(key: string, dest: string): Promise<boolean> {
	try {
		const buf = new Uint8Array(await objectStore().file(key).bytes())
		return writeDemo(dest, buf)
	} catch (error) {
		log(`  s3 ${key}: ${errorMessage(error)}`)
		return false
	}
}

function destPath(root: string, patch: string, matchId: number, salt: number) {
	return join(root, patch, `${String(matchId)}_${String(salt)}.dem.bz2`)
}

async function tryCandidate(
	root: string,
	patch: string,
	c: Candidate,
): Promise<string | null> {
	if (c.s3Key != null && c.s3Key !== '') {
		const dest = destPath(root, patch, c.matchId, c.salt ?? 0)
		log(`  s3 ${c.s3Key}`)
		if (await downloadS3(c.s3Key, dest)) return dest
	}
	const url =
		c.sourceUrl != null && c.sourceUrl !== ''
			? c.sourceUrl
			: c.cluster != null && c.salt != null
				? replayUrl(c.cluster, c.matchId, c.salt)
				: null
	if (url != null) {
		const dest = destPath(root, patch, c.matchId, c.salt ?? 0)
		log(`  ${url}`)
		if (await downloadHttp(url, dest)) return dest
	}
	return null
}

function needsLocate(c: Candidate): boolean {
	return (
		(c.cluster == null || c.salt == null) &&
		(c.sourceUrl == null || c.sourceUrl === '') &&
		(c.s3Key == null || c.s3Key === '')
	)
}

async function gatherCandidates(patch: PatchWindow): Promise<Candidate[]> {
	const fromDb = (await candidatesFromDb(patch.name)).filter(
		(c) => c.matchId > 0,
	)
	log(`${patch.name} db candidates=${String(fromDb.length)}`)
	if (fromDb.some((c) => !needsLocate(c))) return fromDb
	const leagues = await leaguesForWindow(patch.after, patch.until)
	if (leagues.length === 0) {
		log(`${patch.name} no overlapping leagues`)
		return fromDb
	}
	const fromHistory = await historyCandidates({
		after: patch.after,
		until: patch.until,
		leagues,
	})
	log(`${patch.name} history candidates=${String(fromHistory.length)}`)
	const seen = new Set(fromDb.map((c) => c.matchId))
	for (const c of fromHistory) {
		if (!seen.has(c.matchId)) fromDb.push(c)
	}
	return fromDb
}

async function main(): Promise<void> {
	const args = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			only: { type: 'string' },
			root: { type: 'string', default: DEFAULT_ROOT },
			'skip-leagues': { type: 'boolean', default: false },
		},
		strict: true,
	})
	const only = new Set(
		(args.values.only ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s !== ''),
	)
	const root = args.values.root ?? DEFAULT_ROOT
	await mkdir(root, { recursive: true })

	if (args.values['skip-leagues'] !== true) {
		log('fetching GetLeagueInfoList…')
		const { count } = await runFetchLeagues()
		log(`upserted ${String(count)} leagues`)
	}

	const patches = await loadPatches(only)
	if (patches.length === 0) {
		throw new Error('no patches in Postgres (or --only matched none)')
	}

	const newestFirst = [...patches].reverse()
	const pending: Array<{ patch: PatchWindow; candidates: Candidate[] }> = []
	const saved: string[] = []
	const missing: string[] = []

	for (const patch of newestFirst) {
		const dir = join(root, patch.name)
		await mkdir(dir, { recursive: true })
		const existing = await alreadyHave(dir)
		if (existing != null) {
			log(`${patch.name} already has ${existing}`)
			saved.push(patch.name)
			continue
		}
		const candidates = await gatherCandidates(patch)
		let done: string | null = null
		for (const c of candidates) {
			if (needsLocate(c)) continue
			done = await tryCandidate(root, patch.name, c)
			if (done != null) break
		}
		if (done != null) {
			log(`${patch.name} saved ${done}`)
			saved.push(patch.name)
			continue
		}
		pending.push({ patch, candidates })
	}

	const needGc = pending.some((item) => item.candidates.some(needsLocate))
	if (needGc) {
		await withGcSession({
			run: async ({ locate, login }) => {
				log(`GC session ${login}`)
				for (const item of pending) {
					if (await alreadyHave(join(root, item.patch.name))) continue
					let expired = 0
					for (const c of item.candidates) {
						if (!needsLocate(c)) continue
						try {
							const loc = await locate(c.matchId)
							if (
								loc.replayState === REPLAY_STATE.expired ||
								loc.replayState === REPLAY_STATE.notRecorded
							) {
								expired += 1
								log(
									`  ${item.patch.name} match ${String(c.matchId)} state=${String(loc.replayState)}`,
								)
								if (expired >= 3) break
								continue
							}
							if (loc.cluster == null || loc.replaySalt == null) {
								log(
									`  ${item.patch.name} match ${String(c.matchId)} no cluster/salt`,
								)
								continue
							}
							c.cluster = loc.cluster
							c.salt = loc.replaySalt
							c.sourceUrl = replayUrl(loc.cluster, c.matchId, loc.replaySalt)
							log(`  ${item.patch.name} ${c.sourceUrl}`)
							const dest = await tryCandidate(root, item.patch.name, c)
							if (dest != null) {
								log(`${item.patch.name} saved ${dest}`)
								saved.push(item.patch.name)
								break
							}
						} catch (error) {
							log(
								`  ${item.patch.name} match ${String(c.matchId)}: ${errorMessage(error)}`,
							)
						}
					}
				}
			},
		})
	}

	for (const item of pending) {
		if (saved.includes(item.patch.name)) continue
		log(`${item.patch.name} no replay available (CDN expired or GC empty)`)
		missing.push(item.patch.name)
	}
	log(
		`done saved=${saved.join(',') || '-'} missing=${missing.join(',') || '-'}`,
	)
	process.exit(saved.length === 0 ? 2 : 0)
}

await withStatus((line) => {
	console.error(line)
}, main)
