# Dota2 - Модель данных

Источники: Steam Web API, Game Coordinator, replay (`.dem`).

Postgres — лиги, серии, матчи, игроки, драфт, итоги, live-тикер, коллектор. ClickHouse — события из replay.

У каждой таблицы Postgres есть `id`, `created_at`, `updated_at` (кроме `schema_migrations` и суточных партиций логов). Они ниже не повторяются. Партиции логов и таблицы `graphile_worker` не перечисляются.

`player_slot` (Postgres): 0–4 Radiant, 128–132 Dire. `slot` (ClickHouse): 0–9, −1 если неизвестен. Стыковка: для slot 0–4 `player_slot = slot`, для slot 5–9 `player_slot = slot + 123`.

# Postgres

## leagues

Таблица лиг.

- league_id — идентификатор лиги Valve
- name — название лиги
- tier — тир лиги Valve (1 amateur … 4 international)
- region — регион Valve
- total_prize_pool — призовой фонд
- start_timestamp — старт лиги, Unix-секунды
- end_timestamp — конец лиги, Unix-секунды
- most_recent_activity — последняя активность лиги, Unix-секунды
- valve_status — флаг публикации Valve (5 ≈ лига завершена)
- status — статус лиги
    - UPCOMING
    - LIVE
    - FINISHED
- fetched_at — время последнего GetLeagueInfoList
- last_match_seq_num — максимальный `match_seq_num` по лиге
- history_tail_match_id — курсор на более старые страницы GetMatchHistory
- history_exhausted — более старые страницы GetMatchHistory пустые
- history_checked_at — время последнего GetMatchHistory

## series

Таблица серий (Bo1 / Bo3 / Bo5). Если у Valve `series_id = 0`, идентификатор синтетический и не меняется при смене сторон.

- series_id — идентификатор серии Valve (или синтетический, если Valve отдал 0)
- league_id — лига
- radiant_team_id — команда Radiant в первой игре серии
- dire_team_id — команда Dire в первой игре серии
- series_type — формат серии
    - 0 — без серии
    - 1 — Bo3
    - 2 — Bo5
- radiant_wins — число побед Radiant в серии
- dire_wins — число побед Dire в серии
- first_match_id — первый матч серии
- started_at — старт первого матча
- ended_at — конец серии (когда сторона набрала 2 или 3 победы). Пусто, пока `series_type = 0`

## matches

Таблица матчей. Названия команд — снимок на момент игры.

- match_id — идентификатор матча Valve
- league_id — лига
- series_id — серия
- series_type — формат серии на этом матче
- radiant_series_wins — победы Radiant в серии на момент матча
- dire_series_wins — победы Dire в серии на момент матча
- league_node_id — узел сетки
- match_seq_num — порядковый номер матча Valve
- start_time — старт матча, Unix-секунды
- duration — длительность игры, секунды
- pre_game_duration — длительность прегейма, секунды
- lobby_type — тип лобби Valve (справочник `lobby_types`)
- game_mode — режим Valve (справочник `game_modes`)
- engine — идентификатор движка Source
- radiant_win — победа Radiant
- radiant_score — киллы Radiant
- dire_score — киллы Dire
- tower_status_radiant — битовая маска башен Radiant
- tower_status_dire — битовая маска башен Dire
- barracks_status_radiant — битовая маска бараков Radiant
- barracks_status_dire — битовая маска бараков Dire
- first_blood_time — время первой крови, секунды игровых часов
- lobby_id — идентификатор лобби Steam
- server_steam_id — Steam id игрового сервера
- match_flags — флаги матча Valve
- match_outcome — исход матча Valve (`EMatchOutcome`)
- game_balance — баланс игры
- radiant_team_id — команда Radiant
- dire_team_id — команда Dire
- radiant_team_name — название Radiant на момент игры
- dire_team_name — название Dire на момент игры
- radiant_team_tag — тег Radiant
- dire_team_tag — тег Dire
- radiant_team_logo — логотип Radiant
- dire_team_logo — логотип Dire
- radiant_team_logo_url — URL логотипа Radiant
- dire_team_logo_url — URL логотипа Dire
- radiant_team_complete — флаг полного состава Radiant
- dire_team_complete — флаг полного состава Dire
- radiant_captain — Steam32 капитана Radiant
- dire_captain — Steam32 капитана Dire
- radiant_guild_id — гильдия Radiant
- dire_guild_id — гильдия Dire
- tournament_id — турнир
- tournament_round — раунд турнира
- league_series_id — серия внутри лиги
- league_game_id — игра внутри лиги
- game_number — номер карты в серии
- stage_name — название стадии
- league_tier — тир лиги на листинге
- human_players — число живых игроков
- cluster — кластер CDN replay
- replay_salt — salt replay
- patch — патч (по `start_time` и справочнику `patches`)
- stream_delay_s — задержка трансляции, секунды
- finished_at — время окончания матча
- status — статус пайплайна
    - discovered
    - live
    - awaiting_history
    - awaiting_details
    - details_ready
    - awaiting_replay
    - replay_stored
    - parsed
    - replay_unavailable
    - failed
    - not_started
- source — как матч попал в коллектор
    - live
    - historical
