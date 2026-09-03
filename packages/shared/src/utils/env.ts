import { z } from 'zod'

export const baseEnv = z.object({
	// <template:baseEnv>
	NODE_ENV: z.enum(['development', 'production']),
	CORS_ORIGINS: z.string().default('http://localhost:5173'),
	PGURI: z.string().min(1),
	LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
	// </template:baseEnv>
	CLICKHOUSE_URL: z.string().default('http://localhost:8123'),
	CLICKHOUSE_USER: z.string().default('default'),
	CLICKHOUSE_PASSWORD: z.string().default(''),
	CLICKHOUSE_DATABASE: z.string().default('dota'),
	S3_ENDPOINT: z.preprocess(
		(value) => (value === '' ? undefined : value),
		z.string().optional(),
	),
	S3_REGION: z.string().default('us-east-1'),
	S3_BUCKET: z.string().min(1),
	S3_ACCESS_KEY: z.string().min(1),
	S3_SECRET_KEY: z.string().min(1),
	S3_FORCE_PATH_STYLE: z
		.string()
		.default('false')
		.transform((value) => value !== 'false'),
	STEAM_SEED_LOGIN: z.string().default(''),
	STEAM_SEED_PASSWORD: z.string().default(''),
	STEAM_SEED_API_KEY: z.string().default(''),
	STEAM_SEED_SHARED_SECRET: z.string().default(''),
	STEAM_SEED_IDENTITY_SECRET: z.string().default(''),
	DARK_SHOPPING_BASE_URL: z.string().default('https://dark.shopping'),
	DARK_SHOPPING_API_KEY: z.string().default(''),
})

export default baseEnv.parse(process.env)
