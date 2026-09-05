/**
 * The draws: the events that decide groups, pairings and bracket paths.
 *
 * A draw is an event of its own, not an animation over a random result. It
 * is created when the field is known, its whole legal outcome is computed
 * then and there from a key of its own (save seed, year, competition,
 * phase) and written into the save, and the fixtures follow at once. What
 * the screen does afterwards is reveal what is already decided, ball by
 * ball — so a reload, a skip or a watched ceremony all show the same thing,
 * and opening packs or signing players in between changes nothing.
 *
 * One draw is a decision rather than a ceremony: after a Masters Swiss, the
 * four regional champions pick their quarter-final opponents in a drawn
 * order. That one waits for the human when it is his turn (advanceDay stops
 * on it), and an AI champion chooses by a small model of who it would rather
 * not meet.
 *
 * Every placement that has a rule — one side per region in a Champions
 * group, a second seed against a third from another region in the Swiss,
 * no rematch in round three, same-group sides in opposite halves of the
 * Champions quarters — is placed by a solver that only takes a step the
 * rest of the draw can still complete from. When the natural slot is
 * refused, the reason is written into the step, so the screen can say
 * 「这两队同属中国赛区，该签顺延到下一合法小组」 instead of a ball landing
 * in one place and jumping to another.
 */
import { Rng, hashStr } from './rng'
import type { Competition, GameState, Region } from './types'

export type DrawKind =
  | 'kickoff-bracket'
  | 'stage1-groups'
  | 'stage2-reshuffle'
  | 'masters-swiss'
  | 'masters-playoff-pick'
  | 'champions-groups'
  | 'champions-playoffs'

export const DRAW_KIND_CN: Record<DrawKind, string> = {
  'kickoff-bracket': 'Kickoff 签表抽签',
  'stage1-groups': 'Stage 1 分组抽签',
  'stage2-reshuffle': 'Stage 2 分组重抽',
  'masters-swiss': '瑞士轮抽签',
  'masters-playoff-pick': '八强选择对手',
  'champions-groups': '小组抽签',
  'champions-playoffs': '八强抽签',
}

export interface DrawPot {
  name: string
  teams: string[]
}

/** One ball out of the bowl. */
export interface DrawStep {
  team: string
  /** index into pots */
  pot: number
  /** where it landed — a group name, a bracket slot, an opponent */
  slot: string
  /** a placement the rules forced, in words */
  note?: string
  /** a decision rather than a ball: who chose */
  by?: string
}

export interface DrawOutcome {
  /** groups in slot order (Alpha/Omega, A–D) */
  groups?: string[][]
  /** pairings in slot order */
  pairs?: [string, string][]
  /** a bracket's seed list, in template order */
  seeds?: string[]
}

export interface DrawEvent {
  id: string
  competitionKey: string
  kind: DrawKind
  year: number
  day: number
  phase?: string
  status: 'ready' | 'revealing' | 'awaiting-choice' | 'complete'
  rulesetId: string
  rngKey: string
  /** a line of rules, for the screen's top */
  rule: string
  pots: DrawPot[]
  steps: DrawStep[]
  /** how many steps the screen has shown */
  revealed: number
  watched: boolean
  outcome: DrawOutcome
  /** masters-playoff-pick: the champions in the order they choose */
  pickOrder?: string[]
  /** masters-playoff-pick: the Swiss qualifiers still to be chosen */
  pickPool?: string[]
  /** the day the drawn ties are played — the fixtures are written for it when the draw is finished */
  playDay: number
  /** fixtures have been generated from the outcome */
  consumed?: boolean
  log: string[]
}

export const drawKey = (state: Pick<GameState, 'seed' | 'year'>, compKey: string, phase: string): string =>
  `draw:${state.seed}:${state.year}:${compKey}:${phase}`

const rngFor = (state: Pick<GameState, 'seed' | 'year'>, compKey: string, phase: string): Rng =>
  new Rng(hashStr(drawKey(state, compKey, phase)) >>> 0)

let drawSeq = 0
export const resetDrawSeq = (n: number): void => { drawSeq = n }