- ingest_sources — источники, из которых матч видели (`GetLiveLeagueGames`, `GetTopLiveGame`, `GetMatchHistory`, `GetMatchHistoryBySequenceNum`)
- live_seen_at — последнее появление в live-ленте
- live_disappeared_at — когда матч пропал из live-ленты
- live_disappeared_count — сколько раз пропадал из live-ленты
- live_league_missed_polls — текущая серия промахов GetLiveLeagueGames
- top_live_missed_polls — текущая серия промахов GetTopLiveGame
- live_duration_max — максимальные игровые часы, пока матч был live (0 если горн не прозвучал)
- history_poll_fast_count — быстрые опросы GetMatchHistory после конца live
- history_poll_slow_count — медленные опросы GetMatchHistory
- history_last_polled_at — последний опрос history-waiter
- history_next_poll_at — следующий опрос history-waiter
- seq_fetched_at — когда записан GetMatchHistoryBySequenceNum
- details_fetched_at — когда записан `CMsgDOTAMatch` из Game Coordinator
- attempts — число ретраев seq-details
- next_attempt_at — следующий ретрай seq-details
- last_realtime_at — последний успешный GetRealtimeStats
- replay_available_at — когда replay можно качать
- last_error — текст последней ошибки инжеста
- last_error_kind — класс ошибки
    - network
    - rate_limit
    - auth
    - not_ready
    - unavailable
    - history_timeout
    - not_started
    - other
- last_error_at — когда записан `last_error`

## match_players

Таблица игроков матча. Одна строка на `(match_id, player_slot)`. Слоты 0–4 Radiant, 128–132 Dire.

- match_id — матч
- account_id — Steam32 аккаунт
- player_slot — слот Valve (0–4 Radiant, 128–132 Dire)
- hero_id — выбранный герой (0 до пика)
- player_name — ник на момент игры
- pro_name — про-ник
- real_name — реальное имя
- team_number — номер команды Valve
- team_slot — слот внутри команды
- side — сторона (Radiant / Dire)
- hero_variant — вариант героя
- selected_facet — аспект (справочник `hero_facets.facet_id`)
- kills — убийства
- deaths — смерти
- assists — ассисты
- last_hits — добивания
- denies — денаи
- net_worth — итоговый нетфорс
- gold — непотраченное золото
- gold_spent — потраченное золото
- gold_per_min — золото в минуту
- xp_per_min — опыт в минуту
- level — уровень героя
- claimed_farm_gold — заявленный фарм
- support_gold — саппорт-золото
- claimed_denies — заявленные денаи
- claimed_misses — заявленные промахи
- misses — промахи
- bounty_runes — подобранные bounty-руны
- outposts_captured — захваченные аутпосты
- seconds_dead — секунд в смерти
- gold_lost_to_death — золото, потерянное от смертей
- hero_damage — урон по героям
- tower_damage — урон по башням
- hero_healing — лечение героев
- scaled_hero_damage — масштабированный урон по героям
- scaled_tower_damage — масштабированный урон по башням
- scaled_hero_healing — масштабированное лечение
- scaled_kills — масштабированные убийства
- scaled_deaths — масштабированные смерти
- scaled_assists — масштабированные ассисты
- item_0 — слот инвентаря 0
- item_1 — слот инвентаря 1
- item_2 — слот инвентаря 2
- item_3 — слот инвентаря 3
- item_4 — слот инвентаря 4
- item_5 — слот инвентаря 5
- item_6 — дополнительный слот 6
- item_7 — дополнительный слот 7
- item_8 — дополнительный слот 8
- item_9 — дополнительный слот 9
- item_10 — дополнительный слот 10
- item_10_lvl — уровень `item_10`
- item_neutral — нейтральный предмет
- item_neutral2 — второй нейтральный предмет / enhancement
- backpack_0 — рюкзак 0
- backpack_1 — рюкзак 1
- backpack_2 — рюкзак 2
- aghanims_scepter — Aghanim’s Scepter
- aghanims_shard — Aghanim’s Shard
- moonshard — Moon Shard
- ability_upgrades — список id способностей
- leaver_status — статус ливера Valve
- party_id — пати
- hero_pick_order — порядок пика
- hero_was_randomed — герой взят рандомом
- lane_selection_flags — предпочтение линии на драфте
- support_ability_value — значение саппорт-способности
- disable_duration — длительность контроля
- lane — линия
- lane_role — роль на линии
- is_roaming — роум
- stuns — секунд стана
- teamfight_participation — участие в тимфайтах
- towers_killed — убитые башни
- roshans_killed — убитые Рошаны
- observers_placed — поставленные observer-варды
- sentries_placed — поставленные sentry-варды
- camps_stacked — стакнутые лагеря
- creeps_stacked — стакнутые крипы
- rune_pickups — подобранные руны
- firstblood_claimed — первая кровь

0 у героя, предмета или аккаунта — пустое значение. Valve −1 (пустой слот предмета) хранится как 0.

## match_player_buffs

Таблица постоянных баффов игрока (Aghs, Moonshard и т.п.). Одна строка на `(match_id, player_slot, buff_id)`.

- match_id — матч
- player_slot — слот игрока
- buff_id — бафф (справочник `permanent_buffs`)
- stacks — число стаков
- grant_time — время получения, игровые часы

## match_player_ability_upgrades

Таблица прокачки способностей. Одна строка на `(match_id, player_slot, seq)`.

- match_id — матч
- player_slot — слот игрока
- seq — порядковый номер прокачки
- ability_id — способность
- time — игровое время прокачки
- level — уровень способности после прокачки

## match_player_damage_breakdown

Таблица разбивки урона. Одна строка на `(match_id, player_slot, direction, damage_type)`.

- match_id — матч
- player_slot — слот игрока
- direction — направление
    - received — полученный урон
    - dealt — нанесённый урон
- damage_type — тип урона Valve
- pre_reduction — урон до редукции
- post_reduction — урон после редукции

## match_player_units

Таблица дополнительных юнитов (Spirit Bear и т.п.). Одна строка на `(match_id, player_slot, unit_name)`.

