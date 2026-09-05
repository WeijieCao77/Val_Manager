/**
 * Which rulebook a career plays by.
 *
 * The real circuit changes its formats; a career already under way should
 * not. So the rules are versioned and a save carries its rulebook's name.
 *
 *  - `vct-2025`: what this game has always played — Kickoff as a short group
 *    phase and a four-team bracket, Stage 1 and 2 as twelve-team round
 *    robins, a Masters Swiss paired by a formula, Champions groups by a
 *    rotation. Careers without a rulebook named are this.
 *  - `vct-2026`: the 2026 circuit with its draws — Kickoff as a twelve-team
 *    triple elimination drawn at random with byes for last year's Champions
 *    sides, Stage 1 and 2 as Alpha and Omega groups of six drawn from pots,
 *    a Masters Swiss drawn round by round with the region champions picking
 *    their quarter-final opponents, Champions groups drawn from four pots
 *    with one side per region and a drawn quarter-final. See engine/draw.ts.
 *
 * Careers started at /manager/test play `vct-2026`; /manager plays
 * `vct-2025` until the owner flips it.
 */
import type { GameState } from './types'

export type RulesetId = 'vct-2025' | 'vct-2026'

export const RULESET_CN: Record<RulesetId, string> = {
  'vct-2025': '经典赛制',
  'vct-2026': 'VCT 2026 赛制（抽签版）',
}

export const rulesetOf = (state: Pick<GameState, 'rulesetId'>): RulesetId => state.rulesetId ?? 'vct-2025'

/** The 2026 rulebook, with its draws. */
export const drawRules = (state: Pick<GameState, 'rulesetId'>): boolean => rulesetOf(state) === 'vct-2026'

/**
 * The rulebook new careers are created with, set by the shell for the
 * address it is serving: /manager/test names vct-2026, /manager the old
 * one. A module-level setting rather than an argument threaded through
 * every screen that can start a game.
 */
let current: RulesetId = 'vct-2025'
export const setCurrentRuleset = (id: RulesetId): void => { current = id }
export const currentRuleset = (): RulesetId => current
