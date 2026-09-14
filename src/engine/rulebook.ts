/**
 * The shape of a season, by rulebook.
 *
 * season.ts has always carried one calendar as module constants (STAGES,
 * LEAGUE_DAYS, INTERNATIONAL_OPEN) and branched on a single boolean for the
 * 2026 draws. A career that starts in 2023 plays a different year: LOCK//IN
 * São Paulo in February with every league side in one bracket, one league
 * stage, one Masters (Tokyo), a Last Chance Qualifier per region, then
 * Champions Los Angeles — and China outside the leagues, reaching Tokyo and
 * Los Angeles through its own qualifiers.
 *
 * Rather than re-key half the engine, 2023 is laid over the six slots the
 * engine already has: LOCK//IN sits in the Kickoff slot as one cross-region
 * competition, the league in Stage 1, Masters Tokyo in the Masters II slot
 * (the Masters I slot is simply absent from the calendar), the LCQ in the
 * Stage 2 slot as a bracket among the sides not yet through, Champions
 * where it always is. Everything keyed by stage — points, prizes, the
 * board's judgement, the schedule — keeps working; what differs is here.
 */
import type { StageKey } from './types'
import { rulesetOf, type RulesetId } from './ruleset'
import { SEASON_DAYS } from './clock'

export interface StageDef { key: StageKey; name: string; start: number; end: number }

export interface Rulebook {
  id: RulesetId
  stages: StageDef[]
  leagueDays: Record<'kickoff' | 'stage1' | 'stage2' | 'challengers1' | 'challengers2', [number, number]>
  internationalOpen: Record<'masters1' | 'masters2' | 'champions', number>
  /** the 2023 shape: LOCK//IN, one league stage of nine rounds, no Masters I, LCQ, China outside the leagues */
  lockin: boolean
  /** what the international in each slot is called on the calendar */
  eventNames: { masters1?: string; masters2: string; champions: string }
}

const CLASSIC_STAGES: StageDef[] = [
  { key: 'preseason', name: '季前准备', start: 0, end: 20 },
  { key: 'kickoff', name: 'Kickoff', start: 21, end: 62 },
  { key: 'masters1', name: 'Masters I', start: 63, end: 98 },
  { key: 'stage1', name: 'Stage 1', start: 99, end: 164 },
  { key: 'masters2', name: 'Masters II', start: 165, end: 214 },
  { key: 'stage2', name: 'Stage 2', start: 215, end: 280 },
  { key: 'champions', name: 'Champions', start: 281, end: 322 },
  { key: 'offseason', name: '休赛期', start: 323, end: SEASON_DAYS - 1 },
]

const CLASSIC: Rulebook = {
  id: 'vct-2025',
  stages: CLASSIC_STAGES,
  leagueDays: { kickoff: [24, 38], stage1: [112, 147], stage2: [220, 255], challengers1: [28, 130], challengers2: [172, 268] },
  internationalOpen: { masters1: 76, masters2: 184, champions: 296 },
  lockin: false,
  eventNames: { masters1: 'Masters I', masters2: 'Masters II', champions: 'VALORANT Champions' },
}

/**
 * 2023. LOCK//IN opened on February 13th and the leagues in late March; Tokyo
 * ran June 11–25, the LCQs in mid July, Champions August 6–26. Days are from
 * January 1st.
 */
const VCT_2023: Rulebook = {
  id: 'vct-2023',
  stages: [
    { key: 'preseason', name: '季前准备', start: 0, end: 20 },
    { key: 'kickoff', name: 'LOCK//IN', start: 21, end: 62 },
    { key: 'stage1', name: '联赛', start: 63, end: 172 },
    { key: 'masters2', name: 'Masters Tokyo', start: 173, end: 212 },
    { key: 'stage2', name: 'LCQ', start: 213, end: 247 },
    { key: 'champions', name: 'Champions', start: 248, end: 305 },
    { key: 'offseason', name: '休赛期', start: 306, end: SEASON_DAYS - 1 },
  ],
  leagueDays: { kickoff: [24, 38], stage1: [80, 150], stage2: [218, 240], challengers1: [28, 130], challengers2: [172, 268] },
  internationalOpen: { masters1: 76, masters2: 184, champions: 262 },
  lockin: true,
  eventNames: { masters2: 'Masters II', champions: 'VALORANT Champions' },
}

export const RULEBOOKS: Record<RulesetId, Rulebook> = {
  'vct-2025': CLASSIC,
  'vct-2026': { ...CLASSIC, id: 'vct-2026' },
  'vct-2023': VCT_2023,
}

export const rulebookOf = (state: { rulesetId?: RulesetId }): Rulebook => RULEBOOKS[rulesetOf(state)]
export const stagesOf = (state: { rulesetId?: RulesetId }): StageDef[] => rulebookOf(state).stages
export const stageAtIn = (state: { rulesetId?: RulesetId }, day: number): StageKey =>
  stagesOf(state).find((s) => day >= s.start && day <= s.end)?.key ?? 'offseason'
/** the classic calendar, for checks and copy that describe the ordinary year */
export const CLASSIC_RULEBOOK = CLASSIC