function newEvent(
  state: GameState, comp: Competition, kind: DrawKind, phase: string, rule: string, pots: DrawPot[], playDay: number,
): DrawEvent {
  const ev: DrawEvent = {
    id: `D${state.year}-${comp.key}-${phase}-${drawSeq++}`,
    competitionKey: comp.key, kind, year: state.year, day: state.day, phase,
    status: 'ready', rulesetId: state.rulesetId ?? 'vct-2026',
    rngKey: drawKey(state, comp.key, phase), rule, pots, steps: [], revealed: 0, watched: false,
    outcome: {}, log: [], playDay,
  }
  state.draws ??= []
  state.draws.push(ev)
  comp.drawIds = [...(comp.drawIds ?? []), ev.id]
  return ev
}

export const drawById = (state: GameState, id: string | undefined | null): DrawEvent | undefined =>
  id ? (state.draws ?? []).find((d) => d.id === id) : undefined

export const drawsOf = (state: GameState, compKey: string): DrawEvent[] =>
  (state.draws ?? []).filter((d) => d.competitionKey === compKey)

/**
 * Is this draw the manager's to hold? His own region's, and any
 * international his club is in. The other regions' draws are held in the
 * background and reported in the news; a Masters he did not reach keeps
 * its full record but never stops his clock.
 */
export function needsManager(state: GameState, ev: DrawEvent): boolean {
  const comp = state.comps[ev.competitionKey]
  if (!comp) return false
  if (comp.region) return comp.region === state.teams[state.myTeam]?.region
  return comp.teams.includes(state.myTeam)
}

/** The next draw waiting for the manager, oldest first. */
export const nextPendingDraw = (state: GameState): string | undefined =>
  (state.draws ?? []).find((d) => !d.consumed && d.year === state.year && needsManager(state, d))?.id

/**
 * Draws the manager has not watched, oldest first: the internationals, and
 * the regional draws of his own region — the other three regions' draws are
 * held in the background and reported in the news, so a season does not
 * ask you to sit through four Stage 1 draws.
 */
export const unwatchedDraws = (state: GameState): DrawEvent[] => {
  const myRegion = state.teams[state.myTeam]?.region
  return (state.draws ?? []).filter((d) => {
    if (d.watched || d.status === 'awaiting-choice' || d.year !== state.year) return false
    const comp = state.comps[d.competitionKey]
    return !comp?.region || comp.region === myRegion
  })
}

const regionOf = (state: GameState, id: string): Region | undefined => state.teams[id]?.region

// ---------------------------------------------------------------- the solver

/**
 * Is there a way to place every remaining item into a free slot so that
 * every placement passes `ok`? Backtracking over a handful of teams — the
 * biggest draw here is sixteen — is instant.
 */
function completable(
  items: string[], slots: string[], taken: Map<string, string>,
  ok: (item: string, slot: string, taken: Map<string, string>) => boolean,
): boolean {
  if (!items.length) return true
  const [item, ...rest] = items
  for (const slot of slots) {
    if (taken.has(slot) || !ok(item, slot, taken)) continue
    taken.set(slot, item)
    const fine = completable(rest, slots, taken, ok)
    taken.delete(slot)
    if (fine) return true
  }
  return false
}

// ---------------------------------------------------------------- the draws

/**
 * Kickoff: eight sides drawn into the four opening ties in the order they
 * come out, then the four byes drawn into the second-round slots.
 * Outcome seeds: the eight in slot order, then the four byes.
 */
export function drawKickoffBracket(state: GameState, comp: Competition, byes: string[], first: string[], playDay: number): DrawEvent {
  const rng = rngFor(state, comp.key, 'bracket')
  const ev = newEvent(state, comp, 'kickoff-bracket', 'bracket',
    '上一年 Champions 的四支队伍轮空到胜者组第二轮，其余八支随机抽入胜者组第一轮的四场对阵。',
    [{ name: '首轮参赛池', teams: first.slice() }, { name: 'Champions 轮空池', teams: byes.slice() }], playDay)
  const firstOrder = rng.shuffle(first.slice())
  const byeOrder = rng.shuffle(byes.slice())
  firstOrder.forEach((t, i) => ev.steps.push({ team: t, pot: 0, slot: `胜者组第一轮 第${Math.floor(i / 2) + 1}场${i % 2 === 0 ? '上' : '下'}` }))
  byeOrder.forEach((t, i) => ev.steps.push({ team: t, pot: 1, slot: `胜者组第二轮 第${i + 1}场（轮空位）` }))
  ev.outcome = { seeds: [...firstOrder, ...byeOrder] }
  ev.log.push(`首轮八队：${firstOrder.map((t) => state.teams[t]?.tag).join('、')}`)
  ev.log.push(`轮空四队：${byeOrder.map((t) => state.teams[t]?.tag).join('、')}`)
  return ev
}

