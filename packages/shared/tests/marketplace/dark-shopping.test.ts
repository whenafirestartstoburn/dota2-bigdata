import { describe, expect, test } from 'bun:test'
import {
	classifyDarkOrderStatus,
	DarkShoppingError,
	parseDarkOrderIdFromMessage,
	parseOrderCreate,
	parseOrderDownload,
	parseOrderStatus,
	redactSecret,
	truncateForLog,
} from '#src/marketplace/dark-shopping'

describe('dark.shopping response parsers', () => {
	test('parses an immediate ok create with a download link', () => {
		expect(
			parseOrderCreate({
				success: true,
				data: {
					status: 'ok',
					id: 1458,
					link: 'https://dark.shopping/storage/abc.txt',
				},
			}),
		).toEqual({
			status: 'ok',
			id: 1458,
			link: 'https://dark.shopping/storage/abc.txt',
			idempotence: false,
		})
	})

	test('parses pending create and completed status', () => {
		expect(
			parseOrderCreate({
				success: true,
				data: { status: 'pending', id: 239, idempotence: true },
			}),
		).toEqual({ status: 'pending', id: 239, idempotence: true })
		expect(
			parseOrderStatus({ success: true, data: { status: 'completed' } }),
		).toBe('completed')
		expect(
			parseOrderDownload({
				success: true,
				data: { link: 'https://dark.shopping/storage/x.txt' },
			}),
		).toBe('https://dark.shopping/storage/x.txt')
	})

	test('maps API errors to DarkShoppingError', () => {
		expect(() =>
			parseOrderCreate({
				success: false,
				data: {
					name: 'Bad request',
					message: 'Недостаточно средств на балансе.',
					status: 400,
				},
			}),
		).toThrow(DarkShoppingError)
	})

	test('classifies Dark Shopping statuses', () => {
		expect(classifyDarkOrderStatus('completed')).toBe('ready')
		expect(classifyDarkOrderStatus('ok')).toBe('ready')
		expect(classifyDarkOrderStatus('error')).toBe('failed')
		expect(classifyDarkOrderStatus('canceled')).toBe('failed')
		expect(classifyDarkOrderStatus('refund')).toBe('failed')
		expect(classifyDarkOrderStatus('in_process')).toBe('pending')
		expect(classifyDarkOrderStatus('pending')).toBe('pending')
	})

	test('parses a Dark Shopping order id from a wait-timeout message', () => {
		expect(
			parseDarkOrderIdFromMessage(
				'dark.shopping order 8262790 still in_process after 120000ms',
			),
		).toBe(8262790)
		expect(parseDarkOrderIdFromMessage(null)).toBeNull()
		expect(parseDarkOrderIdFromMessage('unrelated')).toBeNull()
	})

	test('truncates flattened text and redacts a secret', () => {
		expect(truncateForLog('  hello   world  ', 20)).toBe('hello world')
		expect(truncateForLog('abcdefghij', 7)).toBe('abcdefg…')
		expect(
			redactSecret(
				'https://dark.shopping/api/v1/order/status?key=abc123&id=1',
				'abc123',
			),
		).toBe('https://dark.shopping/api/v1/order/status?key=<key>&id=1')
	})
})
