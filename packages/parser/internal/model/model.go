package model

import "time"

// Header is the shared prefix on every replay_* row.
type Header struct {
	MatchID       uint64    `ch:"match_id"`
	StartTime     time.Time `ch:"start_time"`
	Time          int32     `ch:"time"`
	Tick          uint32    `ch:"tick"`
	Slot          int8      `ch:"slot"`
	ParserVersion uint16    `ch:"parser_version"`
	ParseRunID    uint64    `ch:"parse_run_id"`
}

type CombatLog struct {
	Header
	Type                      string  `ch:"type"`
	Attacker                  string  `ch:"attacker"`
	Target                    string  `ch:"target"`
	Inflictor                 string  `ch:"inflictor"`
	AttackerSlot              int8    `ch:"attacker_slot"`
	TargetSlot                int8    `ch:"target_slot"`
	Value                     int32   `ch:"value"`
	ValueName                 string  `ch:"value_name"`
	GoldReason                uint16  `ch:"gold_reason"`
	XpReason                  uint16  `ch:"xp_reason"`
	AttackerHero              uint8   `ch:"attacker_hero"`
	TargetHero                uint8   `ch:"target_hero"`
	AttackerIllusion          uint8   `ch:"attacker_illusion"`
	TargetIllusion            uint8   `ch:"target_illusion"`
	StunDuration              float32 `ch:"stun_duration"`
	SlowDuration              float32 `ch:"slow_duration"`
	Sourcename                string  `ch:"sourcename"`
	Targetsourcename          string  `ch:"targetsourcename"`
	GreevilsGreedStack        uint16  `ch:"greevils_greed_stack"`
	TrackedDeath              uint8   `ch:"tracked_death"`
	TrackedSourcename         string  `ch:"tracked_sourcename"`
	Health                    int32   `ch:"health"`
	AbilityLevel              uint8   `ch:"ability_level"`
	LocationX                 float32 `ch:"location_x"`
	LocationY                 float32 `ch:"location_y"`
	ModifierDuration          float32 `ch:"modifier_duration"`
	LastHits                  uint32  `ch:"last_hits"`
	AttackerTeam              uint8   `ch:"attacker_team"`
	TargetTeam                uint8   `ch:"target_team"`
	StackCount                uint16  `ch:"stack_count"`
	IsTargetBuilding          uint8   `ch:"is_target_building"`
	RuneType                  uint16  `ch:"rune_type"`
	Networth                  uint32  `ch:"networth"`
	VisibleRadiant            uint8   `ch:"visible_radiant"`
	VisibleDire               uint8   `ch:"visible_dire"`
	IsAbilityToggleOn         uint8   `ch:"is_ability_toggle_on"`
	IsAbilityToggleOff        uint8   `ch:"is_ability_toggle_off"`
	TimestampRaw              float32 `ch:"timestamp_raw"`
	ObsWardsPlaced            uint16  `ch:"obs_wards_placed"`
	AssistPlayer0             uint32  `ch:"assist_player0"`
	AssistPlayer1             uint32  `ch:"assist_player1"`
	AssistPlayer2             uint32  `ch:"assist_player2"`
	AssistPlayer3             uint32  `ch:"assist_player3"`
	AssistPlayers             []int32 `ch:"assist_players"`
	HiddenModifier            uint8   `ch:"hidden_modifier"`
	NeutralCampType           uint16  `ch:"neutral_camp_type"`
	IsHealSave                uint8   `ch:"is_heal_save"`
	IsUltimateAbility         uint8   `ch:"is_ultimate_ability"`
	AttackerHeroLevel         uint16  `ch:"attacker_hero_level"`
	TargetHeroLevel           uint16  `ch:"target_hero_level"`
	Xpm                       uint32  `ch:"xpm"`
	Gpm                       uint32  `ch:"gpm"`
	EventLocation             uint16  `ch:"event_location"`
	TargetIsSelf              uint8   `ch:"target_is_self"`
	DamageType                uint16  `ch:"damage_type"`
	InvisibilityModifier      uint8   `ch:"invisibility_modifier"`
	DamageCategory            uint16  `ch:"damage_category"`
	BuildingType              uint16  `ch:"building_type"`
	ModifierElapsedDuration   float32 `ch:"modifier_elapsed_duration"`
	SilenceModifier           uint8   `ch:"silence_modifier"`
	HealFromLifesteal         uint8   `ch:"heal_from_lifesteal"`
	ModifierPurged            uint8   `ch:"modifier_purged"`
	SpellEvaded               uint8   `ch:"spell_evaded"`
	MotionControllerModifier  uint8   `ch:"motion_controller_modifier"`
	LongRangeKill             uint8   `ch:"long_range_kill"`
	ModifierPurgeAbility      uint32  `ch:"modifier_purge_ability"`
	ModifierPurgeNpc          uint32  `ch:"modifier_purge_npc"`
	RootModifier              uint8   `ch:"root_modifier"`
	TotalUnitDeathCount       uint32  `ch:"total_unit_death_count"`
	AuraModifier              uint8   `ch:"aura_modifier"`
	ArmorDebuffModifier       uint8   `ch:"armor_debuff_modifier"`
	NoPhysicalDamageModifier  uint8   `ch:"no_physical_damage_modifier"`
	ModifierAbility           uint32  `ch:"modifier_ability"`
	ModifierHidden            uint8   `ch:"modifier_hidden"`
	InflictorIsStolenAbility  uint8   `ch:"inflictor_is_stolen_ability"`
	KillEaterEvent            uint32  `ch:"kill_eater_event"`
	UnitStatusLabel           uint32  `ch:"unit_status_label"`
	SpellGeneratedAttack      uint8   `ch:"spell_generated_attack"`
	AtNightTime               uint8   `ch:"at_night_time"`
	AttackerHasScepter        uint8   `ch:"attacker_has_scepter"`
	NeutralCampTeam           uint16  `ch:"neutral_camp_team"`
	RegeneratedHealth         float32 `ch:"regenerated_health"`
	WillReincarnate           uint8   `ch:"will_reincarnate"`
	UsesCharges               uint8   `ch:"uses_charges"`
	TrackedStatID             uint32  `ch:"tracked_stat_id"`
	ModifierPurgedDuration    float32 `ch:"modifier_purged_duration"`
	HealFromRegen             uint8   `ch:"heal_from_regen"`
}