/**
 * Stage 1: six pots of two by Kickoff placing. From each pot the first ball
 * goes to Alpha and the other to Omega.
 */
export function drawStageGroups(state: GameState, comp: Competition, pots: string[][], playDay: number): DrawEvent {
  const rng = rngFor(state, comp.key, 'groups')
  const ev = newEvent(state, comp, 'stage1-groups', 'groups',
    '按 Kickoff 名次分成六档，每档两队：先抽出的进 Alpha 组，另一队进 Omega 组。每组各有一至六档各一队。',
    pots.map((p, i) => ({ name: `第${'一二三四五六'[i] ?? i + 1}档（Kickoff 第 ${i * 2 + 1}、${i * 2 + 2} 名）`, teams: p.slice() })), playDay)
  const alpha: string[] = []
  const omega: string[] = []
  pots.forEach((pot, i) => {
    const [a, b] = rng.shuffle(pot.slice())
    alpha.push(a); omega.push(b)
    ev.steps.push({ team: a, pot: i, slot: 'Alpha' })
    ev.steps.push({ team: b, pot: i, slot: 'Omega', note: '同档另一队自动进入 Omega' })
  })
  ev.outcome = { groups: [alpha, omega] }
  ev.log.push(`Alpha：${alpha.map((t) => state.teams[t]?.tag).join('、')}`)
  ev.log.push(`Omega：${omega.map((t) => state.teams[t]?.tag).join('、')}`)
  return ev
}

/**
 * Stage 2: three pools — the 1st/2nd placings, the 3rd/4th, the 5th/6th of
 * the Stage 1 groups. From each pool one placing is drawn, and the two
 * sides that finished there swap groups; the other placing stays.
 * `alpha` and `omega` are the Stage 1 groups in finishing order.
 */
export function drawStageReshuffle(state: GameState, comp: Competition, alpha: string[], omega: string[], playDay: number): DrawEvent {
  const rng = rngFor(state, comp.key, 'reshuffle')
  const pools: [number, number][] = [[0, 1], [2, 3], [4, 5]]
  const ev = newEvent(state, comp, 'stage2-reshuffle', 'reshuffle',
    '按 Stage 1 两组名次分成三个交换池（第 1/2 名、第 3/4 名、第 5/6 名），每池抽出一个名次：该名次的两队互换小组，另一名次留在原组。',
    pools.map(([x, y]) => ({ name: `第 ${x + 1}/${y + 1} 名池`, teams: [alpha[x], omega[x], alpha[y], omega[y]].filter(Boolean) })), playDay)
  const nextAlpha = alpha.slice()
  const nextOmega = omega.slice()
  pools.forEach(([x, y], i) => {
    const swap = rng.pick([x, y])
    const a = alpha[swap], o = omega[swap]
    if (!a || !o) return
    nextAlpha[swap] = o; nextOmega[swap] = a
    ev.steps.push({ team: a, pot: i, slot: 'Omega', note: `抽到第 ${swap + 1} 名：两组第 ${swap + 1} 名互换` })
    ev.steps.push({ team: o, pot: i, slot: 'Alpha' })
    const stay = swap === x ? y : x
    ev.log.push(`第 ${x + 1}/${y + 1} 名池抽到第 ${swap + 1} 名：${state.teams[a]?.tag} ⇄ ${state.teams[o]?.tag}；第 ${stay + 1} 名留在原组`)
  })
  ev.outcome = { groups: [nextAlpha, nextOmega] }
  return ev
}

/**
 * A Masters Swiss round.
 *  round 1: a second seed against a third seed from another region — the
 *           second seeds come out one at a time, and the third seed drawn
 *           for each is one the rest of the round can still be completed
 *           after;
 *  round 2: the 1-0 sides among themselves, the 0-1 sides among themselves;
 *  round 3: the 1-1 sides, no rematch.
 */