- match_id — матч
- player_slot — слот игрока
- unit_name — имя юнита
- item_0 — слот инвентаря 0
- item_1 — слот инвентаря 1
- item_2 — слот инвентаря 2
- item_3 — слот инвентаря 3
- item_4 — слот инвентаря 4
- item_5 — слот инвентаря 5

## match_coaches

Таблица тренеров лобби. Одна строка на `(match_id, account_id)`.

- match_id — матч
- account_id — Steam32 тренера
- coach_name — имя тренера
- coach_rating — рейтинг тренера
- coach_team — сторона
- coach_party_id — пати тренера
- is_private_coach — приватный тренер

## match_broadcasters

Таблица каналов трансляции. Одна строка на `(match_id, seq)`.

- match_id — матч
- seq — порядковый номер канала
- country_code — страна трансляции
- description — описание канала
- language_code — язык трансляции
- account_id — аккаунт кастера
- name — имя кастера

## match_draft

Таблица драфта. Одна строка на `(match_id, ord)`.

- match_id — матч
- ord — порядковый номер действия
- is_pick — пик (`false` = бан)
- hero_id — герой (0 до выбора)
- team — сторона
    - 0 — Radiant
    - 1 — Dire
- player_slot — слот игрока (0–4 / 128–132)
- clock — секунды драфта

## match_objectives

Таблица ключевых событий матча (первая кровь, башни, Рошан, аегис и т.п.).

- match_id — матч
- seq — порядковый номер события в матче
- time — игровое время, секунды
- kind — тип события
    - first_blood — первая кровь
    - tower — башня
    - barracks — бараки
    - roshan — Рошан
    - aegis — Аегис взят
    - aegis_stolen — Аегис украден
    - aegis_denied — Аегис заденайен
    - buyback — байбек
    - glyph — глиф
    - scan — скан
    - pause — пауза
    - reconnect — переподключение
    - disconnect — дисконнект
    - win — победа
    - courier — курьер
    - shrine — шрайн
    - ward — вард
    - tormentor — торментор
    - smoke — смок
    - banner — баннер
    - outpost — аутпост
- team — сторона (0 / 1 / пусто)
- slot — слот игрока, если применимо
- key — дополнительный ключ (npc башни, линия и т.п.)
- value — дополнительное число

## match_replays

Статус скачивания и парсинга replay. Одна строка на матч.

- match_id — матч
- priority — приоритет
    - live
    - historical
- status — статус
    - pending
    - downloading
    - stored
    - parsing
    - parsed
    - unavailable
    - failed
- cluster — кластер CDN replay
- replay_salt — salt replay
- replay_state — флаг Valve (записан / истёк)
- source_url — URL, с которого качали
- s3_bucket — бакет объекта (hot, затем cold)
- s3_key — ключ объекта
- bytes — размер объекта
- stored_at — когда `.dem.bz2` попал в hot
- parser_version — версия схемы ClickHouse у строк
- parsed_at — когда парсер опубликовал строки
- archived_at — когда объект скопирован в cold и hot удалён
- attempts — попытки скачивания / парсинга
- last_error — последняя ошибка пайплайна
- last_error_at — когда записан `last_error`
- next_attempt_at — следующий ретрай
- steam_account_id — Steam-аккаунт GC-сессии, которой взяли salt
- proxy_id — прокси той GC-сессии

## players

Таблица игроков, встреченных в лиговых матчах.

- account_id — Steam32
- steam_id — Steam64 (`76561197960265728 + account_id`)
- persona_name — последний ник
- is_pro — игрок встречался в лиговом матче
- current_team_id — последняя команда
- last_match_id — последний матч
- last_match_at — старт последнего матча

## teams

Таблица команд. Актуальные имя / тег / логотип. Имена на момент игры лежат в `matches`.

- team_id — идентификатор команды Valve
- name — текущее название
- tag — текущий тег
- logo_url — текущий логотип

## heroes

Справочник героев Valve.

- hero_id — идентификатор героя Valve
- name — внутреннее имя (`npc_dota_hero_*`)
- localized_name — отображаемое имя
- primary_attr — основной атрибут
- attack_type — тип атаки (melee / ranged)
- roles — роли

## items

Справочник предметов Valve.

- item_id — идентификатор предмета Valve
- name — внутреннее имя
- localized_name — отображаемое имя
- cost — стоимость в золоте

## patches

Справочник патчей. По `start_time` матча выставляется `matches.patch`.

- patch — номер патча
- released_at — дата релиза

## abilities

Справочник способностей Valve. Способности и таланты в одном пространстве id. Таланты: `kind = talent` (`special_bonus_*`).

- ability_id — идентификатор способности Valve
- name — внутреннее имя
- localized_name — отображаемое имя
- kind — тип
    - spell
    - talent
    - innate
    - item
    - other

## hero_abilities

Скиллбилд и дерево талантов героя. Одна строка на `(hero_id, slot, is_talent)`.

- hero_id — герой
- ability_id — способность на слоте
- slot — слот скилла / таланта
- is_talent — строка дерева талантов
- talent_level — уровень таланта (если `is_talent`)

## hero_facets

Справочник аспектов героя. Одна строка на `(hero_id, facet_id)`. Стыковка: `match_players.selected_facet` = `facet_id`.

- hero_id — герой
- facet_id — аспект
- name — внутреннее имя
- localized_name — отображаемое имя
- icon — иконка
- color — цвет
- deprecated — аспект больше не предлагается

## permanent_buffs

Справочник постоянных баффов для `match_player_buffs.buff_id`.

- buff_id — идентификатор баффа Valve
- name — название

## game_modes

Справочник режимов для `matches.game_mode`.

