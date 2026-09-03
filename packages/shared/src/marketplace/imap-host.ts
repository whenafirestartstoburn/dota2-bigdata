import { ImapClient, imapHostname } from '#src/steam/imap'
import { errorMessage } from '#src/store/coerce'
import { status } from '#src/utils/status'

const OUTLOOK_DOMAINS = new Set([
	'hotmail.com',
	'outlook.com',
	'live.com',
	'msn.com',
	'outlook.co.uk',
	'hotmail.co.uk',
])

export class OutlookImapError extends Error {
	constructor(email: string) {
		super(
			`IMAP mailer is Outlook/Hotmail (${email}): basic auth is disabled, so Guard email cannot be read and an API key cannot be issued (purchase already spent)`,
		)
		this.name = 'OutlookImapError'
	}
}

export class UnknownMailerError extends Error {
	constructor(email: string, tried: readonly string[]) {
		super(
			`IMAP mailer is unknown for ${email}; tried ${tried.join(', ') || '(none)'} and could not LOGIN`,
		)
		this.name = 'UnknownMailerError'
	}
}

export function emailDomain(email: string): string {
	const at = email.lastIndexOf('@')
	return at < 0 ? email.trim().toLowerCase() : email.slice(at + 1).toLowerCase()
}

export function isOutlookMailer(email: string): boolean {
	const domain = emailDomain(email)
	if (OUTLOOK_DOMAINS.has(domain)) return true
	return domain.endsWith('.outlook.com') || domain.endsWith('.hotmail.com')
}

export function knownImapHost(email: string): string | null {
	const domain = emailDomain(email)
	if (domain === 'smakmail.com' || domain.endsWith('.smakmail.com')) {
		return 'imap.smakmail.com'
	}
	if (domain === 'firstmail.ltd' || domain.endsWith('.firstmail.ltd')) {
		return 'imap.firstmail.ltd'
	}
	return null
}

export function imapProbeHosts(email: string): string[] {
	const domain = emailDomain(email)
	const known = knownImapHost(email)
	const hosts = [
		known,
		`imap.${domain}`,
		`mail.${domain}`,
		'imap.firstmail.ltd',
		'imap.smakmail.com',
	].filter((host): host is string => host != null && host !== '')
	return [...new Set(hosts.map(imapHostname))]
}

async function tryMailbox(
	host: string,
	email: string,
	password: string,
): Promise<boolean> {
	const client = await ImapClient.connect(host)
	try {
		await client.login(email, password)
		await client.examineInbox()
		return true
	} finally {
		await client.logout()
	}
}

export async function resolveImapHost(input: {
	email: string
	password: string
	host?: string | null
}): Promise<{ host: string; probed: boolean }> {
	if (isOutlookMailer(input.email)) {
		throw new OutlookImapError(input.email)
	}
	const explicit =
		input.host != null && input.host.trim() !== ''
			? imapHostname(input.host)
			: null
	if (explicit !== null) {
		status(`imap: LOGIN ${input.email} at ${explicit}`)
		try {
			const ok = await tryMailbox(explicit, input.email, input.password)
			if (ok) return { host: explicit, probed: false }
		} catch (error) {
			throw new Error(
				`IMAP host ${explicit} failed for ${input.email}: ${errorMessage(error)}`,
			)
		}
		throw new Error(`IMAP host ${explicit} failed LOGIN for ${input.email}`)
	}
	const known = knownImapHost(input.email)
	if (known !== null) {
		status(`imap: known host ${known} for ${input.email}`)
		try {
			const ok = await tryMailbox(known, input.email, input.password)
			if (ok) return { host: known, probed: false }
		} catch (error) {
			throw new Error(
				`known IMAP host ${known} failed for ${input.email}: ${errorMessage(error)}`,
			)
		}
	}
	const tried: string[] = []
	for (const host of imapProbeHosts(input.email)) {
		if (host === known) continue
		tried.push(host)
		status(`imap: probing ${host} for ${input.email}`)
		try {
			const ok = await tryMailbox(host, input.email, input.password)
			if (ok) return { host, probed: true }
		} catch {
			// next candidate
		}
	}
	throw new UnknownMailerError(input.email, tried)
}
