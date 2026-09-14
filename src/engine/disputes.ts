/**
 * A dressing-room argument as a thing the manager can deal with.
 *
 * applyMatchBonds has fired arguments since the bonds went in — one player
 * carried a lost match, the other was well off it, and they were already not
 * getting on — but all it left behind was a news line and a lower number in
 * the matrix. The argument is now a record: who, after which match, how bad,
 * and what was done about it. Nothing here is a second relationship system;
 * every choice lands on the bonds, trust, morale and grievance that already
 * exist, and the outcome of a talk is drawn from the save's own seed so a
 * reload cannot reroll it.
 *
 * Five ways to answer one, deliberately unequal:
 *   talk     私下谈话   1 行动点  pick one man; win him over or put his back up
 *   mediate  组织调解   1 行动点  both in the room; the big fix, and the one that can go wrong
 *   duo      安排双排   免费      this week's pair drill is theirs — needs a team drill running
 *   bench    暂时替补   免费      one of them sits a week and cools off; a real lineup change
 *   ignore   暂不介入   免费      it festers on its own terms (weeklyBonds)
 *
 * The parameters live in DISPUTE so the numbers can be read in one place.
 */
import type { GameState, Player } from './types'
import { Rng, clamp, hashStr } from './rng'
import { careerDayOf, isCoolingOff } from './clock'
import { bondBetween, duoBonded } from './bonds'
import { trustOf, trustShift } from './trust'
import { lifeMod } from './managerLife'

export type DisputeChoice = 'talk' | 'mediate' | 'duo' | 'bench' | 'ignore'
export type DisputeStatus = 'open' | 'handled' | 'ignored' | 'expired' | 'closed'

export interface DisputeAttempt {
  choice: DisputeChoice
  /** who it was aimed at, for talk and bench */
  target?: string
  careerDay: number
  ok: boolean
  text: string
}

export interface Dispute {
  id: string
  year: number
  day: number
  /** the one who carried, the one who did not */
  a: string
  b: string
  ratings: { a: number; b: number }
  /** the match it came out of — verifiable, not parsed from a headline */
  fixtureId?: string
  opponent?: string
  score?: string
  /** 1 a spat, 2 a proper row, 3 the room took sides */
  severity: 1 | 2 | 3
  /** the bond right after the argument */
  bondAt: number
  status: DisputeStatus
  attempts: DisputeAttempt[]
  /** later arguments between the same two while this one is open */
  flareUps: number
  /** when it stopped being open */
  closedOn?: number
}

export const DISPUTE = {
  /** days an untouched argument waits before the room draws its own conclusion */
  EXPIRE_DAYS: 14,
  /** days between paid attempts on the same argument */
  TALK_COOLDOWN: 7,
  /** paid attempts per argument */
  MAX_PAID: 2,
  /** the cooling-off bench, in days */
  BENCH_DAYS: 7,
  talk: { base: 0.5, locker: 0.006, trust: 0.004, min: 0.2, max: 0.9, bondWin: [6, 10], trustWin: 2.5, moraleWin: 3, bondLose: 1, trustLose: -2, moraleLose: -1 },
  mediate: { base: 0.35, locker: 0.008, bond: 1 / 250, min: 0.15, max: 0.85, bondWin: [14, 20], trustWin: 1.5, moraleWin: 3, grievanceWin: -3, bondLose: -3, moraleLose: -2 },
  bench: { trust: -3, morale: -4, grievance: 3, bondSpace: 3 },
  expire: { morale: -2, grievance: 2 },
} as const

export const DISPUTE_CHOICE_CN: Record<DisputeChoice, string> = {
  talk: '私下谈话', mediate: '组织调解', duo: '安排双排', bench: '暂时替补', ignore: '暂不介入',
}
export const costsAction = (c: DisputeChoice): boolean => c === 'talk' || c === 'mediate'

const openFor = (state: GameState, a: string, b: string): Dispute | undefined =>
  (state.disputes ?? []).find((d) => d.status === 'open' && ((d.a === a && d.b === b) || (d.a === b && d.b === a)))

/** called from applyMatchBonds the moment an argument fires */
export function openDispute(
  state: GameState,
  args: { a: string; b: string; ratings: { a: number; b: number }; gap: number; bondAfter: number; fixtureId?: string; opponent?: string; score?: string },
): Dispute {
  state.disputes ??= []
  const severity: 1 | 2 | 3 = args.gap >= 0.9 || args.bondAfter <= -40 ? 3 : args.gap >= 0.65 || args.bondAfter <= -15 ? 2 : 1
  const already = openFor(state, args.a, args.b)
  if (already) {
    // the same two again while the first is still on the desk: one record,
    // not a second line every match
    already.flareUps++
    already.severity = Math.max(already.severity, severity) as 1 | 2 | 3
    already.bondAt = args.bondAfter
    already.day = state.day
    already.year = state.year
    return already
  }
  const d: Dispute = {
    id: `dispute:${state.year}:${state.day}:${args.a}|${args.b}`,
    year: state.year, day: state.day, a: args.a, b: args.b, ratings: args.ratings,
    fixtureId: args.fixtureId, opponent: args.opponent, score: args.score,
    severity, bondAt: args.bondAfter, status: 'open', attempts: [], flareUps: 0,
  }
  state.disputes.push(d)
  if (state.disputes.length > 40) state.disputes.splice(0, state.disputes.length - 40)
  return d
}