- game_mode — идентификатор режима Valve
- name — название режима
- balanced — сбалансированный режим

## lobby_types

Справочник типов лобби для `matches.lobby_type`.

- lobby_type — идентификатор лобби Valve
- name — название
- balanced — сбалансированное лобби

## regions

Справочник регионов Valve.

- region — идентификатор региона Valve
- name — название региона

## clusters

Справочник кластеров. Связка `matches.cluster` → `regions.region`.

- cluster — идентификатор кластера Valve
- region — регион

## xp_levels

Накопленный опыт до уровня героя.

- level — уровень героя
- xp — накопленный XP

## live_match_ticks

Таблица live-снимков матча (ClickHouse MergeTree). Одна строка на опрос. Источники: Steam Web API `GetLiveLeagueGames` и `GetRealtimeStats`.

- match_id — матч
- captured_at — время опроса
- source — источник
    - GetLiveLeagueGames
    - GetRealtimeStats
- league_id — лига
- duration — игровые часы, секунды
- radiant_score — киллы Radiant на момент опроса
- dire_score — киллы Dire на момент опроса
- spectators — число зрителей
- tower_state_radiant — битовая маска башен Radiant
- tower_state_dire — битовая маска башен Dire
- barracks_state_radiant — битовая маска бараков Radiant
- barracks_state_dire — битовая маска бараков Dire
- roshan_respawn_timer — таймер респауна Рошана, секунды
- series_type — формат серии
- radiant_series_wins — победы Radiant в серии
- dire_series_wins — победы Dire в серии
- stream_delay_s — задержка трансляции, секунды
- lobby_id — лобби Steam
- game_number — номер карты в серии
- league_series_id — серия внутри лиги
- league_game_id — игра внутри лиги
- league_tier — тир лиги
- game_state — состояние игры (`GetRealtimeStats`)
- server_steam_id — Steam id сервера (`GetRealtimeStats`)

`GetLiveLeagueGames` заполняет зрителей, башни/бараки, Рошана, серию, задержку, лобби. `GetRealtimeStats` заполняет `duration`, счёт, `game_state`, `server_steam_id`;

## live_player_ticks

Таблица live-снимков игрока (ClickHouse MergeTree). Одна строка на опрос на игрока.

- match_id — матч
- captured_at — время опроса
- source — источник
    - GetLiveLeagueGames
    - GetRealtimeStats
- player_slot — слот игрока
- account_id — Steam32
- hero_id — герой
- kills — убийства на момент опроса
- deaths — смерти
- assists — ассисты
- last_hits — добивания
- denies — денаи
- gold — непотраченное золото
- net_worth — нетфорс
- level — уровень
- gold_per_min — GPM (`GetLiveLeagueGames`)
- xp_per_min — XPM (`GetLiveLeagueGames`)
- x — координата X на карте
- y — координата Y на карте
- item0 — слот инвентаря 0
- item1 — слот инвентаря 1
- item2 — слот инвентаря 2
- item3 — слот инвентаря 3
- item4 — слот инвентаря 4
- item5 — слот инвентаря 5
- item6 — рюкзак 0 (`GetRealtimeStats`)
- item7 — рюкзак 1 (`GetRealtimeStats`)
- item8 — рюкзак 2 (`GetRealtimeStats`)
- ultimate_state — состояние ульты (`GetLiveLeagueGames`)
- ultimate_cooldown — кулдаун ульты, секунды (`GetLiveLeagueGames`)
- respawn_timer — таймер респауна, секунды (`GetLiveLeagueGames`)

## ingest_cursors

Курсоры инжеста. По одной строке на ключ. Курсоры листинга по лигам лежат в `leagues`.

- key — имя курсора (`global_max_match_seq_num` — максимум сохранённых details)
- value — значение курсора

## league_ingest_runs

Лог прогонов инжеста лиги (API).

- run_id — uuid прогона
- league_id — лига
- matches_limit — необязательный лимит матчей
- status — статус
    - queued
    - running
    - succeeded
    - failed
- matches_listed — сколько матчей уже в списке
- matches_detailed — сколько матчей уже с details
- replays_enqueued — сколько replay поставлено в очередь
- error — ошибка прогона
- started_at — старт прогона
- finished_at — конец прогона

## settings

Настройки коллектора. Воркер читает на каждом тике. Секреты и URL подключений — в `.env`.

- key — ключ
    - desired_api_keys
    - desired_gc_accounts
    - proxy_error_threshold
    - proxy_error_window
    - proxy_retest_max
    - gc_account_error_threshold
    - gc_account_error_window
    - gc_account_retest_max
    - api_key_error_threshold
    - api_key_error_window
    - api_key_retest_max
    - live_poll_interval_ms
    - live_max_concurrent
    - live_missing_threshold
    - replay_live_delay_ms
    - history_page_size
    - history_details_enqueue_limit
    - history_replay_enqueue_limit
    - seq_batch_size
    - seq_walk_cursor
    - seq_walk_parallelism
    - seq_walk_interval_ms
    - seq_walk_latest_start_time
    - seq_walk_cooldown_until
    - steam_api_min_interval_ms
    - history_newest_refresh_ms
    - history_exhausted_refresh_ms
    - history_fast_poll_ms
    - history_fast_poll_limit
    - history_slow_poll_ms
    - history_slow_poll_limit
    - replenish_interval_ms
    - retest_interval_ms
    - marketplace_buy_max
    - marketplace_wait_ms
    - marketplace_settle_interval_ms
    - marketplace_pending_ttl_ms
    - marketplace_min_interval_ms
    - gc_logon_attempts
    - api_key_rate_limit_ms
    - gc_account_rate_limit_ms
    - parser_parallelism
    - replay_archive_interval_ms
    - replay_archive_batch_size
    - log_valve_requests
