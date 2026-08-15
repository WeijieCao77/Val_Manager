import { Rng, clamp } from './rng'
import { expectedSalary, marketValue, refreshValue } from './player'
import { autoStarters, squadOf, wageBill } from './world'
import type { GameState, Player, Team, TransferOffer } from './types'

export const TRANSFER_WINDOWS: [number, number][] = [
  [0, 20],    // 季前
  [169, 194], // Masters II 期间的短窗口
  [311, 335], // 休赛期
]

export const windowOpen = (day: number): boolean =>
  TRANSFER_WINDOWS.some(([a, b]) => day >= a && day <= b)

/** What the selling club wants for a player under contract. */
export function askingPrice(p: Player): number {
  const base = marketValue(p)
  if (p.teamId === null) return 0
  const contractPull = 1 + Math.max(0, p.contractYears) * 0.18
  const listed = p.listed ? 0.75 : 1
  return Math.round((base * contractPull * listed) / 1000) * 1000
}

/** Would the club sell at this fee? */
export function clubAcceptsFee(p: Player, fee: number, rng: Rng): boolean {
  const ask = askingPrice(p)
  if (ask <= 0) return true
  const ratio = fee / ask
  if (ratio >= 1.15) return true
  if (ratio < 0.7) return false
  return rng.chance((ratio - 0.7) / 0.5)
}

/** Would the player sign for this club on these terms? */
export function playerAcceptsTerms(
  state: GameState, p: Player, toTeam: Team, salary: number, years: number, rng: Rng,
): { ok: boolean; reason?: string } {
  const want = expectedSalary(p, toTeam.tier)
  if (salary < want * 0.85) return { ok: false, reason: `${p.ign} 认为薪资太低（期望约 $${want.toLocaleString()}/年）。` }

  const from = p.teamId ? state.teams[p.teamId] : null
  let score = 0
  score += (salary / want - 1) * 60
  score += (toTeam.reputation - (from?.reputation ?? 30)) * 0.9
  if (from && toTeam.tier < from.tier) score += 18
  if (from && toTeam.tier > from.tier) score -= 22
  score += (p.ambition - 55) * 0.25 * (toTeam.reputation > (from?.reputation ?? 0) ? 1 : -1)
  if (from) score -= (p.loyalty - 50) * 0.35
  // a bench player is easier to tempt
  if (from && !from.starters.includes(p.id)) score += 14
  if (years >= 3) score += p.age >= 27 ? 8 : 3

  const p_ok = 1 / (1 + Math.exp(-score / 14))
  if (rng.chance(p_ok)) return { ok: true }
  return { ok: false, reason: `${p.ign} 拒绝了这份合同，他对目前的处境还算满意。` }
}

export function doTransfer(
  state: GameState, p: Player, toTeamId: string, fee: number, salary: number, years: number,
): void {
  const from = p.teamId ? state.teams[p.teamId] : null
  const to = state.teams[toTeamId]
  if (!to) return

  if (from) {
    from.roster = from.roster.filter((id) => id !== p.id)
    from.starters = from.starters.filter((id) => id !== p.id)
    from.budget += fee
    if (from.id === state.myTeam) {
      state.finances.balance += fee
      state.finances.log.push({ day: state.day, label: `出售 ${p.ign}`, amount: fee })
    }
  }

  to.roster.push(p.id)
  to.budget -= fee
  if (to.id === state.myTeam) {
    state.finances.balance -= fee
    state.finances.log.push({ day: state.day, label: `签下 ${p.ign}`, amount: -fee })
    state.training[p.id] = 'rest'
  }

  p.teamId = toTeamId
  p.salary = salary
  p.contractYears = years
  p.listed = false
  p.morale = clamp(p.morale + 8, 0, 100)
  refreshValue(p)

  if (to.starters.length < 5) to.starters = autoStarters(state, to.id)

  state.news.push({
    day: state.day,
    kind: 'transfer',
    text: fee > 0
      ? `${to.name} 以 $${fee.toLocaleString()} 的转会费从 ${from?.name ?? '自由市场'} 签下 ${p.ign}。`
      : `${to.name} 免费签下自由人 ${p.ign}。`,
    important: to.id === state.myTeam || from?.id === state.myTeam,
  })
}

export function releasePlayer(state: GameState, p: Player): void {
  const from = p.teamId ? state.teams[p.teamId] : null
  if (from) {
    from.roster = from.roster.filter((id) => id !== p.id)
    from.starters = from.starters.filter((id) => id !== p.id)
    // paying up the remaining contract
    const payoff = Math.round(p.salary * Math.max(0, p.contractYears) * 0.4)
    from.budget -= payoff
    if (from.id === state.myTeam) {
      state.finances.balance -= payoff
      state.finances.log.push({ day: state.day, label: `解约 ${p.ign}`, amount: -payoff })
    }
  }
  p.teamId = null
  p.contractYears = 0
  p.listed = false
  p.morale = clamp(p.morale - 6, 0, 100)
  state.news.push({
    day: state.day, kind: 'transfer',
    text: `${from?.name ?? '某队'} 与 ${p.ign} 解除合同，该选手成为自由人。`,
    important: from?.id === state.myTeam,
  })
}