export function drawSwissRound(
  state: GameState, comp: Competition, round: number,
  pools: { name: string; teams: string[] }[], played: Set<string>, playDay: number,
): DrawEvent {
  const rng = rngFor(state, comp.key, `swiss-r${round}`)
  const rule = round === 1
    ? '首轮二号种子对三号种子，且不与同赛区队伍相遇。'
    : round === 2 ? '第二轮按战绩分池：1-0 对 1-0，0-1 对 0-1。' : '第三轮 1-1 队伍互相配对，不与此前交手过的队伍重赛。'
  const ev = newEvent(state, comp, 'masters-swiss', `swiss-r${round}`, rule, pools.map((p) => ({ name: p.name, teams: p.teams.slice() })), playDay)
  const pairs: [string, string][] = []
  if (round === 1) {
    const seconds = rng.shuffle(pools[0].teams.slice())
    const thirds = pools[1].teams.slice()
    const okPair = (a: string, b: string) => regionOf(state, a) !== regionOf(state, b)
    const taken = new Map<string, string>()   // third -> second
    const canFinish = (restSeconds: string[], freeThirds: string[]): boolean =>
      completable(restSeconds, freeThirds, taken, (s, t) => okPair(s, t))
    for (let i = 0; i < seconds.length; i++) {
      const s = seconds[i]
      ev.steps.push({ team: s, pot: 0, slot: `第 ${i + 1} 场 · 二号种子` })
      const free = thirds.filter((t) => !taken.has(t))
      const legal = rng.shuffle(free.filter((t) => okPair(s, t)))
      let chosen: string | undefined
      let skipped: string[] = []
      for (const t of legal) {
        taken.set(t, s)
        const fine = canFinish(seconds.slice(i + 1), thirds.filter((x) => !taken.has(x)))
        taken.delete(t)
        if (fine) { chosen = t; break }
        skipped.push(t)
      }
      if (!chosen) { chosen = free[0]; skipped = [] }
      taken.set(chosen, s)
      const sameRegion = free.filter((t) => !okPair(s, t))
      const note = skipped.length
        ? `${skipped.map((t) => state.teams[t]?.tag).join('、')} 若在此落位会让剩余队伍无法避开同赛区，顺延`
        : sameRegion.length ? `${sameRegion.map((t) => state.teams[t]?.tag).join('、')} 同赛区，不在候选之列` : undefined
      ev.steps.push({ team: chosen, pot: 1, slot: `第 ${i + 1} 场 · 三号种子`, note })
      pairs.push([s, chosen])
    }
  } else {
    pools.forEach((pool, pi) => {
      const order = rng.shuffle(pool.teams.slice())
      if (round === 2) {
        for (let i = 0; i + 1 < order.length; i += 2) {
          ev.steps.push({ team: order[i], pot: pi, slot: `${pool.name} 第 ${pairs.length + 1} 场 上` })
          ev.steps.push({ team: order[i + 1], pot: pi, slot: `${pool.name} 第 ${pairs.length + 1} 场 下` })
          pairs.push([order[i], order[i + 1]])
        }
      } else {
        // no rematch: pair the first ball with a legal opponent the rest can
        // still be paired after
        const rest = order.slice()
        const key = (a: string, b: string) => `${a}|${b}`
        const canPairAll = (xs: string[]): boolean => {
          if (!xs.length) return true
          const [a, ...more] = xs
          for (let j = 0; j < more.length; j++) {
            if (played.has(key(a, more[j]))) continue
            if (canPairAll([...more.slice(0, j), ...more.slice(j + 1)])) return true
          }
          return false
        }
        while (rest.length >= 2) {
          const a = rest.shift()!
          ev.steps.push({ team: a, pot: pi, slot: `第 ${pairs.length + 1} 场 上` })
          let b: string | undefined
          const skipped: string[] = []
          for (const cand of rest) {
            if (played.has(key(a, cand))) { skipped.push(cand); continue }
            const others = rest.filter((x) => x !== cand)
            if (canPairAll(others)) { b = cand; break }
            skipped.push(cand)
          }
          if (!b) b = rest[0]
          rest.splice(rest.indexOf(b), 1)
          ev.steps.push({ team: b, pot: pi, slot: `第 ${pairs.length + 1} 场 下`,
            note: skipped.length ? `${skipped.map((t) => state.teams[t]?.tag).join('、')} 已交手或会让剩余队伍无法配对，顺延` : undefined })
          pairs.push([a, b])
        }
      }
    })
  }
  ev.outcome = { pairs }
  ev.log.push(...pairs.map(([a, b], i) => `第 ${i + 1} 场：${state.teams[a]?.tag} vs ${state.teams[b]?.tag}`))
  return ev
}

