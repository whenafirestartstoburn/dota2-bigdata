import { describe, expect, test } from 'bun:test'
import {
	extractSteamGuardCode,
	parseSteamMail,
	steamEmailTemplateName,
} from '#src/steam/guard-code'

function steamHtml(template: string, inner: string): string {
	return [
		'Content-Type: text/html; charset=UTF-8',
		'Content-Transfer-Encoding: quoted-printable',
		'',
		'<html><body>',
		`<img src=3D"https://store.steampowered.com/email/${template}?x=3D1" />`,
		inner,
		'</body></html>',
	].join('\r\n')
}

describe('extractSteamGuardCode', () => {
	test('reads a plain-text Steam Guard mail', () => {
		const body = [
			'Here is the Steam Guard code you need to login to account pqub30458:',
			'',
			'B3N7K',
			'',
			'This email was generated because of a login attempt.',
		].join('\n')
		expect(extractSteamGuardCode(body)).toBe('B3N7K')
	})

	test('reads a quoted-printable HTML mail', () => {
		const body = [
			'Content-Type: text/html; charset=UTF-8',
			'Content-Transfer-Encoding: quoted-printable',
			'',
			'<html><body>',
			'<p>Here is the Steam Guard code you need to access your account:</p>',
			'<h2 style=3D"font-size:24px">MNBV2</h2>',
			'</body></html>',
		].join('\r\n')
		expect(extractSteamGuardCode(body)).toBe('MNBV2')
	})

	test('ignores prose that is not a Guard code', () => {
		expect(extractSteamGuardCode('Welcome to Steam. Enjoy your games.')).toBe(
			null,
		)
	})
})

describe('parseSteamMail', () => {
	test('classifies a login Guard mail by the English tracking path', () => {
		const raw = steamHtml(
			'codefornewwebloginwithiplocwarning',
			['<p>HelpUnauthorizedLogin</p>', '<h2>PQVVV</h2>'].join(''),
		)
		expect(steamEmailTemplateName(raw)).toBe(
			'codefornewwebloginwithiplocwarning',
		)
		expect(parseSteamMail(raw)).toEqual({
			kind: 'login',
			template: 'codefornewwebloginwithiplocwarning',
			code: 'PQVVV',
		})
	})

	test('classifies authenticator setup even when the subject is not English', () => {
		const raw = [
			'From: Steam <noreply@steampowered.com>',
			'Subject: =?UTF-8?B?0JfQsNCvy9C+0YEg0L3QsCDQtNC+0LHQsNCy0LvQtdC90LjQtQ==?=',
			'Content-Type: text/html; charset=UTF-8',
			'Content-Transfer-Encoding: quoted-printable',
			'',
			'<html><body>',
			'<img src=3D"https://store.steampowered.com/email/AuthenticatorAdd" />',
			'<p>5K4Y5</p>',
			'</body></html>',
		].join('\r\n')
		expect(parseSteamMail(raw)).toEqual({
			kind: 'authenticator',
			template: 'AuthenticatorAdd',
			code: '5K4Y5',
		})
	})

	test('does not treat recovery or signup codes as Guard login', () => {
		expect(
			parseSteamMail(steamHtml('AccountRecoveryCode', '<p>PHNGT</p>')),
		).toEqual({
			kind: 'other',
			template: 'AccountRecoveryCode',
			code: null,
		})
		expect(
			parseSteamMail(
				steamHtml('AccountCreationEmailVerification', '<p>B5W3Q</p>'),
			),
		).toEqual({
			kind: 'other',
			template: 'AccountCreationEmailVerification',
			code: null,
		})
	})

	test('ignores new-device alerts that have no Guard code', () => {
		expect(parseSteamMail(steamHtml('NewDeviceAlert', '<p>hello</p>'))).toEqual(
			{
				kind: 'other',
				template: 'NewDeviceAlert',
				code: null,
			},
		)
	})

	test('falls back to HelpUnauthorizedLogin when the tracking pixel is missing', () => {
		const raw = [
			'<html><body>',
			'<a href="https://help.steampowered.com/ru/wizard/HelpUnauthorizedLogin?x=1">x</a>',
			'<p>8P3H2</p>',
			'</body></html>',
		].join('\n')
		expect(parseSteamMail(raw)).toEqual({
			kind: 'login',
			template: null,
			code: '8P3H2',
		})
	})
})