type Interval struct {
	Header
	HeroID                 int32   `ch:"hero_id"`
	Variant                int16   `ch:"variant"`
	X                      float32 `ch:"x"`
	Y                      float32 `ch:"y"`
	Gold                   uint32  `ch:"gold"`
	LH                     uint32  `ch:"lh"`
	XP                     uint32  `ch:"xp"`
	Networth               uint32  `ch:"networth"`
	Denies                 uint16  `ch:"denies"`
	Level                  uint8   `ch:"level"`
	Kills                  uint16  `ch:"kills"`
	Deaths                 uint16  `ch:"deaths"`
	Assists                uint16  `ch:"assists"`
	LifeState              uint8   `ch:"life_state"`
	Stuns                  float32 `ch:"stuns"`
	ObsPlaced              uint16  `ch:"obs_placed"`
	SenPlaced              uint16  `ch:"sen_placed"`
	CreepsStacked          uint16  `ch:"creeps_stacked"`
	CampsStacked           uint16  `ch:"camps_stacked"`
	RunePickups            uint16  `ch:"rune_pickups"`
	TowersKilled           uint8   `ch:"towers_killed"`
	RoshansKilled          uint8   `ch:"roshans_killed"`
	TeamfightParticipation float32 `ch:"teamfight_participation"`
	FirstbloodClaimed      uint8   `ch:"firstblood_claimed"`
	DraftStage             uint8   `ch:"draft_stage"`
	Unit                   string  `ch:"unit"`
	FacetHeroID            int32   `ch:"facet_hero_id"`
	Repicked               uint8   `ch:"repicked"`
	Randomed               uint8   `ch:"randomed"`
	PredVict               uint8   `ch:"pred_vict"`
	ObserversPlaced        uint16  `ch:"observers_placed"`
}

type Action struct {
	Header
	OrderType   uint16  `ch:"order_type"`
	UnitIndex   int32   `ch:"unit_index"`
	TargetIndex int32   `ch:"target_index"`
	AbilityID   int32   `ch:"ability_id"`
	PosX        float32 `ch:"pos_x"`
	PosY        float32 `ch:"pos_y"`
	PosZ        float32 `ch:"pos_z"`
	Queued      uint8   `ch:"queued"`
}

type Ping struct {
	Header
	X        float32 `ch:"x"`
	Y        float32 `ch:"y"`
	PingType uint16  `ch:"ping_type"`
	Target   int32   `ch:"target"`
}