/**
 * Champions: pot 1 (the Stage 2 winners) into A–D in the order drawn; then
 * pots 2, 3, 4 — each ball into the first group, A to D, that has nobody
 * from its region and that the rest of the pot can still be placed after.
 * Outcome groups are ordered by pot, so a GSL group's 1v4 / 2v3 falls out.
 */
export function drawChampionsGroups(state: GameState, comp: Competition, pots: string[][], playDay: number): DrawEvent {
  const rng = rngFor(state, comp.key, 'groups')
  const names = ['A', 'B', 'C', 'D']
  const ev = newEvent(state, comp, 'champions-groups', 'groups',
    '四档各四队，每组从每档各得一队，且每组必须来自四个不同赛区。签球依次落入 A 到 D 组中第一个合法的小组。',
    pots.map((p, i) => ({ name: `第${'一二三四'[i]}档`, teams: p.slice() })), playDay)
  const groups: string[][] = [[], [], [], []]
  pots.forEach((pot, pi) => {
    const order = rng.shuffle(pot.slice())
    const taken = new Map<string, string>()   // team -> group name (this pot)
    const okSlot = (team: string, g: string, tk: Map<string, string>): boolean => {
      const gi = names.indexOf(g)
      if (groups[gi].some((t) => regionOf(state, t) === regionOf(state, team))) return false
      for (const [t, gg] of tk) if (gg === g && t !== team) return false
      return true
    }
    order.forEach((team, i) => {
      const free = names.filter((g) => ![...taken.values()].includes(g))
      let chosen: string | undefined
      const reasons: string[] = []
      for (const g of free) {
        if (!okSlot(team, g, taken)) { reasons.push(`${g} 组已有${state.teams[team]?.region ? '同赛区' : ''}队伍`); continue }
        taken.set(team, g)
        const fine = completable(order.slice(i + 1), free.filter((x) => x !== g), taken, (t, gg, tk) => okSlot(t, gg, tk))
        taken.delete(team)
        if (fine) { chosen = g; break }
        reasons.push(`落入 ${g} 组会让本档余下队伍无处可去`)
      }
      if (!chosen) chosen = free[0]
      taken.set(team, chosen)
      groups[names.indexOf(chosen)].push(team)
      ev.steps.push({ team, pot: pi, slot: `${chosen} 组`, note: reasons.length ? `${reasons.join('；')}，顺延至 ${chosen} 组` : undefined })
    })
  })
  ev.outcome = { groups }
  ev.log.push(...groups.map((g, i) => `${names[i]} 组：${g.map((t) => state.teams[t]?.tag).join('、')}`))
  return ev
}

/**
 * Champions quarter-finals: each group winner draws a runner-up from
 * another group; a group's two sides land in different halves (ties 1 and 2
 * are one half, 3 and 4 the other). Outcome pairs in tie order.
 */
export function drawChampionsPlayoffs(
  state: GameState, comp: Competition, firsts: string[], seconds: string[], groupOf: (t: string) => number, playDay: number,
): DrawEvent {
  const rng = rngFor(state, comp.key, 'playoffs')
  const ev = newEvent(state, comp, 'champions-playoffs', 'playoffs',
    '每个小组第一抽一支不同组的小组第二；同组出线的两队分在不同半区，胜者组决赛之前不会重赛。',
    [{ name: '小组第一池', teams: firsts.slice() }, { name: '小组第二池', teams: seconds.slice() }], playDay)
  const half = (tie: number) => (tie < 2 ? 0 : 1)
  const winnersOrder = rng.shuffle(firsts.slice())
  // tie i: winnersOrder[i] v pick; a runner-up may not share a group with
  // its winner, nor sit in the same half as its own group's winner
  const assigned: [string, string][] = []
  const legal = (tie: number, w: string, r: string, done: [string, string][]): boolean => {
    if (groupOf(w) === groupOf(r)) return false
    // r's group winner: where is he? (winnersOrder index = his tie)
    const wTie = winnersOrder.findIndex((x) => groupOf(x) === groupOf(r))
    if (wTie >= 0 && half(wTie) === half(tie)) return false
    // w's group runner-up: if already placed, must be in the other half
    const rOfW = done.find(([, rr]) => groupOf(rr) === groupOf(w))
    if (rOfW && half(done.indexOf(rOfW)) === half(tie)) return false
    return true
  }
  const finish = (tie: number, free: string[], done: [string, string][]): boolean => {
    if (tie >= winnersOrder.length) return true
    for (const r of free) {
      if (!legal(tie, winnersOrder[tie], r, done)) continue
      if (finish(tie + 1, free.filter((x) => x !== r), [...done, [winnersOrder[tie], r]])) return true
    }
    return false
  }
  let free = seconds.slice()
  winnersOrder.forEach((w, tie) => {
    ev.steps.push({ team: w, pot: 0, slot: `第 ${tie + 1} 场 · 小组第一` })
    const cands = rng.shuffle(free.slice())
    let chosen: string | undefined
    const skipped: string[] = []
    for (const r of cands) {
      if (!legal(tie, w, r, assigned)) { skipped.push(r); continue }
      if (finish(tie + 1, free.filter((x) => x !== r), [...assigned, [w, r]])) { chosen = r; break }
      skipped.push(r)
    }
    if (!chosen) chosen = cands[0]
    free = free.filter((x) => x !== chosen)
    assigned.push([w, chosen])
    ev.steps.push({ team: chosen, pot: 1, slot: `第 ${tie + 1} 场 · 小组第二`,
      note: skipped.length ? `${skipped.map((t) => state.teams[t]?.tag).join('、')} 同组或会与同组队伍同处一个半区，顺延` : undefined })
  })
  ev.outcome = { pairs: assigned }
  ev.log.push(...assigned.map(([a, b], i) => `八强第 ${i + 1} 场：${state.teams[a]?.tag} vs ${state.teams[b]?.tag}`))
  return ev
}

