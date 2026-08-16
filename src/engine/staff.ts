import { Rng, clamp, hashStr } from './rng'
import type { AnalystSpec, Coach, GameState, StaffCandidate, StaffRole, Team } from './types'
import { wageBill } from './world'
import { WORLD_ANALYSTS, WORLD_TEAMS } from './world'

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
/**
 * The analyst pool, kept separate from the coaching one.
 *
 * A head coach and an assistant are the same profession at different levels, so
 * they share a market. An analyst is not — different job, different people, and
 * far fewer of them.
 */
export function analystMarket(state: GameState): StaffCandidate[] {
  const taken = new Set([
    ...(state.staff ?? []).map((m) => m.name),
    ...Object.values(state.teams).map((t) => t.coach?.name).filter(Boolean) as string[],
  ])
  return WORLD_ANALYSTS
    .filter((a) => !taken.has(a.name))
    .map((a) => ({
      ...a,
      spec: a.spec as AnalystSpec,
      salary: Math.round(
        40_000 + Math.pow(Math.max(0, (a.tactics + a.development + a.motivation) / 3 - 40), 2) * 120 * 0.45,
      ),
    }))
    .sort((x, y) => y.tactics - x.tactics)
}

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

export const SPEC_CN: Record<AnalystSpec, { label: string; blurb: string }> = {
  maps: { label: '图池分析', blurb: '「跑图」训练的地图熟练度收益 +60%' },
  opponent: { label: '对手研究', blurb: '比赛中的战术加成提升，相当于多半个主教练' },
  potential: { label: '数据建模', blurb: '潜力看得更准，等同于额外的「眼光」天赋' },
  economy: { label: '经济分析', blurb: '道具与经济运用更高效，全场小幅加成' },
  review: { label: '复盘专家', blurb: '「教练复盘」训练的意识与指挥收益翻倍' },
}

export const ROLE_CN: Record<StaffRole, string> = {
  head: '主教练', assistant: '助理教练', analyst: '数据分析师',
}

/** What a role is worth relative to a head coach's asking price. */
const ROLE_PAY: Record<StaffRole, number> = { head: 1, assistant: 0.55, analyst: 0.45 }

/**
 * Approach a coach. They do not answer on the spot.
 *
 * A hire used to be instant and unconditional, which made the whole staff
 * screen a shop. Now it is an offer with terms, answered somewhere in the next
 * week — and it can come back no.
 */
/**
 * Head coaches currently employed elsewhere.
 *
 * These are the names worth having, and none of them are available: their club
 * has to agree to let you talk first. Compensation is what buys that agreement.
 */
export function employedCoaches(state: GameState): { team: Team; coach: Coach; ask: number }[] {
  return Object.values(state.teams)
    .filter((t) => t.id !== state.myTeam && t.coach)
    .map((t) => {
      const c = t.coach!
      const grade = (c.tactics + c.development + c.motivation) / 3
      // a good coach at a big club costs a lot to prise away
      const ask = Math.round(
        (30_000 + Math.pow(Math.max(0, grade - 45), 2) * 220) * (0.6 + t.reputation / 110),
      )
      return { team: t, coach: c, ask }
    })
    .sort((a, b) =>
      (b.coach.tactics + b.coach.development + b.coach.motivation) -
      (a.coach.tactics + a.coach.development + a.coach.motivation))
}

/** Ask a club for permission to speak to their coach. */
export function approachForCoach(state: GameState, teamId: string, fee: number): string {
  const team = state.teams[teamId]
  if (!team?.coach) return '这支球队没有主教练。'
  if (state.staffApproaches?.some((a) => a.teamId === teamId && !a.answer)) {
    return `已经在等 ${team.name} 的答复了。`
  }
  if (state.finances.balance < fee) return '资金不足，无法支付这笔补偿。'

  const rng = new Rng(hashStr(`approach:${state.seed}:${state.day}:${teamId}`))
  state.staffApproaches = [...(state.staffApproaches ?? []), {
    id: `AP${state.day}_${teamId}`,
    teamId, name: team.coach.name, fee,
    day: state.day,
    replyOn: state.day + rng.int(2, 6),
  }]
  return `已向 ${team.name} 提出接触 ${team.coach.name} 的请求，等待答复。`
}

