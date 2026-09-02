import { parseArgs } from 'node:util'
import {
	listProxies,
	type ProxyKind,
	type ProxyPurpose,
	proxyHostPort,
	proxyUrlWithScheme,
	upsertProxy,
} from '@app/shared/src/components/proxies'
import { errorMessage } from '@app/shared/src/store/coerce'

const USAGE = `steam:proxies <command>

  import --file <path>   probe endpoints and upsert into proxies
  probe                  re-test every row already in proxies

File lines (comments with # are ignored):

  socks5 user:pass@host:port
  http user:pass@host:port
`

const PROBE_URL = 'https://api.ipify.org?format=json'
const PROBE_MS = 20_000

type ProbeResult = {
	ok: boolean
	purpose: ProxyPurpose
	error: string | null
	ip: string | null
}

function parseKind(value: string): ProxyKind {
	if (value === 'socks5' || value === 'socks') return 'socks5'
	if (value === 'http' || value === 'https') return 'http'
	throw new Error(`unknown proxy kind ${value}`)
}

async function bunFetchVia(proxyUrl: string): Promise<{
	ok: boolean
	ip: string | null
	error: string | null
}> {
	try {
		const response = await fetch(PROBE_URL, {
			proxy: proxyUrl,
			signal: AbortSignal.timeout(PROBE_MS),
		})
		const text = await response.text()
		if (!response.ok) {
			return {
				ok: false,
				ip: null,
				error: `HTTP ${String(response.status)} ${text.slice(0, 80)}`,
			}
		}
		let ip: string | null = text.trim()
		try {
			const parsed = JSON.parse(text) as { ip?: unknown }
			if (typeof parsed.ip === 'string') ip = parsed.ip
		} catch {
			// ipify ?format=json usually returns JSON; plain-text IP is fine
		}
		return { ok: true, ip, error: null }
	} catch (error) {
		return {
			ok: false,
			ip: null,
			error: errorMessage(error),
		}
	}
}

async function curlSocks(proxyUrl: string): Promise<{
	ok: boolean
	ip: string | null
	error: string | null
}> {
	const parsed = new URL(proxyUrl)
	const auth = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
	const host = `${parsed.hostname}:${parsed.port}`
	const proc = Bun.spawn(
		[
			'curl',
			'-sS',
			'-m',
			'20',
			'--socks5-hostname',
			`${auth}@${host}`,
			PROBE_URL,
		],
		{ stdout: 'pipe', stderr: 'pipe' },
	)
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	])
	const code = await proc.exited
	if (code !== 0) {
		return {
			ok: false,
			ip: null,
			error: stderr.trim().slice(0, 200) || `curl exited ${String(code)}`,
		}
	}
	const text = stdout.trim()
	let ip: string | null = text
	try {
		const parsedJson = JSON.parse(text) as { ip?: unknown }
		if (typeof parsedJson.ip === 'string') ip = parsedJson.ip
	} catch {
		// plain-text IP
	}
	return { ok: true, ip, error: null }
}

async function probe(kind: ProxyKind, url: string): Promise<ProbeResult> {
	const bun = await bunFetchVia(url)
	if (bun.ok) {
		return { ok: true, purpose: 'both', error: null, ip: bun.ip }
	}
	if (kind === 'socks5') {
		const socks = await curlSocks(url)
		if (socks.ok) {
			return { ok: true, purpose: 'gc', error: bun.error, ip: socks.ip }
		}
		return {
			ok: false,
			purpose: 'gc',
			error: socks.error ?? bun.error,
			ip: null,
		}
	}
	return { ok: false, purpose: 'api', error: bun.error, ip: null }
}

function parseFile(text: string): Array<{ kind: ProxyKind; raw: string }> {
	const rows: Array<{ kind: ProxyKind; raw: string }> = []
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim()
		if (trimmed === '' || trimmed.startsWith('#')) continue
		const space = trimmed.search(/\s/)
		if (space <= 0) {
			throw new Error(`expected "<kind> <endpoint>", got: ${trimmed}`)
		}
		const kind = parseKind(trimmed.slice(0, space))
		const raw = trimmed.slice(space).trim()
		if (raw === '') throw new Error(`missing endpoint on line: ${trimmed}`)
		rows.push({ kind, raw })
	}
	return rows
}

async function upsertProbed(
	kind: ProxyKind,
	raw: string,
	name?: string,
): Promise<void> {
	const url = proxyUrlWithScheme(raw, kind)
	const host = proxyHostPort(url)
	const label = name ?? `dataimpulse-${kind}-${host.split(':').at(-1) ?? host}`
	const result = await probe(kind, url)
	await upsertProxy({
		name: label,
		url,
		kind,
		purpose: result.purpose,
		status: result.ok ? 'ready' : 'disabled',
		lastError: result.ok ? null : result.error,
	})
	const ip = result.ip == null ? '' : ` ip=${result.ip}`
	const err = result.ok ? '' : ` error=${result.error ?? 'failed'}`
	console.error(
		`${result.ok ? 'ok' : 'DEAD'} ${label} ${host} purpose=${result.purpose}${ip}${err}`,
	)
}

async function cmdImport(file: string | undefined): Promise<void> {
	if (file === undefined || file === '') {
		throw new Error('import requires --file <path>')
	}
	const text = await Bun.file(file).text()
	const rows = parseFile(text)
	if (rows.length === 0) throw new Error(`no proxies in ${file}`)
	for (const row of rows) {
		await upsertProbed(row.kind, row.raw)
	}
}

async function cmdProbe(): Promise<void> {
	const rows = await listProxies()
	if (rows.length === 0) throw new Error('proxies table is empty')
	for (const row of rows) {
		await upsertProbed(row.kind, row.url, row.name)
	}
}

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		options: { file: { type: 'string', short: 'f' } },
		allowPositionals: true,
	})
	const command = positionals[0]
	if (command === undefined || command === 'help' || command === '--help') {
		console.log(USAGE)
		return command === undefined ? 1 : 0
	}
	if (command === 'import') {
		await cmdImport(values.file)
		return 0
	}
	if (command === 'probe') {
		await cmdProbe()
		return 0
	}
	console.error(`unknown command ${command}\n\n${USAGE}`)
	return 1
}

if (import.meta.main) {
	try {
		process.exit(await main(Bun.argv.slice(2)))
	} catch (error) {
		console.error(errorMessage(error))
		process.exit(1)
	}
}