// ---------------------------------------------------------------- the pick

/**
 * The Masters quarter-final pick: the four champions' order is drawn, then
 * each picks a Swiss qualifier still unclaimed; the last takes what is
 * left. Created with the order drawn and nothing chosen; resolvePicks
 * plays it out, stopping when it is the human's turn.
 */
export function createPlayoffPick(state: GameState, comp: Competition, champions: string[], qualifiers: string[], playDay: number): DrawEvent {
  const rng = rngFor(state, comp.key, 'pick')
  const ev = newEvent(state, comp, 'masters-playoff-pick', 'pick',
    '四个赛区冠军抽出选择顺序，依次从瑞士轮晋级的四队里挑选八强对手；最后一位拿剩下的一队。',
    [{ name: '赛区冠军', teams: champions.slice() }, { name: '瑞士轮晋级队', teams: qualifiers.slice() }], playDay)
  ev.pickOrder = rng.shuffle(champions.slice())
  ev.pickPool = qualifiers.slice()
  ev.pickOrder.forEach((c, i) => ev.steps.push({ team: c, pot: 0, slot: `第 ${i + 1} 顺位选择` }))
  // the order is announced the moment it is drawn; there is nothing to
  // reveal ball by ball, and each pick shows as it is made
  ev.revealed = ev.steps.length
  ev.outcome = { pairs: [] }
  ev.log.push(`选择顺序：${ev.pickOrder.map((t) => state.teams[t]?.tag).join(' → ')}`)
  return ev
}

/** Whose turn it is to pick, or null when the pick is over. */
export const pickerNow = (ev: DrawEvent): string | null => {
  const done = ev.outcome.pairs?.length ?? 0
  return ev.pickOrder?.[done] ?? null
}

/**
 * How much a champion would rather avoid a qualifier: strength, the Swiss
 * run, form, and a little of the club's own nerve, so two champions do not
 * always agree on who the easy one is.
 */
export function pickScore(state: GameState, champion: string, cand: string, comp: Competition): number {
  const t = state.teams[cand]
  if (!t) return 0
  const rec = comp.standings[cand]
  const swiss = rec ? (rec.mapW - rec.mapL) * 0.8 + rec.w * 2 : 0
  const form = (state.teams[cand]?.rating ?? 80) - 80
  const nerve = ((hashStr(`nerve:${state.seed}:${champion}`) % 7) - 3) * 0.6
  const met = state.fixtures.some((f) => f.played && f.comp === comp.key
    && ((f.teamA === champion && f.teamB === cand) || (f.teamB === champion && f.teamA === cand)))
  return t.rating + swiss + form * 0.3 + nerve + (met ? 1.5 : 0)
}

