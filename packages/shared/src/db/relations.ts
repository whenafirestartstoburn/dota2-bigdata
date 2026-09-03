import { defineRelations } from 'drizzle-orm'
import * as schema from './schema'

export const relations = defineRelations(schema, (r) => ({
	marketplace_orders: {
		steam_account: r.one.steam_accounts({
			from: r.marketplace_orders.steam_account_id,
			to: r.steam_accounts.id,
		}),
	},
	steam_accounts: {
		marketplace_orders: r.many.marketplace_orders(),
		match_replays: r.many.match_replays(),
		matches: r.many.matches(),
		proxy: r.one.proxies({
			from: r.steam_accounts.proxy_id,
			to: r.proxies.id,
			alias: 'steam_accounts_proxy_id_proxies_id',
		}),
		proxies: r.many.proxies({
			from: r.steam_accounts.id.through(r.steam_api_keys.account_id),
			to: r.proxies.id.through(r.steam_api_keys.proxy_id),
			alias: 'steam_accounts_id_proxies_id_via_steam_api_keys',
		}),
	},
	match_broadcasters: {
		match: r.one.matches({
			from: r.match_broadcasters.match_id,
			to: r.matches.match_id,
		}),
	},
	matches: {
		match_broadcasters: r.many.match_broadcasters(),
		match_coaches: r.many.match_coaches(),
		match_drafts: r.many.match_draft(),
		match_objectives: r.many.match_objectives(),
		match_player_ability_upgrades: r.many.match_player_ability_upgrades(),
		match_player_buffs: r.many.match_player_buffs(),
		match_player_damage_breakdowns: r.many.match_player_damage_breakdown(),
		match_player_units: r.many.match_player_units(),
		match_players: r.many.match_players(),
		match_replays: r.one.match_replays(),
		team_dire_team_id: r.one.teams({
			from: r.matches.dire_team_id,
			to: r.teams.team_id,
			alias: 'matches_dire_team_id_teams_team_id',
		}),
		steam_api_key: r.one.steam_api_keys({
			from: r.matches.last_api_key_id,
			to: r.steam_api_keys.id,
		}),
		proxy: r.one.proxies({
			from: r.matches.last_proxy_id,
			to: r.proxies.id,
		}),
		steam_account: r.one.steam_accounts({
			from: r.matches.last_steam_account_id,
			to: r.steam_accounts.id,
		}),
		league: r.one.leagues({
			from: r.matches.league_id,
			to: r.leagues.league_id,
		}),
		patchRelation: r.one.patches({
			from: r.matches.patch,
			to: r.patches.patch,
		}),
		team_radiant_team_id: r.one.teams({
			from: r.matches.radiant_team_id,
			to: r.teams.team_id,
			alias: 'matches_radiant_team_id_teams_team_id',
		}),
		series: r.one.series({
			from: r.matches.series_id,
			to: r.series.series_id,
		}),
	},
	match_coaches: {
		match: r.one.matches({
			from: r.match_coaches.match_id,
			to: r.matches.match_id,
		}),
	},
	match_draft: {
		match: r.one.matches({
			from: r.match_draft.match_id,
			to: r.matches.match_id,
		}),
	},
	match_objectives: {
		match: r.one.matches({
			from: r.match_objectives.match_id,
			to: r.matches.match_id,
		}),
	},
	match_player_ability_upgrades: {
		match: r.one.matches({
			from: r.match_player_ability_upgrades.match_id,
			to: r.matches.match_id,
		}),
	},
	match_player_buffs: {
		match: r.one.matches({
			from: r.match_player_buffs.match_id,
			to: r.matches.match_id,
		}),
	},
	match_player_damage_breakdown: {
		match: r.one.matches({
			from: r.match_player_damage_breakdown.match_id,
			to: r.matches.match_id,
		}),
	},
	match_player_units: {
		match: r.one.matches({
			from: r.match_player_units.match_id,
			to: r.matches.match_id,
		}),
	},
	match_players: {
		match: r.one.matches({
			from: r.match_players.match_id,
			to: r.matches.match_id,
		}),
	},
	match_replays: {
		match: r.one.matches({
			from: r.match_replays.match_id,
			to: r.matches.match_id,
		}),
		proxy: r.one.proxies({
			from: r.match_replays.proxy_id,
			to: r.proxies.id,
		}),
		steam_account: r.one.steam_accounts({
			from: r.match_replays.steam_account_id,
			to: r.steam_accounts.id,
		}),
	},
	proxies: {
		match_replays: r.many.match_replays(),
		matches: r.many.matches(),
		steam_accounts_proxy_id: r.many.steam_accounts({
			alias: 'steam_accounts_proxy_id_proxies_id',
		}),
		steam_accounts_via_steam_api_keys: r.many.steam_accounts({
			alias: 'steam_accounts_id_proxies_id_via_steam_api_keys',
		}),
	},
	teams: {
		matches_dire_team_id: r.many.matches({
			alias: 'matches_dire_team_id_teams_team_id',
		}),
		matches_radiant_team_id: r.many.matches({
			alias: 'matches_radiant_team_id_teams_team_id',
		}),
		players: r.many.players(),
		series_dire_team_id: r.many.series({
			alias: 'series_dire_team_id_teams_team_id',
		}),
		series_radiant_team_id: r.many.series({
			alias: 'series_radiant_team_id_teams_team_id',
		}),
	},
	steam_api_keys: {
		matches: r.many.matches(),
	},
	leagues: {
		matches: r.many.matches(),
		series: r.many.series(),
	},
	patches: {
		matches: r.many.matches(),
	},
	series: {
		matches: r.many.matches(),
		team_dire_team_id: r.one.teams({
			from: r.series.dire_team_id,
			to: r.teams.team_id,
			alias: 'series_dire_team_id_teams_team_id',
		}),
		league: r.one.leagues({
			from: r.series.league_id,
			to: r.leagues.league_id,
		}),
		team_radiant_team_id: r.one.teams({
			from: r.series.radiant_team_id,
			to: r.teams.team_id,
			alias: 'series_radiant_team_id_teams_team_id',
		}),
	},
	players: {
		team: r.one.teams({
			from: r.players.current_team_id,
			to: r.teams.team_id,
		}),
	},
}))
