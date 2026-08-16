import { Rng, clamp, hashStr } from './rng'
import type { Coach, GameState, StaffCandidate } from './types'
import { WORLD_TEAMS } from './world'

/**
 * Building the club rather than only the roster.
 *
 * Facilities and coaching were read-only numbers that quietly scaled every
 * training gain, with nothing in the game explaining where they came from. Both
 * are now things the manager spends money on — which is also what the new
 * commercial income is for.
 */

/** What the next facility level costs. Deliberately steep at the top end. */
export function facilityCost(level: number): number {
  return Math.round(60_000 + level * level * 90)
}

export function upgradeFacility(state: GameState): string {
  const team = state.teams[state.myTeam]
  if (!team) return '找不到俱乐部。'
  if (team.facilities >= 95) return '训练设施已经是顶级水平了。'
  const cost = facilityCost(team.facilities)
  if (state.finances.balance < cost) return `资金不足，需要 ${Math.round(cost / 1000)}K。`

  state.finances.balance -= cost
  state.finances.log.push({ day: state.day, label: '训练设施升级', amount: -cost })
  team.facilities = clamp(team.facilities + 1, 0, 95)
  return `训练设施升级到 ${team.facilities}。`
}

/**
 * Assistant coaches around the league, available as head coaches.
 *
 * These are real people from the same Liquipedia data as the head coaches —
 * every club's listed assistants. Hiring one does not strip another club of the
 * coach it actually depends on, which poaching head coaches would.
 */
export function staffMarket(state: GameState): StaffCandidate[] {
  const taken = new Set(
    Object.values(state.teams).map((t) => t.coach?.name).filter(Boolean) as string[],
  )
  const out: StaffCandidate[] = []
  for (const t of WORLD_TEAMS) {
    for (const name of t.coach?.assistants ?? []) {
      if (taken.has(name)) continue
      // an assistant grades out below the head coach he works under
      const rng = new Rng(hashStr(`staff:${name}`))
      const base = t.coach
        ? (t.coach.tactics + t.coach.development + t.coach.motivation) / 3
        : 58
      const step = () => clamp(Math.round(base - rng.range(4, 16) + rng.range(-5, 5)), 30, 88)
      out.push({
        name,
        from: t.name,
        tactics: step(),
        development: step(),
        motivation: step(),
        salary: 0,
      })
    }
  }
  for (const c of out) {
    const grade = (c.tactics + c.development + c.motivation) / 3
    // pay tracks quality steeply, so a real upgrade is a real commitment
    c.salary = Math.round(40_000 + Math.pow(Math.max(0, grade - 40), 2) * 120)
  }
  return out.sort((a, b) => (b.tactics + b.development + b.motivation) - (a.tactics + a.development + a.motivation))
}

export function hireCoach(state: GameState, name: string): string {
  const team = state.teams[state.myTeam]
  if (!team) return '找不到俱乐部。'
  const pick = staffMarket(state).find((c) => c.name === name)
  if (!pick) return '这位教练已经不在市场上了。'

  // a signing fee up front, then the salary shows up in the weekly wage bill
  const fee = Math.round(pick.salary * 0.5)
  if (state.finances.balance < fee) return `资金不足，签约费需要 ${Math.round(fee / 1000)}K。`
  state.finances.balance -= fee
  state.finances.log.push({ day: state.day, label: `聘请教练 ${pick.name}`, amount: -fee })

  const old = team.coach?.name
  const coach: Coach = {
    name: pick.name,
    tactics: pick.tactics,
    development: pick.development,
    motivation: pick.motivation,
    salary: pick.salary,
  }
  team.coach = coach
  state.news.push({
    day: state.day, kind: 'club', important: true,
    text: `${team.name} 聘请 ${pick.name}（原 ${pick.from} 助教）担任主教练${old ? `，接替 ${old}` : ''}。`,
  })
  return `${pick.name} 已就任主教练。`
}