- value — значение
- description — описание для админки

## steam_accounts

Steam-аккаунты для Game Coordinator (и владельцы Web API ключей).

- login — логин Steam
- password — пароль
- shared_secret — shared secret Guard
- identity_secret — identity secret Guard
- steam_id — Steam64
- proxy_id — назначенный прокси
- status — статус ресурса
    - ready
    - active
    - rate_limited
    - disabled
- rate_limited_until — до какого момента rate limit
- last_login_at — последний логин
- last_error — последняя ошибка
- shared_secret_broken — shared secret невалиден
- email — почта аккаунта
- email_password — пароль почты
- email_imap_host — IMAP-хост
- refresh_token — refresh token steam-user
- refresh_token_expires_at — срок refresh token
- machine_auth_token — machine auth token
- retest_count — число проб после disabled

## steam_api_keys

Ключи Steam Web API. Лимит 1 запрос/сек на ключ.

- account_id — владелец (`steam_accounts.id`)
- api_key — ключ
- proxy_id — назначенный прокси
- status — статус ресурса
    - ready
    - active
    - rate_limited
    - disabled
- rate_limited_until — до какого момента rate limit
- last_used_at — последнее использование
- last_called_at — последний вызов
- last_error — последняя ошибка
- retest_count — число проб после disabled

## proxies

Прокси для Web API и Game Coordinator.

- name — имя
- url — URL прокси
- kind — тип
    - http
    - socks5
- purpose — назначение
    - api
    - gc
    - both
- region — регион
- supports_udp — UDP
- status — статус ресурса
    - ready
    - active
    - rate_limited
    - disabled
- rate_limited_until — до какого момента rate limit
- last_error — последняя ошибка
- retest_count — число проб после disabled

## marketplace_products

Whitelist товаров для покупки аккаунтов.

- store — магазин
    - dark_shopping
- kind — тип покупки
    - api_key
    - gc
- product_id — id товара в магазине

## marketplace_orders

Заказы покупки Steam-аккаунтов.

- order_id — uuid заказа
- store — магазин
    - dark_shopping
- kind — тип покупки
    - api_key
    - gc
- product_id — id товара
- status — статус
    - pending
    - success
    - failed
- idempotence_id — ключ идемпотентности
- external_order_id — id заказа в магазине
- steam_account_id — созданный `steam_accounts.id`
- test_on_match_id — матч для проверки после покупки
- error_message — ошибка
- test_result — результат проверки (json)
- completed_at — время завершения

## resource_attempts

Окно последних попыток прокси / GC-аккаунта / API-ключа (для порога ошибок).

- kind — тип ресурса
    - proxy
    - gc_account
    - api_key
- resource_id — id ресурса
- ok — успех
- error — текст ошибки

## steam_api_requests

Лог попыток Steam Web API (`api.steampowered.com` и GetLeagueInfoList). Партиции по суткам UTC, хранение 4 дня. Одна строка на попытку.

- match_id — матч (пусто на листингах лиг / live / history)
- method_name — метод (`GetLiveLeagueGames`, `GetTopLiveGame`, `GetRealtimeStats`, `GetMatchHistory`, `GetMatchHistoryBySequenceNum`, `GetLeagueInfoList`)
- response_time — длительность попытки, мс
- response_status — HTTP-статус или `timeout` / `error`
- response_size_kb — размер ответа, КБ
- error_response — текст ошибки (до 1000 символов, только неуспех)
- steam_api_key_id — ключ, которым звали
- steam_account_id — аккаунт-владелец ключа

## steam_gc_requests

Лог попыток Game Coordinator. Партиции по суткам UTC, хранение 4 дня. Одна строка на попытку.

- match_id — матч
- method_name — сообщение GC (`CMsgGCMatchDetailsRequest`)
- response_time — длительность попытки, мс
- response_status — `EResult` GC или `timeout` / `error`
- response_size_kb — размер ответа, КБ
- error_response — текст ошибки (до 1000 символов, только неуспех)
- steam_api_key_id — не заполняется (у GC нет ключа)
- steam_account_id — аккаунт GC-сессии

## replay_requests

Лог скачиваний replay с CDN Valve. Партиции по суткам UTC, хранение 4 дня. Одна строка на попытку.

- match_id — матч
- method_name — `GetReplay`
- response_time — длительность попытки, мс
- response_status — HTTP-статус или `timeout` / `error`
- response_size_kb — размер ответа, КБ (успех — размер объекта)
- error_response — текст ошибки (до 1000 символов, только неуспех)

## schema_migrations

Версии применённых миграций dbmate (Postgres).

- version — timestamp миграции

# ClickHouse

## replay_ability_levels

Таблица прокачки способностей из replay. Строка пишется, когда уровень слота способности героя вырос.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот 0–9
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- ability_id — способность
- ability_level — новый уровень способности
- target — npc-имя героя

## replay_actions

Таблица приказов юнитам (`CDOTAUserMsg_SpectatorPlayerUnitOrders`).

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот игрока, отдавшего приказ
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- order_type — тип приказа Valve (`dotaunitorder_t`)
- unit_index — первый юнит в списке (−1 если нет)
- target_index — целевая сущность (−1 если нет)
- ability_id — способность (−1 если нет)
- pos_x — координата X приказа
- pos_y — координата Y приказа
- pos_z — координата Z приказа
- queued — приказ в очереди

## replay_alerts

