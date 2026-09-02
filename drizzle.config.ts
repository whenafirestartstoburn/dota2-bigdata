import { defineConfig } from 'drizzle-kit'

const raw = process.env.PGURI ?? ''
const url = raw.includes('sslmode=')
	? raw
	: `${raw}${raw.includes('?') ? '&' : '?'}sslmode=disable`

export default defineConfig({
	dialect: 'postgresql',
	dbCredentials: { url },
	schema: './packages/shared/src/db/schema.ts',
	schemaFilter: ['public'],
	tablesFilter: ['!schema_migrations'],
	out: './packages/shared/src/db',
	introspect: { casing: 'preserve' },
})