export const openDisputes = (state: GameState): Dispute[] =>
  (state.disputes ?? []).filter((d) => d.status === 'open')

const lastPaid = (d: Dispute): DisputeAttempt | undefined => {
  const paid = d.attempts.filter((x) => costsAction(x.choice))
  return paid[paid.length - 1]
}

/** why this choice cannot be taken right now — null when it can */
export function disputeBlock(state: GameState, id: string, choice: DisputeChoice, target?: string): string | null {
  const d = (state.disputes ?? []).find((x) => x.id === id)
  if (!d) return '没有这条记录。'
  if (d.status !== 'open') return '这件事已经处理过了。'
  const a = state.players[d.a]
  const b = state.players[d.b]
  if (!a || !b || a.teamId !== state.myTeam || b.teamId !== state.myTeam) return '当事人已经不在队里。'
  if ((choice === 'talk' || choice === 'bench') && target !== d.a && target !== d.b) return '先选一个人。'
  if (costsAction(choice)) {
    const paid = d.attempts.filter((x) => costsAction(x.choice)).length
    if (paid >= DISPUTE.MAX_PAID) return `这件事已经谈过 ${DISPUTE.MAX_PAID} 次了，只能等它自己过去，或者换个办法。`
    const last = lastPaid(d)
    if (last && careerDayOf(state) - last.careerDay < DISPUTE.TALK_COOLDOWN) {
      return `刚谈过，${DISPUTE.TALK_COOLDOWN - (careerDayOf(state) - last.careerDay)} 天后再谈。`
    }
  }
  if (choice === 'bench' && target) {
    const t = state.players[target]
    if (t && isCoolingOff(state, t)) return '他已经在冷静期了。'
    const why = benchBlock(state, target)
    if (why) return why
  }
  return null
}

/** the roster can still field five without this man — or why not */
export function benchBlock(state: GameState, pid: string): string | null {
  const team = state.teams[state.myTeam]
  const fit = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p && p.id !== pid && p.injuredUntil <= state.day && !isCoolingOff(state, p))
  if (fit.length < 5) return `替补不够：拿掉他之后只剩 ${fit.length} 个能上的人，凑不齐五个。`
  return null
}

/**
 * Do the thing. Returns the line the manager reads; the record keeps it too.
 * The action point is the caller's to spend BEFORE this — disputeBlock says
 * whether it will be honoured, so nothing is charged for a refusal.
 */