Таблица зрительских/пользовательских сообщений, которые не попали в combat log, чат или приказы.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот игрока
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- kind — тип алерта
    - item_alert — алерт предмета
    - enemy_item_alert — алерт вражеского предмета
    - will_purchase — намерение купить
    - item_sold — предмет продан
    - item_purchased — предмет куплен
    - ability_ping — пинг способности
    - facet_ping — пинг аспекта
    - innate_ping — пинг врождённой способности
    - ability_steal — украденная способность
    - shared_cooldown — общий кулдаун
    - courier_killed — курьер убит
    - courier_left_fountain — курьер ушёл с фонтана
    - outpost_captured — аутпост захвачен
    - outpost_xp — XP с аутпоста
    - glyph_alert — глиф
    - radar_alert — радар
    - buyback_alert — байбек
    - aghs_status — статус Aghs
    - neutral_camp — нейтральный лагерь
    - roshan_timer — таймер Рошана
    - tormentor_timer — таймер торментора
    - roshan_phase — фаза Рошана
    - map_line — линия на карте
    - ping_confirm — подтверждение пинга
    - give_item — передача предмета
    - madstone — madstone
    - timer_alert — таймер
    - found_neutral — найден нейтральный предмет
- player2 — второй игрок (−1 если нет)
- value — предмет / способность / золото / команда / тип
- value2 — доп. число (тир, XP, флаги)
- x — координата X
- y — координата Y
- key — строка, если сообщение её несёт (`shared_cooldown`)

## replay_announcements

Таблица объявлений (`DOTA_UM_ChatEvent`): башни, Рошан, аегис, глиф, пауза и т.п. Те же события частично дублируются в `match_objectives`.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — связанный слот (−1 если не используется)
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- kind — тип сообщения (`CHAT_MESSAGE_TOWER_KILL` и т.п.)
- player1 — `playerid_1` (−1 если не используется)
- player2 — `playerid_2` (−1 если не используется)
- player3 — `playerid_3` (−1 если не используется)
- value — значение события
- value2 — доп. число
- value3 — доп. число

## replay_chat

Таблица чата: общий, командный, chat wheel.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот говорящего (−1 если неизвестен)
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- kind — тип
    - chat — текст
    - chatwheel — колесо фраз
- key — текст, id фразы или `SayText2.messagename`
- unit — префикс говорящего (`SayText2.param1`), если есть
- channel — канал (`CDOTAUserMsg_ChatMessage.channel_type`)

## replay_combat_log

Таблица combat log (`CMsgDOTACombatLogEntry`). ~50–200 тыс. строк на матч. Имена юнитов из string table `CombatLogNames`.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек (из timestamp; если штамп абсолютный больше 1000, вычитается старт игры)
- tick — тик replay
- slot — слот основного актора (−1 если неизвестен)
- account_id — Steam32 основного актора (атакующий, иначе цель; 0 если не герой)
- parser_version — версия парсера
- type — тип события (префикс `DOTA_COMBATLOG_` снят)
    - DAMAGE — урон
    - HEAL — лечение
    - MODIFIER_ADD — наложен модификатор
    - MODIFIER_REMOVE — снят модификатор
    - DEATH — смерть
    - ABILITY — способность
    - ABILITY_TRIGGER — срабатывание способности
    - ITEM — предмет
    - LOCATION — координаты
    - GOLD — золото
    - ALLIED_GOLD — союзное золото
    - XP — опыт
    - PURCHASE — покупка
    - BUYBACK — байбек
    - GAME_STATE — состояние игры
    - PLAYERSTATS — статистика игрока
    - MULTIKILL — мультикилл
    - KILLSTREAK — серия убийств
    - END_KILLSTREAK — конец серии
    - TEAM_BUILDING_KILL — убито здание
    - FIRST_BLOOD — первая кровь
    - MODIFIER_STACK_EVENT — изменение стаков модификатора
    - NEUTRAL_CAMP_STACK — стак нейтрального лагеря
    - PICKUP_RUNE — руна подобрана
    - REVEALED_INVISIBLE — раскрыта невидимость
    - HERO_SAVED — герой спасён
    - MANA_RESTORED — восстановлена мана
    - MANA_DAMAGE — урон по мане
    - HERO_LEVELUP — уровень героя
    - BOTTLE_HEAL_ALLY — лечение из бутылки
    - ENDGAME_STATS — итоговая статистика
    - INTERRUPT_CHANNEL — прерван каст
    - AEGIS_TAKEN — Аегис взят
    - PHYSICAL_DAMAGE_PREVENTED — физический урон предотвращён
    - UNIT_SUMMONED — призван юнит
    - ATTACK_EVADE — атака уклонена
    - TREE_CUT — дерево срублено
    - SUCCESSFUL_SCAN — успешный скан
    - BLOODSTONE_CHARGE — заряд Bloodstone
    - CRITICAL_DAMAGE — крит
    - SPELL_ABSORB — заклинание поглощено
    - UNIT_TELEPORTED — юнит телепортирован
    - KILL_EATER_EVENT — kill eater
    - NEUTRAL_ITEM_EARNED — получен нейтральный предмет
    - STAT_TRACKER_PLAYER — трекер статистики
