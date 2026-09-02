import { EventEmitter } from 'node:events'
import { type TLSSocket, connect as tlsConnect } from 'node:tls'

export function quoteImapString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function imapSinceDate(date: Date): string {
	const months = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	] as const
	const month = months[date.getUTCMonth()]
	if (month === undefined) throw new Error('invalid date')
	return `${date.getUTCDate()}-${month}-${date.getUTCFullYear()}`
}

/** `imap.yandex.ru:993` → host only; TLS port is always 993. */
export function imapHostname(stored: string): string {
	const trimmed = stored.trim()
	const cut = trimmed.lastIndexOf(':')
	if (cut <= 0) return trimmed
	const port = trimmed.slice(cut + 1)
	if (!/^\d+$/.test(port)) return trimmed
	return trimmed.slice(0, cut)
}

export function parseSearchUids(untagged: string[]): number[] {
	const uids: number[] = []
	for (const line of untagged) {
		const match = /^\* SEARCH(?: (.+))?$/i.exec(line.trim())
		if (match === null) continue
		const rest = match[1]
		if (rest === undefined || rest.trim() === '') continue
		for (const part of rest.trim().split(/\s+/)) {
			const n = Number(part)
			if (Number.isInteger(n) && n > 0) uids.push(n)
		}
	}
	return uids
}

export function parseStatusUidNext(lines: string[]): number | null {
	for (const line of lines) {
		const match = /UIDNEXT\s+(\d+)/i.exec(line)
		if (match?.[1] !== undefined) return Number(match[1])
	}
	return null
}

/** First UID to FETCH when looking at recent mail. Inclusive. */
export function recentMailStartUid(
	uidNext: number,
	excludeUids: readonly number[] = [],
	window = 50,
): number {
	const afterExcluded =
		excludeUids.length === 0 ? 1 : Math.max(...excludeUids) + 1
	const windowStart = Math.max(1, uidNext - window)
	return Math.max(afterExcluded, windowStart)
}

export function parseInternalDate(fetch: string): Date | null {
	const match = /INTERNALDATE "([^"]+)"/i.exec(fetch)
	const raw = match?.[1]
	if (raw === undefined) return null
	const parsed = Date.parse(raw)
	return Number.isNaN(parsed) ? null : new Date(parsed)
}

export function extractImapLiteral(
	raw: string,
	header: RegExp = /BODY(?:\.PEEK)?(?:\[\]|\[TEXT\]) \{(\d+)\}/i,
): string | null {
	const match = header.exec(raw)
	if (match === null || match[1] === undefined) return null
	const n = Number(match[1])
	let start = match.index + match[0].length
	if (raw.startsWith('\r\n', start)) start += 2
	else if (raw.startsWith('\n', start)) start += 1
	return raw.slice(start, start + n)
}

export function tryParseLogicalLine(
	buf: Buffer<ArrayBufferLike>,
): { line: string; rest: Buffer<ArrayBufferLike> } | null {
	const raw = buf.toString('latin1')
	let i = 0
	while (i < raw.length) {
		const crlf = raw.indexOf('\r\n', i)
		if (crlf < 0) return null
		const segment = raw.slice(i, crlf)
		const lit = /\{(\d+)\}$/.exec(segment)
		if (lit?.[1] !== undefined) {
			i = crlf + 2 + Number(lit[1])
			if (i > raw.length) return null
			continue
		}
		return {
			line: raw.slice(0, crlf),
			rest: buf.subarray(crlf + 2),
		}
	}
	return null
}

function taggedOk(line: string): boolean {
	return /^(?:\S+) OK\b/i.test(line)
}

export type ImapMessage = {
	uid: number
	date: Date | null
	raw: string
	body: string
}

export class ImapClient {
	private buf: Buffer<ArrayBufferLike> = Buffer.alloc(0)
	private seq = 0
	private tagSeq = 0
	private closed = false
	private readonly ee = new EventEmitter()

	private constructor(private readonly socket: TLSSocket) {
		socket.on('data', (chunk: Buffer) => {
			this.buf = Buffer.concat([this.buf, chunk])
			this.seq += 1
			this.ee.emit('chunk')
		})
		socket.on('error', () => {
			this.closed = true
			this.ee.emit('chunk')
		})
		socket.on('close', () => {
			this.closed = true
			this.ee.emit('chunk')
		})
	}

