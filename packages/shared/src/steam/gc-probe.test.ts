import { describe, expect, test } from 'bun:test'
import { isTransientCmClose } from './gc-probe'

describe('isTransientCmClose', () => {
	test('treats CM websocket drops as retryable', () => {
		expect(isTransientCmClose(new Error('Socket closed'))).toBe(true)
		expect(isTransientCmClose(new Error('NoConnection'))).toBe(true)
		expect(isTransientCmClose(new Error('ECONNRESET'))).toBe(true)
	})

	test('does not retry Steam auth failures', () => {
		expect(isTransientCmClose(new Error('InvalidPassword'))).toBe(false)
		expect(isTransientCmClose(new Error('TwoFactorCodeMismatch'))).toBe(false)
	})
})