- attacker — имя атакующего
- target — имя цели
- inflictor — источник (способность / предмет / модификатор)
- sourcename — источник урона
- targetsourcename — источник цели
- attacker_slot — слот атакующего (−1 если неизвестен)
- target_slot — слот цели (−1 если неизвестен)
- attacker_account_id — Steam32 атакующего (0 если не герой игрока)
- target_account_id — Steam32 цели (0 если не герой игрока)
- value — величина: урон / золото / XP / id предмета / id состояния игры
- value_name — имя на `PURCHASE` / `ITEM` / `BUYBACK` / `MODIFIER_*`
- gold_reason — причина золота
- xp_reason — причина опыта
- attacker_hero — атакующий — герой
- target_hero — цель — герой
- attacker_illusion — атакующий — иллюзия
- target_illusion — цель — иллюзия
- last_hits — добивания на событии
- stun_duration — длительность стана, сек
- slow_duration — длительность слоу, сек
- health — HP цели после события
- ability_level — уровень способности
- location_x — координата X (`LOCATION`)
- location_y — координата Y (`LOCATION`)
- modifier_duration — длительность модификатора при наложении
- timestamp_raw — исходный timestamp, сек (без сдвига)
- attacker_team — команда атакующего (`DOTA_GC_TEAM`)
- target_team — команда цели
- stack_count — стаки (`MODIFIER_STACK_EVENT`)
- is_target_building — цель — здание
- rune_type — тип руны (`PICKUP_RUNE`)
- networth — нетфорс на событии
- visible_radiant — видно Radiant
- visible_dire — видно Dire
- is_ability_toggle_on — способность включена
- is_ability_toggle_off — способность выключена
- obs_wards_placed — поставленные observer-варды
- assist_player0 — первый ассист (0 если нет)
- assist_player1 — второй ассист
- assist_player2 — третий ассист
- assist_player3 — четвёртый ассист
- assist_players — полный список ассистов
- hidden_modifier — скрытый модификатор
- neutral_camp_type — тип лагеря (`NEUTRAL_CAMP_STACK`)
- is_heal_save — лечение спасло цель
- is_ultimate_ability — ульта
- attacker_hero_level — уровень атакующего
- target_hero_level — уровень цели
- xpm — XPM на событии
- gpm — GPM на событии
- event_location — id локации события
- target_is_self — цель — сам себя
- damage_type — тип урона
- invisibility_modifier — модификатор невидимости
- damage_category — категория урона
- building_type — тип здания
- modifier_elapsed_duration — прошедшая длительность модификатора
- silence_modifier — сайленс
- heal_from_lifesteal — лечение от вампиризма
- modifier_purged — модификатор снят перджем
- spell_evaded — заклинание уклонено
- motion_controller_modifier — motion-controller
- long_range_kill — килл с большой дистанции
- modifier_purge_ability — способность, которой перджнули
- modifier_purge_npc — npc, которым перджнули
- root_modifier — рут
- total_unit_death_count — число смертей юнита
- aura_modifier — аура
- armor_debuff_modifier — дебафф брони
- no_physical_damage_modifier — иммунитет к физическому урону
- modifier_ability — способность модификатора
- modifier_hidden — скрытый модификатор
- inflictor_is_stolen_ability — источник — украденная способность
- kill_eater_event — kill eater
- unit_status_label — статус юнита
- spell_generated_attack — атака от заклинания
- at_night_time — ночь
- attacker_has_scepter — у атакующего Aghs
- neutral_camp_team — команда нейтрального лагеря
- regenerated_health — восстановленное HP
- will_reincarnate — реинкарнация
- uses_charges — использует заряды
- tracked_stat_id — id трекера (`STAT_TRACKER_PLAYER`)
- modifier_purged_duration — длительность перджа
- heal_from_regen — лечение от регена

Крипы, здания и глобальный чат: `account_id = 0`, `slot = -1`.

## replay_cosmetics

Таблица косметики (`CDOTAWearableItem`). Одна запись на `(аккаунт, предмет)` в матче.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот игрока
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- item_id — definition index предмета

## replay_draft

Таблица таймлайна драфта из replay (пока `m_nGameState == 2`).

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот пикающего (−1 если неизвестен)
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- is_pick — пик
    - 0 — бан
    - 1 — пик
- hero_id — герой
- team — сторона
    - 0 — Radiant
    - 1 — Dire
- ord — порядковый номер в этом парсе
- clock — секунды драфта
- extra_time_radiant — запас времени Radiant
- extra_time_dire — запас времени Dire

## replay_intervals

Таблица снимков игрока ~1 раз в секунду. ~20 тыс. строк на матч.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот 0–9
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- hero_id — герой
- variant — вариант / младшие 8 бит ключа аспекта
- facet_hero_id — старшая часть ключа аспекта
- unit — класс героя
- x — координата X героя
- y — координата Y героя
- gold — заработанное золото
- lh — добивания
- xp — опыт
- networth — нетфорс
- denies — денаи
- level — уровень
- kills — убийства
- deaths — смерти
- assists — ассисты
- life_state — состояние жизни героя
- stuns — накопленные секунды стана
- obs_placed — observer-варды
- sen_placed — sentry-варды
- creeps_stacked — стакнутые крипы
- camps_stacked — стакнутые лагеря
- rune_pickups — руны
- towers_killed — башни
- roshans_killed — Рошаны
- teamfight_participation — участие в тимфайтах
- firstblood_claimed — первая кровь
- draft_stage — состояние игры (`m_nGameState`)
- repicked — репик
- randomed — рандом
- pred_vict — предсказанная победа
- hp — текущее HP
- max_hp — максимальное HP
- mana — текущая мана
- max_mana — максимальная мана
- respawn — секунд до респауна

## replay_inventory

Таблица изменений инвентаря. Покупки до 90-й секунды (`item_slot = -1`) и последующие смены слотов 0–20 (инвентарь, рюкзак, стан). Пустой `item_id` на поздней строке — слот очищен.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот игрока
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- item_id — предмет
- item_slot — слот (−1 стартовая покупка; 0–20 инвентарь)
- charges — заряды
- secondary_charges — вторичные заряды

## replay_meta