/** Rough squad need: which role is the club thinnest at? */
function weakestRole(state: GameState, team: Team): { role: Player['role']; strength: number } | null {
  const squad = squadOf(state, team.id)
  const roles: Player['role'][] = ['决斗者', '先锋', '控场', '哨卫', '自由人']
  let worst: { role: Player['role']; strength: number } | null = null
  for (const r of roles) {
    const best = squad.filter((p) => p.role === r).sort((a, b) => b.overall - a.overall)[0]
    const strength = best?.overall ?? 0
    if (!worst || strength < worst.strength) worst = { role: r, strength }
  }
  return worst
}

/**
 * AI clubs work the market: fill holes from free agency, occasionally bid for
 * a player who is unhappy or transfer-listed.
 */
export function aiTransferTick(state: GameState, rng: Rng): void {
  if (!windowOpen(state.day)) return

  const teams = Object.values(state.teams).filter((t) => t.id !== state.myTeam)
  const agents = Object.values(state.players).filter((p) => p.teamId === null)

  for (const team of teams) {
    if (!rng.chance(0.1)) continue
    const squad = squadOf(state, team.id)
    const wages = wageBill(state, team.id)
    const room = team.budget - wages * 0.6

    // too thin: sign a free agent
    if (squad.length < 5 || (squad.length < 7 && rng.chance(0.35))) {
      const need = weakestRole(state, team)
      const target = agents
        .filter((p) => !need || p.role === need.role || rng.chance(0.3))
        .filter((p) => expectedSalary(p, team.tier) < Math.max(40000, room * 0.25))
        .sort((a, b) => b.overall - a.overall)[0]
      if (target) {
        const salary = Math.round(expectedSalary(target, team.tier) * rng.range(1.0, 1.15))
        const verdict = playerAcceptsTerms(state, target, team, salary, rng.int(1, 3), rng)
        if (verdict.ok) {
          doTransfer(state, target, team.id, 0, salary, rng.int(1, 3))
          agents.splice(agents.indexOf(target), 1)
        }
      }
      continue
    }

    // shopping for an upgrade
    if (rng.chance(0.35) && room > 500000) {
      const need = weakestRole(state, team)
      if (!need) continue
      const candidates = Object.values(state.players).filter(
        (p) =>
          p.teamId && p.teamId !== team.id && p.role === need.role &&
          p.overall > need.strength + 3 &&
          (p.listed || p.morale < 45 || rng.chance(0.05)),
      )
      const target = candidates.sort((a, b) => b.overall - a.overall)[0]
      if (!target) continue
      const fee = Math.round(askingPrice(target) * rng.range(0.9, 1.25))
      if (fee > room) continue
      if (!clubAcceptsFee(target, fee, rng)) continue
      const salary = Math.round(expectedSalary(target, team.tier) * rng.range(1.0, 1.2))
      const verdict = playerAcceptsTerms(state, target, team, salary, rng.int(2, 3), rng)
      if (verdict.ok) doTransfer(state, target, team.id, fee, salary, rng.int(2, 3))
    }
  }

  // clubs list players they no longer want
  for (const team of teams) {
    if (!rng.chance(0.05)) continue
    const squad = squadOf(state, team.id).sort((a, b) => a.overall - b.overall)
    if (squad.length > 5 && squad[0]) squad[0].listed = true
  }
}

export function makeOffer(
  state: GameState, playerId: string, toTeam: string, fee: number, salary: number, years: number,
): TransferOffer {
  const offer: TransferOffer = {
    id: `O${state.offers.length}_${state.day}`,
    playerId,
    fromTeam: state.players[playerId]?.teamId ?? null,
    toTeam, fee, salary, years,
    day: state.day,
    status: 'pending',
  }
  state.offers.push(offer)
  return offer
}

/** Resolve an offer the human manager submitted. */
export function resolveMyOffer(state: GameState, offer: TransferOffer, rng: Rng): string {
  const p = state.players[offer.playerId]
  const to = state.teams[offer.toTeam]
  if (!p || !to) {
    offer.status = 'rejected'
    return '目标不存在。'
  }
  const cost = offer.fee
  if (cost > state.finances.balance) {
    offer.status = 'rejected'
    return '资金不足，无法支付这笔转会费。'
  }
  if (p.teamId) {
    if (!clubAcceptsFee(p, offer.fee, rng)) {
      offer.status = 'rejected'
      const ask = askingPrice(p)
      return `${state.teams[p.teamId]?.name} 拒绝了报价，他们的心理价位在 $${ask.toLocaleString()} 左右。`
    }
  }
  const verdict = playerAcceptsTerms(state, p, to, offer.salary, offer.years, rng)
  if (!verdict.ok) {
    offer.status = 'rejected'
    return verdict.reason ?? '选手拒绝了这份合同。'
  }
  doTransfer(state, p, to.id, offer.fee, offer.salary, offer.years)
  offer.status = 'accepted'
  return `签约完成：${p.ign} 加盟 ${to.name}。`
}
