import { join } from 'node:path'

const root = join(import.meta.dir, '..')

if (!process.env.PGURI) {
	throw new Error('PGURI не задан: скопируй .env.example в .env и заполни')
}

const pull = Bun.spawn(['bunx', 'drizzle-kit', 'pull'], {
	cwd: root,
	stdio: ['inherit', 'inherit', 'inherit'],
})
const pullCode = await pull.exited
if (pullCode !== 0) process.exit(pullCode)

// drizzle-kit pull also writes a timestamped SQL snapshot; DDL is dbmate.
const cleanup = Bun.spawn(
	['bash', '-lc', 'rm -rf packages/shared/src/db/[0-9]*'],
	{
		cwd: root,
		stdio: ['inherit', 'inherit', 'inherit'],
	},
)
const cleanupCode = await cleanup.exited
if (cleanupCode !== 0) process.exit(cleanupCode)

const biome = Bun.spawn(
	[
		'bunx',
		'biome',
		'check',
		'--write',
		'packages/shared/src/db/schema.ts',
		'packages/shared/src/db/relations.ts',
	],
	{ cwd: root, stdio: ['inherit', 'inherit', 'inherit'] },
)
const biomeCode = await biome.exited
if (biomeCode !== 0) process.exit(biomeCode)

const schemaPath = join(root, 'packages/shared/src/db/schema.ts')
let schema = await Bun.file(schemaPath).text()
schema = schema.replace(/\n\tforeignKey,\n/, '\n')
schema = schema.replace(/\n\tprimaryKey,\n/, '\n')
const header =
	'// Снято с Postgres `bun run db:pull`. DDL — db/migrations, не этот файл.\n\n'
if (!schema.startsWith('// Снято')) schema = header + schema
await Bun.write(schemaPath, schema)