Таблица метаданных матча из `CDemoFileInfo` + `CDOTAMatchMetadata`. Одна строка на матч. `slot = -1`, `account_id = 0`. Победитель и id команд также есть в `matches`.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — −1 (строка матча)
- account_id — 0 (строка матча)
- parser_version — версия парсера
- playback_time — длительность replay
- playback_ticks — число тиков replay
- playback_frames — число кадров replay
- game_winner — победившая сторона
- radiant_team_id — команда Radiant
- dire_team_id — команда Dire
- metadata_version — версия метаданных
- lobby_id — лобби

## replay_meta_inventory

Таблица снимков инвентаря ~каждые 30 сек из метаданных матча.

- match_id — матч
- start_time — старт матча (UTC)
- time — время снимка, сек
- tick — тик replay
- slot — слот игрока
- account_id — Steam32
- parser_version — версия парсера
- item_ids — предметы инвентаря
- backpack_item_ids — предметы рюкзака
- neutral_item_id — нейтральный предмет
- neutral_enhancement_id — нейтральный enhancement
- kills — убийства на снимке
- deaths — смерти на снимке
- assists — ассисты на снимке
- level — уровень на снимке
- last_hits — добивания на снимке
- denies — денаи на снимке
- flags — флаги снимка

## replay_meta_kills

Таблица убийств из метаданных матча.

- match_id — матч
- start_time — старт матча (UTC)
- time — время убийства, сек
- tick — тик replay
- slot — связанный слот
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- team — команда, записавшая убийство
- kill_type — тип
    - player — игрок
    - tower — башня
    - barracks — бараки
    - roshan — Рошан
    - miniboss — минибосс
- victim_slot — слот жертвы
- killer_slots — слоты убийц
- bounty — награда за убийство

## replay_meta_player_kills

Таблица матрицы убийств: `slot` убил `victim_slot` `count` раз.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот убийцы
- account_id — Steam32 убийцы
- parser_version — версия парсера
- victim_slot — слот жертвы
- count — число убийств

## replay_meta_players

Таблица итогов игрока из метаданных матча.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот 0–9
- account_id — Steam32
- parser_version — версия парсера
- valve_slot — слот Valve
- team_number — номер команды
- team_slot — слот внутри команды
- camps_stacked — стакнутые лагеря
- lane_selection_flags — предпочтение линии на драфте
- rampages — rampage
- triple_kills — трипл киллы
- aegis_snatched — украденный Аегис
- rapiers_purchased — купленные Rapier
- couriers_killed — убитые курьеры
- net_worth_rank — место по нетфорсу
- support_gold_spent — потраченное саппорт-золото
- observer_wards_placed — observer-варды
- sentry_wards_placed — sentry-варды
- wards_dewarded — снятые варды
- stun_duration — длительность стана
- fight_score — fight score
- farm_score — farm score
- support_score — support score
- push_score — push score
- hero_xp — опыт героя
- ability_upgrades — список id способностей
- level_up_times — времена левелапов
- graph_net_worth — график нетфорса
- graph_hero_damage — график урона по героям

## replay_meta_purchases

Таблица покупок из метаданных матча.

- match_id — матч
- start_time — старт матча (UTC)
- time — время покупки, сек
- tick — тик replay
- slot — слот покупателя
- account_id — Steam32
- parser_version — версия парсера
- item_id — предмет

## replay_meta_teams

Таблица итогов стороны из метаданных матча. Одна строка на сторону.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — −1 (строка команды)
- account_id — 0 (строка команды)
- parser_version — версия парсера
- dota_team — сторона
    - 2 — Radiant
    - 3 — Dire
- cm_first_pick — первый пик в Captains Mode
- cm_captain_player_id — капитан Captains Mode
- cm_penalty — штраф Captains Mode
- graph_experience — график опыта команды
- graph_gold_earned — график золота команды
- graph_net_worth — график нетфорса команды

## replay_meta_tips

Таблица типсов из метаданных матча.

- match_id — матч
- start_time — старт матча (UTC)
- time — время типса, сек
- tick — тик replay
- slot — связанный слот
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- source_slot — слот отправителя
- target_slot — слот получателя
- tip_amount — сумма
- event_id — событие типса

## replay_neutrals

Таблица нейтральных токенов и найденных нейтральных предметов. Событие `NEUTRAL_ITEM_EARNED` остаётся только в `replay_combat_log`.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот игрока
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- kind — тип
    - purchase — покупка
    - neutral_item — нейтральный предмет
    - found — найден
- key — имя предмета или id способности
- value — id предмета / способности

## replay_pings

Таблица пингов (`DOTA_UM_LocationPing`, `DOTA_UM_MinimapEvent`). Пинги способностей / аспектов / предметов — в `replay_alerts`.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот пингующего
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- x — координата X
- y — координата Y
- ping_type — тип пинга (`CDOTAMsg_LocationPing.type` или `event_type` миникарты)
- target — handle сущности (−1 если нет)

## replay_wards

Таблица вардов: создание и исчезновение observer / sentry.

- match_id — матч
- start_time — старт матча (UTC)
- time — игровое время, сек
- tick — тик replay
- slot — слот поставившего / владельца
- account_id — Steam32 (0 если неизвестен)
- parser_version — версия парсера
- kind — тип варда
    - obs — observer
    - sen — sentry
- is_left — событие
    - 0 — поставлен
    - 1 — истёк / уничтожен
- x — координата X
- y — координата Y
- z — координата Z
- ehandle — индекс сущности (связка постановки и исчезновения)

## schema_migrations

Версии применённых миграций dbmate (ClickHouse).

- version — timestamp миграции
- ts — время применения
- applied — флаг применения