export function handleDispute(state: GameState, id: string, choice: DisputeChoice, target?: string): { ok: boolean; text: string } {
  const why = disputeBlock(state, id, choice, target)
  if (why) return { ok: false, text: why }
  const d = state.disputes!.find((x) => x.id === id)!
  const a = state.players[d.a]
  const b = state.players[d.b]
  const cd = careerDayOf(state)
  const locker = state.manager?.skills.locker ?? 50
  const rng = new Rng(hashStr(`${d.id}:${choice}:${target ?? ''}:${d.attempts.length}:${state.seed}`))
  const note = (ok: boolean, text: string) => {
    d.attempts.push({ choice, target, careerDay: cd, ok, text })
    return { ok, text }
  }
  const close = (status: DisputeStatus) => { d.status = status; d.closedOn = cd }

  switch (choice) {
    case 'talk': {
      const t = state.players[target!]
      const other = t.id === a.id ? b : a
      const P = DISPUTE.talk
      const p = clamp(P.base + (locker - 50) * P.locker + (trustOf(t) - 62) * P.trust + (lifeMod(state) - 1), P.min, P.max)
      const ok = rng.chance(p)
      if (ok) {
        duoBonded(state, a.id, b.id, rng.range(P.bondWin[0], P.bondWin[1]))
        trustShift(t, P.trustWin)
        t.morale = clamp(t.morale + P.moraleWin, 0, 100)
        close('handled')
        return note(true, `${t.ign} 听进去了，答应把 ${other.ign} 的事放下。关系回暖，他对你更信任了。`)
      }
      duoBonded(state, a.id, b.id, P.bondLose)
      trustShift(t, P.trustLose)
      t.morale = clamp(t.morale + P.moraleLose, 0, 100)
      return note(false, `${t.ign} 觉得你在偏袒 ${other.ign}，谈崩了。他对你的信任掉了一点，事情还挂着。`)
    }
    case 'mediate': {
      const P = DISPUTE.mediate
      const bond = bondBetween(state, a.id, b.id)
      const p = clamp(P.base + (locker - 50) * P.locker + (bond + 50) * P.bond + (lifeMod(state) - 1), P.min, P.max)
      const ok = rng.chance(p)
      if (ok) {
        duoBonded(state, a.id, b.id, rng.range(P.bondWin[0], P.bondWin[1]))
        for (const x of [a, b]) {
          trustShift(x, P.trustWin)
          x.morale = clamp(x.morale + P.moraleWin, 0, 100)
          x.grievance = clamp((x.grievance ?? 0) + P.grievanceWin, 0, 100)
        }
        close('handled')
        return note(true, `把两个人叫到一起，话说开了。${a.ign} 和 ${b.ign} 握手，更衣室松了口气。`)
      }
      duoBonded(state, a.id, b.id, P.bondLose)
      for (const x of [a, b]) x.morale = clamp(x.morale + P.moraleLose, 0, 100)
      return note(false, `当面对质反而翻起了旧账，${a.ign} 和 ${b.ign} 更僵了。过几天再想办法。`)
    }
    case 'duo': {
      state.duo = { a: a.id, b: b.id }
      close('handled')
      const running = state.drillLock != null && state.drillLock > state.day
      return note(true, running
        ? `这周的双排练定为 ${a.ign} 和 ${b.ign}，团队训练结算时一起练，关系会拉近。`
        : `双排练定为 ${a.ign} 和 ${b.ign}。本周还没确定团队训练，去训练页确定后才会练。`)
    }
    case 'bench': {
      const t = state.players[target!]
      const other = t.id === a.id ? b : a
      const P = DISPUTE.bench
      t.coolOffUntil = cd + DISPUTE.BENCH_DAYS
      const team = state.teams[state.myTeam]
      team.starters = team.starters.filter((x) => x !== t.id)
      trustShift(t, P.trust)
      t.morale = clamp(t.morale + P.morale, 0, 100)
      t.grievance = clamp((t.grievance ?? 0) + P.grievance, 0, 100)
      duoBonded(state, a.id, b.id, P.bondSpace)
      close('handled')
      return note(true, `${t.ign} 这 ${DISPUTE.BENCH_DAYS} 天不上首发，先冷静。他不高兴，但和 ${other.ign} 之间有了点距离。到期后去阵容页把他排回来，或者提前恢复。`)
    }
    case 'ignore': {
      close('ignored')
      return note(true, `你决定不介入。关系会按自己的节奏回落，也可能继续发酵。`)
    }
  }
}

/** end the cooling-off early — the manager's call, no cost */
export function endCoolOff(state: GameState, pid: string): string {
  const p = state.players[pid]
  if (!p || !isCoolingOff(state, p)) return '他没有在冷静期。'
  p.coolOffUntil = undefined
  return `${p.ign} 的冷静期提前结束，可以排回首发了。`
}

/**
 * Every day: arguments nobody touched draw the room's own conclusion, the
 * ones whose parties have left are closed, and a cooling-off that has run
 * out is announced. Never more than one line per record.
 */
export function tickDisputes(state: GameState, notes: string[]): void {
  const cd = careerDayOf(state)
  for (const d of state.disputes ?? []) {
    if (d.status !== 'open' && d.status !== 'ignored') continue
    const a = state.players[d.a]
    const b = state.players[d.b]
    if (!a || !b || a.teamId !== state.myTeam || b.teamId !== state.myTeam) {
      d.status = 'closed'; d.closedOn = cd
      continue
    }
    const since = cd - (d.year * 364 + d.day)
    if (d.status === 'open' && since >= DISPUTE.EXPIRE_DAYS) {
      d.status = 'expired'; d.closedOn = cd
      for (const x of [a, b]) {
        x.morale = clamp(x.morale + DISPUTE.expire.morale, 0, 100)
        x.grievance = clamp((x.grievance ?? 0) + DISPUTE.expire.grievance, 0, 100)
      }
      notes.push(`💢 ${a.ign} 和 ${b.ign} 的矛盾放了两周没人管，更衣室都在看着。`)
    }
  }
  for (const pid of state.teams[state.myTeam]?.roster ?? []) {
    const p = state.players[pid]
    if (p?.coolOffUntil != null && p.coolOffUntil <= cd) {
      p.coolOffUntil = undefined
      notes.push(`🤝 ${p.ign} 的冷静期结束了，可以重新排进首发。`)
    }
  }
}