	static async connect(
		host: string,
		port = 993,
		timeoutMs = 20_000,
	): Promise<ImapClient> {
		const socket = tlsConnect({ host, port, servername: host })
		try {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error(`IMAP TLS timeout ${host}`))
				}, timeoutMs)
				socket.once('secureConnect', () => {
					clearTimeout(timer)
					resolve()
				})
				socket.once('error', (err) => {
					clearTimeout(timer)
					reject(err)
				})
			})
		} catch (error) {
			socket.destroy()
			throw error
		}
		const client = new ImapClient(socket)
		const greeting = await client.readLogicalLine(Date.now() + timeoutMs)
		if (!/^\* OK\b/i.test(greeting)) {
			client.destroy()
			throw new Error(`IMAP greeting from ${host}: ${greeting.slice(0, 120)}`)
		}
		return client
	}

	destroy(): void {
		this.closed = true
		this.socket.destroy()
	}

	async login(
		user: string,
		password: string,
		timeoutMs = 20_000,
	): Promise<void> {
		const quoted = await this.command(
			`LOGIN ${quoteImapString(user)} ${quoteImapString(password)}`,
			timeoutMs,
		)
		if (taggedOk(quoted.tagged)) return
		const b64 = Buffer.from(`\u0000${user}\u0000${password}`).toString('base64')
		const plain = await this.command(`AUTHENTICATE PLAIN ${b64}`, timeoutMs)
		if (taggedOk(plain.tagged)) return
		const loginText = quoted.tagged.slice(0, 180)
		const hint = /basic authentication is disabled/i.test(loginText)
			? ' Outlook.com no longer accepts IMAP username/password; Steam Guard email cannot be read until OAuth (XOAUTH2) is set up.'
			: ''
		throw new Error(`IMAP login failed: ${loginText}${hint}`)
	}

	async examineInbox(timeoutMs = 20_000): Promise<void> {
		const res = await this.command('EXAMINE INBOX', timeoutMs)
		if (!taggedOk(res.tagged)) {
			throw new Error(`IMAP EXAMINE failed: ${res.tagged.slice(0, 160)}`)
		}
	}

	async noop(timeoutMs = 10_000): Promise<void> {
		const res = await this.command('NOOP', timeoutMs)
		if (!taggedOk(res.tagged)) {
			throw new Error(`IMAP NOOP failed: ${res.tagged.slice(0, 160)}`)
		}
	}

	async statusInbox(timeoutMs = 15_000): Promise<{ uidNext: number | null }> {
		const res = await this.command('STATUS INBOX (UIDNEXT MESSAGES)', timeoutMs)
		return {
			uidNext: parseStatusUidNext([...res.untagged, res.tagged]),
		}
	}

	async uidSearch(criteria: string, timeoutMs = 20_000): Promise<number[]> {
		const res = await this.command(`UID SEARCH ${criteria}`, timeoutMs)
		if (!taggedOk(res.tagged)) {
			throw new Error(`IMAP SEARCH failed: ${res.tagged.slice(0, 160)}`)
		}
		return parseSearchUids(res.untagged)
	}

	async fetchMessage(uid: number, timeoutMs = 30_000): Promise<ImapMessage> {
		const res = await this.command(
			`UID FETCH ${String(uid)} (INTERNALDATE BODY.PEEK[])`,
			timeoutMs,
		)
		if (!taggedOk(res.tagged)) {
			throw new Error(`IMAP FETCH ${String(uid)} failed`)
		}
		const raw = res.untagged.join('\r\n')
		return {
			uid,
			date: parseInternalDate(raw),
			raw,
			body: extractImapLiteral(raw) ?? raw,
		}
	}

	async logout(timeoutMs = 5_000): Promise<void> {
		try {
			await this.command('LOGOUT', timeoutMs)
		} catch {
			// closing anyway
		}
		this.destroy()
	}

	private nextTag(): string {
		this.tagSeq += 1
		return `A${String(this.tagSeq).padStart(4, '0')}`
	}

	private async command(
		cmd: string,
		timeoutMs: number,
	): Promise<{ tagged: string; untagged: string[] }> {
		const tag = this.nextTag()
		const deadline = Date.now() + timeoutMs
		this.socket.write(`${tag} ${cmd}\r\n`)
		const untagged: string[] = []
		while (true) {
			const line = await this.readLogicalLine(deadline)
			if (line.startsWith('+')) {
				throw new Error(`IMAP continuation unsupported: ${line.slice(0, 80)}`)
			}
			if (line.startsWith(`${tag} `)) {
				return { tagged: line, untagged }
			}
			untagged.push(line)
		}
	}

	private async readLogicalLine(deadline: number): Promise<string> {
		while (true) {
			const seen = this.seq
			const parsed = tryParseLogicalLine(this.buf)
			if (parsed !== null) {
				this.buf = parsed.rest
				return parsed.line
			}
			if (this.seq !== seen) continue
			if (this.closed) throw new Error('IMAP connection closed')
			await this.waitChunk(deadline)
		}
	}

	private waitChunk(deadline: number): Promise<void> {
		const remaining = deadline - Date.now()
		if (remaining <= 0) throw new Error('IMAP timeout')
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup()
				reject(new Error('IMAP timeout'))
			}, remaining)
			const onChunk = () => {
				cleanup()
				resolve()
			}
			const cleanup = () => {
				clearTimeout(timer)
				this.ee.off('chunk', onChunk)
			}
			this.ee.once('chunk', onChunk)
		})
	}
}