type Ward struct {
	Header
	Kind    string  `ch:"kind"`
	IsLeft  uint8   `ch:"is_left"`
	X       float32 `ch:"x"`
	Y       float32 `ch:"y"`
	Z       float32 `ch:"z"`
	Ehandle uint32  `ch:"ehandle"`
}

type Chat struct {
	Header
	Kind    string `ch:"kind"`
	Key     string `ch:"key"`
	Unit    string `ch:"unit"`
	Channel uint8  `ch:"channel"`
}

type Announcement struct {
	Header
	Kind    string `ch:"kind"`
	Player1 int16  `ch:"player1"`
	Player2 int16  `ch:"player2"`
	Value   int32  `ch:"value"`
	Player3 int16  `ch:"player3"`
	Value2  uint32 `ch:"value2"`
	Value3  uint32 `ch:"value3"`
}

type Draft struct {
	Header
	IsPick           uint8 `ch:"is_pick"`
	HeroID           int32 `ch:"hero_id"`
	Team             uint8 `ch:"team"`
	Ord              uint16 `ch:"ord"`
	Clock            int32 `ch:"clock"`
	ExtraTimeRadiant int32 `ch:"extra_time_radiant"`
	ExtraTimeDire    int32 `ch:"extra_time_dire"`
}

type AbilityLevel struct {
	Header
	AbilityID    string `ch:"ability_id"`
	AbilityLevel uint8  `ch:"ability_level"`
	Target       string `ch:"target"`
}

type Inventory struct {
	Header
	ItemID            string `ch:"item_id"`
	ItemSlot          int8   `ch:"item_slot"`
	Charges           uint16 `ch:"charges"`
	SecondaryCharges  uint16 `ch:"secondary_charges"`
}

type Neutral struct {
	Header
	Kind                 string `ch:"kind"`
	Key                  string `ch:"key"`
	Value                int32  `ch:"value"`
	IsNeutralActiveDrop  uint8  `ch:"is_neutral_active_drop"`
	IsNeutralPassiveDrop uint8  `ch:"is_neutral_passive_drop"`
}

type Cosmetic struct {
	Header
	ItemID    uint32 `ch:"item_id"`
	AccountID uint32 `ch:"account_id"`
}

type Epilogue struct {
	Header
	Key   string `ch:"key"`
	Value string `ch:"value"`
}

// Result is the full in-memory parse of one replay. Nothing is written
// until this exists and ClickHouse insert of every table succeeds.
type Result struct {
	MatchID       uint64
	StartTime     time.Time
	ParseRunID    uint64
	ParserVersion uint16
	CombatLog     []CombatLog
	Intervals     []Interval
	Actions       []Action
	Pings         []Ping
	Wards         []Ward
	Chat          []Chat
	Announcements []Announcement
	Draft         []Draft
	AbilityLevels []AbilityLevel
	Inventory     []Inventory
	Neutrals      []Neutral
	Cosmetics     []Cosmetic
	Epilogue      []Epilogue
	Objectives    []Objective
	PlayerSummary []PlayerSummary
}

type Objective struct {
	Time  int32
	Kind  string
	Team  *int16
	Slot  *int32
	Key   string
	Value *int32
}

type PlayerSummary struct {
	Slot                   int32
	Lane                   int32
	LaneRole               int32
	IsRoaming              bool
	Stuns                  float32
	TeamfightParticipation float32
	TowersKilled           int32
	RoshansKilled          int32
	ObserversPlaced        int32
	SentriesPlaced         int32
	CampsStacked           int32
	CreepsStacked          int32
	RunePickups            int32
	FirstbloodClaimed      int32
}

func (r *Result) Counts() map[string]int {
	return map[string]int{
		"combat_log":    len(r.CombatLog),
		"intervals":     len(r.Intervals),
		"actions":       len(r.Actions),
		"pings":         len(r.Pings),
		"wards":         len(r.Wards),
		"chat":          len(r.Chat),
		"announcements": len(r.Announcements),
		"draft":         len(r.Draft),
		"ability_levels": len(r.AbilityLevels),
		"inventory":     len(r.Inventory),
		"neutrals":      len(r.Neutrals),
		"cosmetics":     len(r.Cosmetics),
		"epilogue":      len(r.Epilogue),
		"objectives":    len(r.Objectives),
	}
}
