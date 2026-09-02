import { parseArgs } from 'node:util'
import {
	getSteamMailbox,
	upsertSteamAccount,
} from '@app/shared/src/components/resources'
import { probeImapInbox } from '@app/shared/src/steam/email-guard'
import { parseG2gAccountsCsv } from '#src/g2g-csv'

const USAGE = `steam:import <command>

  import --file <csv>   upsert G2G Steam accounts (login, password, Outlook IMAP)
  probe  --login <id>   IMAP login and list recent messages (no passwords logged)

Passwords are read from the CSV / database and never printed.
`

async function cmdImport(file: string | undefined): Promise<void> {
	if (file === undefined || file === '') {
		throw new Error('import requires --file <path>')
	}
	const text = await Bun.file(file).text()
	const rows = parseG2gAccountsCsv(text)
	if (rows.length === 0) throw new Error(`no accounts in ${file}`)
	const saved: string[] = []
	for (const row of rows) {
		const id = await upsertSteamAccount({
			login: row.login,
			password: row.password,
			email: row.email === '' ? null : row.email,
			emailPassword: row.emailPassword === '' ? null : row.emailPassword,
			emailImapHost: row.emailImapHost,
		})
		saved.push(`${row.login} (id=${String(id)} ${row.email})`)
	}
	console.error(`imported ${String(saved.length)} account(s):`)
	for (const line of saved) console.error(`  ${line}`)
}

async function cmdProbe(login: string | undefined): Promise<void> {
	if (login === undefined || login === '') {
		throw new Error('probe requires --login')
	}
	const mailbox = await getSteamMailbox(login)
	if (mailbox === null) {
		throw new Error(
			`no IMAP mailbox stored for login=${login} — import the CSV first`,
		)
	}
	console.error(`IMAP probe ${login} ${mailbox.email} …`)
	const result = await probeImapInbox({
		email: mailbox.email,
		password: mailbox.emailPassword,
		host: mailbox.emailImapHost,
	})
	console.error(`host=${result.host} uidNext=${String(result.uidNext)}`)
	if (result.samples.length === 0) {
		console.error('inbox has no recent messages (LOGIN succeeded)')
		return
	}
	for (const sample of result.samples) {
		console.error(
			`uid=${String(sample.uid)} date=${sample.date ?? '-'} kind=${sample.kind ?? '-'} template=${sample.template ?? '-'} code=${sample.code ?? '-'}`,
		)
		console.error(`  ${sample.snippet}`)
	}
}

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		options: {
			file: { type: 'string', short: 'f' },
			login: { type: 'string' },
		},
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
		await cmdProbe(values.login)
		return 0
	}
	console.error(`unknown command ${command}\n\n${USAGE}`)
	return 1
}

if (import.meta.main) {
	process.exit(await main(Bun.argv.slice(2)))
}
