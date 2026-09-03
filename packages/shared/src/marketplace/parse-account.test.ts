import { describe, expect, test } from 'bun:test'
import {
	describeBoughtAccount,
	parseBoughtSteamAccounts,
	redactBoughtDelivery,
} from './parse-account'

describe('parseBoughtSteamAccounts', () => {
	test('reads the login:password:email:mailpass line after the order banner', () => {
		const text = [
			'Заказ: 8156194',
			'ads and mirrors',
			'↓↓↓↓                            Ваш заказ:                             ↓↓↓↓',
			'',
			'jhkqapui4652:Qj8N19Hw2pcx:rachaelortiz1924@shevamail.com:vwjgnhkkY4761',
		].join('\n')
		expect(parseBoughtSteamAccounts(text)).toEqual([
			{
				login: 'jhkqapui4652',
				password: 'Qj8N19Hw2pcx',
				email: 'rachaelortiz1924@shevamail.com',
				emailPassword: 'vwjgnhkkY4761',
			},
		])
	})

	test('ignores ads and duplicate logins', () => {
		const text = [
			'Ваш заказ:',
			'not-an-account',
			'a:b:c@d.e:f',
			'a:b:c@d.e:f',
		].join('\n')
		expect(parseBoughtSteamAccounts(text)).toHaveLength(1)
		expect(parseBoughtSteamAccounts(text)[0]?.login).toBe('a')
	})

	test('reads a labeled Login Steam / Email Login block without Ваш заказ', () => {
		const text =
			'Login Steam: gearlength461 Password Steam: K7ZNQ7zAUaoSdZ Email Login: jason1541@baertkalba.live Email Password: VN24lIEe8mY9'
		expect(parseBoughtSteamAccounts(text)).toEqual([
			{
				login: 'gearlength461',
				password: 'K7ZNQ7zAUaoSdZ',
				email: 'jason1541@baertkalba.live',
				emailPassword: 'VN24lIEe8mY9',
			},
		])
	})

	test('reads labeled fields split across lines', () => {
		const text = [
			'Login Steam: gcuser1',
			'Password Steam: secretPass',
			'Email Login: user@baertkalba.live',
			'Email Password: mailSecret',
		].join('\n')
		expect(parseBoughtSteamAccounts(text)[0]).toEqual({
			login: 'gcuser1',
			password: 'secretPass',
			email: 'user@baertkalba.live',
			emailPassword: 'mailSecret',
		})
	})

	test('describes login and email without passwords', () => {
		expect(
			describeBoughtAccount({
				login: 'jhkqapui4652',
				password: 'Qj8N19Hw2pcx',
				email: 'rachaelortiz1924@shevamail.com',
				emailPassword: 'vwjgnhkkY4761',
			}),
		).toBe('login=jhkqapui4652 email=rachaelortiz1924@shevamail.com')
	})

	test('redacts password fields in delivery lines', () => {
		const text = [
			'Ваш заказ:',
			'jhkqapui4652:Qj8N19Hw2pcx:rachaelortiz1924@shevamail.com:vwjgnhkkY4761',
		].join('\n')
		expect(redactBoughtDelivery(text)).toBe(
			[
				'Ваш заказ:',
				'jhkqapui4652:***:rachaelortiz1924@shevamail.com:***',
			].join('\n'),
		)
		expect(
			redactBoughtDelivery(
				'Login Steam: gearlength461 Password Steam: K7ZNQ7zAUaoSdZ Email Login: jason1541@baertkalba.live Email Password: VN24lIEe8mY9',
			),
		).toBe(
			'Login Steam: gearlength461 Password Steam: *** Email Login: jason1541@baertkalba.live Email Password: ***',
		)
	})
})