/** Clubs answering our approaches today. */
export function resolveApproaches(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  for (const a of state.staffApproaches ?? []) {
    if (a.answer || a.replyOn > state.day) continue
    const team = state.teams[a.teamId]
    if (!team?.coach || team.coach.name !== a.name) {
      a.answer = 'refused'
      a.reason = '这名教练已经不在那支球队了'
      continue
    }
    const asked = employedCoaches(state).find((x) => x.team.id === a.teamId)?.ask ?? a.fee
    const ratio = a.fee / Math.max(1, asked)
    // a club protects a coach it depends on, and a struggling one lets go easier
    let odds = 0.12 + (ratio - 1) * 0.7 + ((state.manager?.reputation ?? 50) - team.reputation) * 0.006
    if (state.boardConfidence > 70) odds += 0.05
    odds = clamp(odds, 0.02, 0.9)

    if (rng.chance(odds)) {
      a.answer = 'granted'
      notes.push(`✅ ${team.name} 同意你与 ${a.name} 接触，接下来要和本人谈合同。`)
    } else {
      a.answer = 'refused'
      a.reason = ratio < 0.85 ? '补偿金太低' : '不愿意放走现任主教练'
      notes.push(`❌ ${team.name} 拒绝了接触 ${a.name} 的请求：${a.reason}`)
    }
  }
  state.staffApproaches = (state.staffApproaches ?? [])
    .filter((a) => !a.answer || a.replyOn > state.day - 30)
  return notes
}

/** Coaches we have been cleared to negotiate with. */
export function clearedCoaches(state: GameState): StaffCandidate[] {
  const out: StaffCandidate[] = []
  for (const a of state.staffApproaches ?? []) {
    if (a.answer !== 'granted') continue
    const team = state.teams[a.teamId]
    const c = team?.coach
    if (!c || c.name !== a.name) continue
    const grade = (c.tactics + c.development + c.motivation) / 3
    out.push({
      name: c.name, from: team.name,
      tactics: c.tactics, development: c.development, motivation: c.motivation,
      salary: Math.round(40_000 + Math.pow(Math.max(0, grade - 40), 2) * 150),
    })
  }
  return out
}

export function offerToStaff(
  state: GameState, name: string, role: StaffRole, salary: number, years: number,
): string {
  const pick = role === 'analyst'
    ? analystMarket(state).find((c) => c.name === name)
    : (staffMarket(state).find((c) => c.name === name)
      ?? clearedCoaches(state).find((c) => c.name === name))
  if (!pick) return '这位人选已经不在市场上了。'
  if (state.staffOffers?.some((o) => o.name === name && !o.answer)) {
    return `已经在等 ${name} 的答复了。`
  }
  const wage = state.teams[state.myTeam] ? wageBill(state, state.myTeam) : 0
  if (salary > Math.max(0, state.finances.balance) + wage) return '这个薪资超出了俱乐部的承受范围。'

  const rng = new Rng(hashStr(`staffoffer:${state.seed}:${state.day}:${name}`))
  state.staffOffers = [...(state.staffOffers ?? []), {
    id: `SO${state.day}_${name}`,
    name, from: pick.from, role, salary, years,
    day: state.day,
    // they take a few days to think about it, like anyone would
    replyOn: state.day + rng.int(1, 7),
    tactics: pick.tactics, development: pick.development, motivation: pick.motivation,
  }]
  return `已向 ${name} 发出${ROLE_CN[role]}邀请，等待答复（最多 7 天）。`
}

/** The asking price for a given coach in a given role. */
export function askingSalary(c: StaffCandidate, role: StaffRole): number {
  return Math.round(c.salary * ROLE_PAY[role])
}

