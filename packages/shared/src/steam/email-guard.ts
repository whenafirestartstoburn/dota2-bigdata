import {
	emailBodyToText,
	parseSteamMail,
	type SteamGuardMailKind,
} from '#src/steam/guard-code'
import { ImapClient, imapHostname, recentMailStartUid } from '#src/steam/imap'
import { errorMessage } from '#src/store/coerce'
import { logger } from '#src/utils/logger'
import { status } from '#src/utils/status'

export type SteamMailbox = {
	email: string
	password: string
	host?: string | null
}

export type SteamGuardMail = {
	code: string
	uid: number
	date: string | null
	kind: SteamGuardMailKind
	template: string | null
	host: string
}

async function openMailbox(
	mailbox: SteamMailbox,
): Promise<{ client: ImapClient; host: string }> {
	const stored = mailbox.host?.trim() ?? ''
	if (stored === '') {
		throw new Error(
			'no IMAP host stored for this account — set steam_accounts.email_imap_host',
		)
	}
	const host = imapHostname(stored)
	const client = await ImapClient.connect(host)
	try {
		await client.login(mailbox.email, mailbox.password)
		await client.examineInbox()
		return { client, host }
	} catch (error) {
		client.destroy()
		throw error
	}
}

async function recentUids(
	client: ImapClient,
	excludeUids: readonly number[] = [],
	window = 50,
): Promise<number[]> {
	try {
		await client.noop()
	} catch (error) {
		logger.debug({ err: errorMessage(error) }, 'IMAP NOOP failed')
	}
	const inbox = await client.statusInbox()
	const uidNext = inbox.uidNext
	if (uidNext == null || uidNext <= 1) return []
	const start = recentMailStartUid(uidNext, excludeUids, window)
	try {
		return [...new Set(await client.uidSearch(`UID ${String(start)}:*`))].sort(
			(a, b) => a - b,
		)
	} catch (error) {
		logger.debug(
			{ err: errorMessage(error), start, uidNext },
			'IMAP UID SEARCH failed; walking UID range',
		)
		const uids: number[] = []
		for (let uid = start; uid < uidNext; uid++) uids.push(uid)
		return uids
	}
}

function mailFromFetch(input: {
	uid: number
	date: Date | null
	body: string
	host: string
	after?: Date
	kind?: SteamGuardMailKind
	excludeUids?: readonly number[]
	excludeCodes?: readonly string[]
}): SteamGuardMail | null {
	if (input.excludeUids?.includes(input.uid) === true) return null
	if (
		input.after !== undefined &&
		input.date !== null &&
		input.date.getTime() < input.after.getTime() - 30_000
	) {
		return null
	}
	const parsed = parseSteamMail(input.body)
	if (parsed.code === null) return null
	if (parsed.kind === 'other') return null
	if (input.kind !== undefined && parsed.kind !== input.kind) return null
	if (input.excludeCodes?.includes(parsed.code) === true) return null
	return {
		code: parsed.code,
		uid: input.uid,
		date: input.date?.toISOString() ?? null,
		kind: parsed.kind,
		template: parsed.template,
		host: input.host,
	}
}

export async function fetchSteamGuardFromMailbox(input: {
	mailbox: SteamMailbox
	after: Date
	kind: SteamGuardMailKind
	excludeUids?: readonly number[]
	excludeCodes?: readonly string[]
	timeoutMs?: number
	pollMs?: number
}): Promise<SteamGuardMail> {
	const timeoutMs = input.timeoutMs ?? 90_000
	const pollMs = input.pollMs ?? 3_000
	const { client, host } = await openMailbox(input.mailbox)
	status(
		`imap: inbox open host=${host} email=${input.mailbox.email} kind=${input.kind}`,
	)
	const deadline = Date.now() + timeoutMs
	try {
		while (Date.now() < deadline) {
			const uids = await recentUids(client, input.excludeUids)
			for (const uid of uids.slice().reverse()) {
				let msg: Awaited<ReturnType<ImapClient['fetchMessage']>>
				try {
					msg = await client.fetchMessage(uid)
				} catch (error) {
					logger.debug({ uid, err: errorMessage(error) }, 'IMAP FETCH skipped')
					continue
				}
				const found = mailFromFetch({
					uid,
					date: msg.date,
					body: msg.body,
					host,
					after: input.after,
					kind: input.kind,
					excludeUids: input.excludeUids,
					excludeCodes: input.excludeCodes,
				})
				if (found === null) continue
				status(
					`imap: extracted Steam Guard uid=${String(uid)} kind=${found.kind} template=${found.template ?? '-'}`,
				)
				return found
			}
			await Bun.sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
		}
		throw new Error(
			`no ${input.kind} Steam email for ${input.mailbox.email} within ${String(timeoutMs)}ms`,
		)
	} finally {
		await client.logout()
	}
}

export type LatestSteamGuardMails = {
	host: string
	login: SteamGuardMail | null
	authenticator: SteamGuardMail | null
}

/** Newest login Guard and authenticator-setup codes already in the mailbox. */
export async function latestSteamGuardMails(
	mailbox: SteamMailbox,
): Promise<LatestSteamGuardMails> {
	const { client, host } = await openMailbox(mailbox)
	status(`imap: inbox open host=${host} email=${mailbox.email}`)
	try {
		const uids = await recentUids(client, [], 150)
		let login: SteamGuardMail | null = null
		let authenticator: SteamGuardMail | null = null
		for (const uid of uids.slice().reverse()) {
			if (login !== null && authenticator !== null) break
			const msg = await client.fetchMessage(uid)
			const found = mailFromFetch({
				uid,
				date: msg.date,
				body: msg.body,
				host,
			})
			if (found === null) continue
			if (found.kind === 'login' && login === null) login = found
			if (found.kind === 'authenticator' && authenticator === null) {
				authenticator = found
			}
		}
		return { host, login, authenticator }
	} finally {
		await client.logout()
	}
}

export type ImapProbeSample = {
	uid: number
	date: string | null
	code: string | null
	kind: SteamGuardMailKind | 'other' | null
	template: string | null
	snippet: string
}

export async function probeImapInbox(mailbox: SteamMailbox): Promise<{
	host: string
	uidNext: number | null
	samples: ImapProbeSample[]
}> {
	const { client, host } = await openMailbox(mailbox)
	try {
		const inbox = await client.statusInbox()
		const uids = await recentUids(client, [], 150)
		const newest = uids.slice(-5).reverse()
		const samples: ImapProbeSample[] = []
		for (const uid of newest) {
			const msg = await client.fetchMessage(uid)
			const parsed = parseSteamMail(msg.body)
			const snippet = emailBodyToText(msg.body).slice(0, 160)
			samples.push({
				uid,
				date: msg.date?.toISOString() ?? null,
				code: parsed.code,
				kind: parsed.kind,
				template: parsed.template,
				snippet,
			})
		}
		return { host, uidNext: inbox.uidNext, samples }
	} finally {
		await client.logout()
	}
}
