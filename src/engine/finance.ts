import { squadOf, wageBill } from './world'
import { skillMod } from './manager'
import type { GameState, StageKey } from './types'

/** Prize money by competition and placement (USD). */
// Raised across the board after the group's "赚不到钱" week: a Challengers
// title paid $40k against a season's wage bill, and winning the biggest event
// in the game paid one million — trophies should move a balance sheet.
export const PRIZE: Record<string, number[]> = {
  kickoff: [260000, 150000, 90000, 55000, 30000, 30000, 15000, 15000],
  stage1: [380000, 220000, 135000, 85000, 55000, 38000, 25000, 25000],
  stage2: [380000, 220000, 135000, 85000, 55000, 38000, 25000, 25000],
  masters1: [500000, 280000, 180000, 120000, 70000, 70000, 45000, 45000],
  masters2: [500000, 280000, 180000, 120000, 70000, 70000, 45000, 45000],
  champions: [1500000, 750000, 420000, 280000, 160000, 160000, 100000, 100000],
  challengers1: [90000, 52000, 32000, 20000, 12000, 12000, 6000, 6000],
  challengers2: [130000, 75000, 45000, 30000, 18000, 18000, 10000, 10000],
}

export function awardPrize(state: GameState, stage: StageKey, order: string[]): void {
  const table = PRIZE[stage]
  if (!table) return
  order.forEach((teamId, i) => {
    const amount = table[i] ?? 0
    if (!amount) return
    const team = state.teams[teamId]
    if (!team) return
    // players take their contracted cut before the club banks the rest
    let share = 0
    for (const pid of team.roster) {
      const c = state.players[pid]?.contract
      if (c?.bonusShare) share += (amount * c.bonusShare) / 100 / Math.max(1, team.roster.length)
    }
    share = Math.round(share)
    const net = amount - share
    team.budget += net
    team.seasonPrize += net
    if (teamId === state.myTeam) {
      state.finances.balance += net
      state.finances.log.push({ day: state.day, label: `奖金 · ${stage} 第${i + 1}名`, amount: net })
      if (share > 0) {
        state.finances.log.push({ day: state.day, label: '选手奖金分成', amount: -share })
      }
    }
  })
}

/**
 * What a week of keeping the lights on costs.
 *
 * Exported because the finance screen used to carry its own copy of this sum
 * and had never learned about the tier scale — it showed a profitable
 * Challengers club a red annual loss, sign and all. One formula, two readers.
 */
export function weeklyUpkeep(state: GameState, teamId: string): number {
  const team = state.teams[teamId]
  if (!team) return 0
  // Operating costs scale with the tier the club actually competes in: a
  // Challengers org does not fly to Masters, does not carry a VCT support
  // staff, and does not run a VCT facility.
  const scale = team.tier === 1 ? 1 : 0.35
  return Math.round((team.facilities * 900 + squadOf(state, teamId).length * 1400) / 4 * scale)
}

/** A season of the same, as the finance screen projects it. */
export const seasonUpkeep = (state: GameState, teamId: string): number =>
  weeklyUpkeep(state, teamId) * 48

/** Weekly payroll and sponsorship, charged to every club. */
export function weeklyFinance(state: GameState): void {
  for (const team of Object.values(state.teams)) {
    const wages = Math.round(wageBill(state, team.id) / 48)
    // 商务: sponsors pay a club whose manager works the relationship
    const sponsor = Math.round(team.sponsors.reduce((s, x) => s + x.perSeason, 0) / 48 *
      (team.id === state.myTeam ? skillMod(state.manager, 'business', 0.005) : 1))
    // Operating costs scale with the tier the club actually competes in.
    //
    // The formula was tier-blind, so a Challengers side paid VCT-scale running
    // costs on a tenth of the income: measured across the world, 28 of 29
    // tier-2 clubs lost money every season and a typical one went from $0.69M
    // to -$0.21M inside three seasons. Since a manager with ordinary starting
    // reputation can *only* be hired in Challengers, that was the default new
    // career — insolvent by construction, with no decision able to prevent it.
    // A Challengers org does not fly to Masters, does not carry a VCT support
    // staff, and does not run a VCT facility.
    const upkeep = weeklyUpkeep(state, team.id)
    const net = sponsor - wages - upkeep
    team.budget += net

    if (team.id === state.myTeam) {
      state.finances.balance += net
      // "资金为负会持续削弱董事会信任度" is printed on the finance page and
      // was true of nothing: every write to boardConfidence came from results.
      // Debt now costs confidence, scaled to how deep it is, so the warning
      // and the sack chain it points at actually connect.
      if (state.finances.balance < 0) {
        const depth = Math.min(3, -state.finances.balance / Math.max(1, wages * 4))
        const hit = 0.5 + depth * 1.5
        state.boardConfidence = Math.max(0, state.boardConfidence - hit)
      }
      state.finances.log.push({ day: state.day, label: '赞助收入', amount: sponsor })
      state.finances.log.push({ day: state.day, label: '选手薪资', amount: -wages })
      state.finances.log.push({ day: state.day, label: '运营开支', amount: -upkeep })
      if (state.finances.log.length > 200) {
        state.finances.log.splice(0, state.finances.log.length - 200)
      }
    }
  }
}

export const seasonWageBill = (state: GameState, teamId: string) => wageBill(state, teamId)

export const sponsorIncome = (state: GameState, teamId: string) =>
  state.teams[teamId]?.sponsors.reduce((s, x) => s + x.perSeason, 0) ?? 0