/** Coaches answering today. */
export function resolveStaffOffers(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  const team = state.teams[state.myTeam]
  if (!team) return notes

  for (const o of state.staffOffers ?? []) {
    if (o.answer || o.replyOn > state.day) continue
    const want = askingSalary(
      { name: o.name, from: o.from, tactics: o.tactics, development: o.development,
        motivation: o.motivation, salary: 0 },
      o.role,
    )
    // the asking price is rebuilt from their grade, since salary was role-scaled
    const grade = (o.tactics + o.development + o.motivation) / 3
    const base = Math.round((40_000 + Math.pow(Math.max(0, grade - 40), 2) * 120) * ROLE_PAY[o.role])
    const ask = want || base
    const ratio = o.salary / Math.max(1, ask)

    // money matters most, but a big club is worth taking a small cut for
    let score = (ratio - 1) * 100 + (team.reputation - 55) * 0.8 + (o.years >= 2 ? 6 : 0)
    score += ((state.manager?.reputation ?? 50) - 50) * 0.35
    const ok = score > rng.range(-12, 12)

    o.answer = ok ? 'accept' : 'reject'
    if (!ok) {
      o.reason = ratio < 0.9 ? '薪资达不到他的预期'
        : team.reputation < 55 ? '认为俱乐部平台不够'
          : '暂时不想离开现在的岗位'
      notes.push(`❌ ${o.name} 拒绝了${ROLE_CN[o.role]}邀请：${o.reason}`)
      continue
    }

    const signOn = Math.round(o.salary * 0.5)
    state.finances.balance -= signOn
    state.finances.log.push({ day: state.day, label: `签约 ${o.name}`, amount: -signOn })

    // if they were employed elsewhere, that club loses them and is paid
    const poachedFrom = Object.values(state.teams)
      .find((t) => t.id !== state.myTeam && t.coach?.name === o.name)
    if (poachedFrom) {
      const ap = state.staffApproaches?.find((x) => x.teamId === poachedFrom.id && x.answer === 'granted')
      const fee = ap?.fee ?? 0
      state.finances.balance -= fee
      state.finances.log.push({ day: state.day, label: `补偿 ${poachedFrom.name}`, amount: -fee })
      poachedFrom.coach = null
      notes.push(`💼 ${o.name} 离开 ${poachedFrom.name} 加盟，补偿金 ${Math.round(fee / 1000)}K。`)
    }

    if (o.role === 'head') {
      const old = team.coach
      const coach: Coach = {
        name: o.name, tactics: o.tactics, development: o.development,
        motivation: o.motivation, salary: o.salary,
      }
      team.coach = coach
      // the outgoing head coach does not evaporate — he stays on as an assistant
      // unless the manager lets him go, which is a separate decision
      if (old) {
        state.staff = [...(state.staff ?? []), {
          name: old.name, role: 'assistant',
          tactics: old.tactics, development: old.development, motivation: old.motivation,
          salary: old.salary ?? Math.round(o.salary * 0.4), years: 1,
        }]
        notes.push(`🔁 ${old.name} 卸任主教练，转为助理教练（可在教练组中解约）。`)
      }
    } else {
      state.staff = [...(state.staff ?? []), {
        name: o.name, role: o.role,
        spec: WORLD_ANALYSTS.find((a) => a.name === o.name)?.spec as AnalystSpec | undefined,
        tactics: o.tactics, development: o.development, motivation: o.motivation,
        salary: o.salary, years: o.years,
      }]
    }
    notes.push(`✅ ${o.name} 接受了邀请，出任${ROLE_CN[o.role]}。`)
  }
  state.staffOffers = (state.staffOffers ?? []).filter(
    (o) => !o.answer || o.replyOn > state.day - 5,
  )
  return notes
}

/** Let a staff member go. */
export function releaseStaff(state: GameState, name: string): string {
  const member = state.staff?.find((s) => s.name === name)
  if (!member) return '找不到这名成员。'
  const payoff = Math.round(member.salary * 0.35)
  state.finances.balance -= payoff
  state.finances.log.push({ day: state.day, label: `解约 ${name}`, amount: -payoff })
  state.staff = (state.staff ?? []).filter((s) => s.name !== name)
  return `${name} 已离队，支付违约金 ${Math.round(payoff / 1000)}K。`
}

/**
 * What the staff behind the head coach are worth.
 *
 * Assistants back up development, analysts back up tactics — so hiring depth is
 * a real alternative to chasing one expensive head coach.
 */
export function staffBonus(state: GameState, k: 'tactics' | 'development' | 'motivation'): number {
  let best = 0
  for (const m of state.staff ?? []) {
    const weight = m.role === 'analyst'
      ? (k === 'tactics' ? 0.5 : 0.15)
      : (k === 'development' ? 0.45 : 0.2)
    best += Math.max(0, m[k] - 55) * weight
  }
  return Math.min(14, best)
}


/** Is an analyst with this speciality on staff, and how good are they? */
export function analystEdge(state: GameState, spec: AnalystSpec): number {
  const m = (state.staff ?? []).find((x) => x.role === 'analyst' && x.spec === spec)
  return m ? Math.max(0, m.tactics - 45) / 45 : 0
}
