import { squadOf, wageBill } from './world'
import { skillMod } from './manager'
import type { GameState, StageKey } from './types'

/** Prize money by competition and placement (USD). */
export const PRIZE: Record<string, number[]> = {
  kickoff: [200000, 120000, 70000, 45000, 25000, 25000, 12000, 12000],
  stage1: [300000, 180000, 110000, 70000, 45000, 30000, 20000, 20000],
  stage2: [300000, 180000, 110000, 70000, 45000, 30000, 20000, 20000],
  masters1: [350000, 200000, 130000, 90000, 55000, 55000, 35000, 35000],
  masters2: [350000, 200000, 130000, 90000, 55000, 55000, 35000, 35000],
  champions: [1000000, 500000, 300000, 200000, 120000, 120000, 80000, 80000],
  challengers1: [40000, 24000, 15000, 10000, 6000, 6000, 3000, 3000],
  challengers2: [60000, 36000, 22000, 15000, 9000, 9000, 5000, 5000],
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
    const scale = team.tier === 1 ? 1 : 0.35
    const upkeep = Math.round(
      (team.facilities * 900 + squadOf(state, team.id).length * 1400) / 4 * scale,
    )
    const net = sponsor - wages - upkeep
    team.budget += net

    if (team.id === state.myTeam) {
      state.finances.balance += net
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
