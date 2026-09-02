export type G2gAccountRow = {
	login: string
	password: string
	email: string
	emailPassword: string
	emailImapHost: string | null
}

export function parseCsvLine(line: string): string[] {
	const fields: string[] = []
	let i = 0
	while (i < line.length) {
		if (line[i] === '"') {
			i += 1
			let field = ''
			while (i < line.length) {
				if (line[i] === '"') {
					if (line[i + 1] === '"') {
						field += '"'
						i += 2
						continue
					}
					i += 1
					break
				}
				field += line[i]
				i += 1
			}
			fields.push(field)
			if (line[i] === ',') i += 1
			continue
		}
		const comma = line.indexOf(',', i)
		if (comma < 0) {
			fields.push(line.slice(i))
			break
		}
		fields.push(line.slice(i, comma))
		i = comma + 1
	}
	return fields
}

function colIndex(header: string[], name: string): number {
	const i = header.findIndex(
		(item) => item.trim().toLowerCase() === name.toLowerCase(),
	)
	if (i < 0) throw new Error(`CSV missing column "${name}"`)
	return i
}

export function parseG2gAccountsCsv(text: string): G2gAccountRow[] {
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
	const headerLine = lines[0]
	if (headerLine === undefined) return []
	const header = parseCsvLine(headerLine)
	const iLogin = colIndex(header, 'Account ID')
	const iPass = colIndex(header, 'Password')
	const iEmail = colIndex(header, 'Account Email')
	const iEmailPass = colIndex(header, 'Email Password')
	const iNote = header.findIndex(
		(item) => item.trim().toLowerCase() === 'additional note',
	)
	const rows: G2gAccountRow[] = []
	for (const line of lines.slice(1)) {
		const cols = parseCsvLine(line)
		const login = (cols[iLogin] ?? '').trim().replace(/^'/, '')
		const password = cols[iPass] ?? ''
		const email = (cols[iEmail] ?? '').trim()
		const emailPassword = cols[iEmailPass] ?? ''
		const note = (iNote >= 0 ? (cols[iNote] ?? '') : '').trim()
		if (login === '' || password === '') continue
		rows.push({
			login,
			password,
			email,
			emailPassword,
			emailImapHost: note === '' ? null : note,
		})
	}
	return rows
}
