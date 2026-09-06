import { describe, expect, test } from 'bun:test'
import { HttpError, handleError, json, readJson } from '#src/http'

describe('readJson', () => {
	test('rejects invalid JSON as HttpError 400', async () => {
		await expect(
			readJson(new Request('http://x.test', { method: 'POST', body: '{' })),
		).rejects.toMatchObject({ name: 'HttpError', status: 400 })
	})
})

describe('handleError', () => {
	test('returns the status from HttpError', async () => {
		const response = handleError(
			new Request('http://x.test'),
			new HttpError(404, 'not found'),
		)
		expect(response.status).toBe(404)
		expect(await response.json()).toEqual({ error: 'not found' })
	})
})

describe('json', () => {
	test('serializes the body', async () => {
		const response = json(new Request('http://x.test'), { ok: true }, 201)
		expect(response.status).toBe(201)
		expect(await response.json()).toEqual({ ok: true })
	})
})