export function pickReason(state: GameState, champion: string, cand: string, comp: Competition): string {
  const rec = comp.standings[cand]
  const met = state.fixtures.some((f) => f.played && f.comp === comp.key
    && ((f.teamA === champion && f.teamB === cand) || (f.teamB === champion && f.teamA === cand)))
  if (met) return `${state.teams[cand]?.tag} 是交过手的对手，心里有底`
  const tag = state.teams[cand]?.tag
  if (rec && rec.l >= 1) return `${tag} 在瑞士轮输过一场，看起来最好啃`
  if ((state.teams[cand]?.rating ?? 0) < 84) return `${tag} 纸面实力是四队里最弱的`
  return `教练组权衡后选了 ${tag}`
}

/**
 * Play the pick out: AI champions choose at once; when it is the human's
 * turn and `auto` is not set, stop and hand the decision to the screen.
 * Returns true when every pair is made.
 */
export function resolvePicks(state: GameState, ev: DrawEvent, comp: Competition, auto = false): boolean {
  while (true) {
    const who = pickerNow(ev)
    if (!who) { ev.status = 'complete'; state.pendingDrawId = undefined; return true }
    const pool = ev.pickPool ?? []
    if (!pool.length) { ev.status = 'complete'; state.pendingDrawId = undefined; return true }
    if (pool.length === 1) {
      choosePick(state, ev, comp, who, pool[0], '最后剩下的一队')
      continue
    }
    if (who === state.myTeam && !auto) {
      ev.status = 'awaiting-choice'
      state.pendingDrawId = ev.id
      return false
    }
    const best = pool.slice().sort((a, b) => pickScore(state, who, a, comp) - pickScore(state, who, b, comp))[0]
    choosePick(state, ev, comp, who, best, who === state.myTeam ? '交给了教练组' : pickReason(state, who, best, comp))
  }
}

/** One pick, written down. */
export function choosePick(state: GameState, ev: DrawEvent, comp: Competition, who: string, cand: string, why: string): string {
  const pool = ev.pickPool ?? []
  if (pickerNow(ev) !== who) return '还没轮到这支队选。'
  if (!pool.includes(cand)) return '这支队已经被别人选走了。'
  ev.pickPool = pool.filter((x) => x !== cand)
  ev.outcome.pairs = [...(ev.outcome.pairs ?? []), [who, cand]]
  ev.steps.push({ team: cand, pot: 1, slot: `${state.teams[who]?.tag} 的八强对手`, by: who, note: why })
  ev.log.push(`${state.teams[who]?.tag} 选择了 ${state.teams[cand]?.tag}（${why}）`)
  state.news.push({
    day: state.day, kind: 'league', important: who === state.myTeam || cand === state.myTeam,
    text: `${comp.name} 八强抽签：${state.teams[who]?.name} 选择 ${state.teams[cand]?.name} 作为对手——${why}。`,
  })
  ev.revealed = ev.steps.length
  if (!pickerNow(ev)) { ev.status = 'complete'; state.pendingDrawId = undefined }
  return `${state.teams[who]?.tag} 选择了 ${state.teams[cand]?.tag}。`
}

// ---------------------------------------------------------------- watching

export function revealNext(ev: DrawEvent): void {
  if (ev.revealed < ev.steps.length) ev.revealed++
  ev.status = ev.revealed >= ev.steps.length && ev.status !== 'awaiting-choice' ? 'complete' : ev.status === 'ready' ? 'revealing' : ev.status
  if (ev.revealed >= ev.steps.length && ev.status === 'complete') ev.watched = true
}

export function revealAll(ev: DrawEvent): void {
  ev.revealed = ev.steps.length
  if (ev.status !== 'awaiting-choice') { ev.status = 'complete'; ev.watched = true }
}

/** Skip the ceremony: result stands, the draw is marked seen. */
export const markWatched = (ev: DrawEvent): void => { revealAll(ev) }

/**
 * The checks every draw passes before its result is used: everyone once,
 * nobody twice, every slot filled. Returns the problems, empty when sound.
 */
export function validateDraw(ev: DrawEvent, expectTeams: string[]): string[] {
  const out: string[] = []
  const placed: string[] = ev.outcome.groups ? ev.outcome.groups.flat()
    : ev.outcome.pairs ? ev.outcome.pairs.flat() : ev.outcome.seeds ?? []
  const seen = new Set<string>()
  for (const t of placed) { if (seen.has(t)) out.push(`${t} 出现了两次`); seen.add(t) }
  for (const t of expectTeams) if (!seen.has(t)) out.push(`${t} 没有落位`)
  for (const t of placed) if (!expectTeams.includes(t)) out.push(`${t} 不在参赛名单里`)
  return out
}
