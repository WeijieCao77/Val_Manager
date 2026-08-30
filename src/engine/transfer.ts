import { Rng, clamp, hashStr } from './rng'
import { expectedSalary, marketValue, refreshValue } from './player'
import { autoStarters, ensureCaller, squadOf, wageBill } from './world'
import { SQUAD_ROLE_CN, defaultContract } from './types'
import { importBlock } from './imports'
import { skillMod } from './manager'
import { trustOf, trustOnDeparture, TRUST_START } from './trust'
import type { Contract, GameState, Player, SquadRole, Team, TransferOffer } from './types'

/**
 * The active-roster ceiling, matching how real circuits register players.
 *
 * Without it the meta was to hoard: buy eight, nine, ten players and farm 商务
 * with a bench that never scrims. Acquisitions stop at seven; a squad already
 * over keeps its players — the rule gates signings, it does not force sales.
 */
export const ROSTER_MAX = 7

export function rosterBlock(state: GameState, teamId: string): string | null {
  const team = state.teams[teamId]
  if (!team || team.roster.length < ROSTER_MAX) return null
  return teamId === state.myTeam
    ? `正式名单已满（${ROSTER_MAX}/${ROSTER_MAX}）——现实的参赛名单也有人数上限，先放走一人再签。`
    : `${team.name} 的名单已满。`
}

export const TRANSFER_WINDOWS: [number, number][] = [
  [0, 20],    // 季前
  [63, 88],   // Masters I 期间的短窗口 — the group asked for a mid-spring market
  [169, 194], // Masters II 期间的短窗口
  [311, 335], // 休赛期
]

/** The last day of the window that is open on this day, or null. */
export const windowEnd = (day: number): number | null =>
  TRANSFER_WINDOWS.find(([a, b]) => day >= a && day <= b)?.[1] ?? null

export const windowOpen = (day: number): boolean =>
  // the guided trial day sits before the calendar starts; it is a sandbox that
  // gets rolled back, so the window is open there rather than locking the page
  // the tutorial is about to teach
  day < 0 || TRANSFER_WINDOWS.some(([a, b]) => day >= a && day <= b)

/**
 * Why a new approach cannot be made right now, or null when it can.
 *
 * A shut window stops you *starting* something: no enquiry, no bid. It does
 * not freeze what is already in motion — a club still comes back with its
 * answer, a bid already on the table still completes, and a rival's bid for
 * one of our players still needs answering. The buttons render this, but the
 * rule belongs in the engine: a disabled button is a drawing of a rule, not
 * the rule itself.
 */
export const windowBlock = (state: GameState): string | null =>
  windowOpen(state.day)
    ? null
    : '转会窗口已关闭，现在不能提出新的报价或问价——只能答复已经在谈的事。'

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

const ROLE_ORDER: SquadRole[] = ['bench', 'rotation', 'starter', 'star']

/** What standing this player would expect at this club, given the squad. */
export function deservedRole(state: GameState, p: Player, team: Team): SquadRole {
  const squad = squadOf(state, team.id).filter((x) => x.id !== p.id)
  const better = squad.filter((x) => x.overall > p.overall).length
  return better === 0 ? 'star' : better < 5 ? 'starter' : better < 7 ? 'rotation' : 'bench'
}

/**
 * How a promised standing lands with the player.
 *
 * The key asymmetry: 首发 already means full playing time, so it is never an
 * insult — a star offered 首发 rather than 核心 is mildly underwhelmed, not
 * offended. Only 轮换 and 替补 promise *less* than a starting place, and those
 * are what a player good enough to start will actually refuse over.
 */
export function roleFit(state: GameState, p: Player, team: Team, promised: SquadRole): number {
  const deserved = deservedRole(state, p, team)
  const gap = ROLE_ORDER.indexOf(promised) - ROLE_ORDER.indexOf(deserved)
  if (gap >= 0) return gap                       // at or above expectations
  // below expectations, but only benching actually stings
  if (promised === 'starter') return gap * 0.5   // wants to be THE star, but will not walk over it alone
  return gap                                     // 轮换 / 替补 — the real snub
}

export interface OfferScore {
  /** raw appeal; 0 is a coin flip */
  score: number
  /** probability the player says yes */
  chance: number
  /** the single term hurting the offer most, if any */
  worst?: { key: string; why: string }
  /** true when the wage is so low the offer is not worth making */
  insulting: boolean
}

/**
 * Score an offer without rolling for it.
 *
 * Kept separate from the accept/reject roll so the UI can show an honest
 * read-out before the manager commits — an offer costs 7-10 days of waiting,
 * and blind-guessing terms for that price is not a decision, it is a lottery.
 */
export function scoreOffer(
  state: GameState, p: Player, toTeam: Team, terms: Contract,
): OfferScore {
  const want = expectedSalary(p, toTeam.tier)
  const { salary, years, signingBonus, bonusShare, promisedRole, releaseClause, noPoach } = terms
  if (salary < want * 0.7) {
    return {
      score: -99, chance: 0, insulting: true,
      worst: { key: 'salary', why: `薪资远低于他的期望（约 ${moneyish(want)}/年）` },
    }
  }

  const from = p.teamId ? state.teams[p.teamId] : null
  const fit = roleFit(state, p, toTeam, promisedRole)
  // Re-signing where he already is, rather than being prised away from it.
  // Three of the terms below were written for the second case and were being
  // applied unchanged to the first — most visibly loyalty, which turned "he
  // loves this club" into a reason to refuse the club's own renewal.
  const renewal = !!from && from.id === toTeam.id

  // every term's contribution is kept so the refusal can name the real blocker
  // rather than blaming whatever happens to be checked first
  const parts: { key: string; v: number; why: string }[] = [
    { key: 'salary', v: (salary / want - 1) * 60, why: `薪资低于他的期望（约 ${moneyish(want)}/年）` },
    { key: 'bonus', v: (signingBonus / Math.max(1, want)) * 26, why: '签字费缺乏吸引力' },
    { key: 'share', v: (bonusShare - 10) * 0.9, why: '奖金分成偏低' },
    {
      key: 'role',
      v: fit >= 0 ? fit * 11 : fit * 16,
      // a starting place is never refused; falling short of 核心 is only a wish
      why: promisedRole === 'starter'
        ? '他希望被当作球队核心'
        : `不接受「${SQUAD_ROLE_CN[promisedRole]}」这种替补定位`,
    },
    { key: 'rep', v: (toTeam.reputation - (from?.reputation ?? 30)) * 0.9, why: '认为这支球队不如他现在的平台' },
    { key: 'tier', v: from ? (toTeam.tier < from.tier ? 18 : toTeam.tier > from.tier ? -22 : 0) : 0, why: '不愿意降级去次级联赛' },
    {
      key: 'loyal',
      // attachment keeps him here; it is only an obstacle to leaving
      v: from ? (p.loyalty - 50) * 0.35 * (renewal ? 1 : -1) : 0,
      // and the sentence has to follow the direction: the same number is
      // "he loves it here" to a rival and "he never settled here" to us
      why: renewal ? '对这支球队没有太深的归属感' : '对现在的俱乐部感情很深',
    },
    { key: 'lock', v: noPoach ? -13 : 0, why: '不愿接受转会限制条款' },
  ]
  let score = parts.reduce((s, x) => s + x.v, 0)
  // Ambition reads a move as a step up or a step down. Staying put is neither,
  // so a renewal was being scored as though it were a demotion.
  if (!renewal) {
    score += (p.ambition - 55) * 0.25 * (toTeam.reputation > (from?.reputation ?? 0) ? 1 : -1)
  }
  // Not being in the five makes a player easier to sign away — and harder to
  // keep, which is the same fact pointing the other way.
  if (from && !from.starters.includes(p.id)) score += renewal ? -10 : 14
  if (years >= 3) score += p.age >= 27 ? 8 : 3
  if (releaseClause > 0) score += 7
  score += (p.grievance ?? 0) * 0.25   // unhappy players are easier to move

  // Who is asking matters. A manager with a name behind them can sell a move
  // the club alone could not — and this is the real reward for a career going
  // well: not a menu unlocking, but better players taking your call.
  if (toTeam.id === state.myTeam && state.manager) {
    // Re-signing is where trust is spent. A player who thinks you have used him
    // badly wants a lot more money to stay, and one who trusts you takes less.
    if (from?.id === state.myTeam) {
      parts.push({
        key: 'trust',
        v: (trustOf(p) - TRUST_START) * 0.55,
        why: '不再信任俱乐部对他的安排',
      })
      score += (trustOf(p) - TRUST_START) * 0.55
    }
    // 谈判 is worth a few points of persuasion on top of your name.
    //
    // The per-point strength here was 0.5, where every other call site in the
    // game uses 0.004-0.06. At 谈判 35 — the weak skill of the 前教练 origin —
    // that made this term -225 on a scale where the whole salary range is 60,
    // so a manager with weak negotiation could not sign a free agent at two and
    // a half times his asking wage. And because it was added straight to the
    // score rather than through `parts`, it could never be named as the
    // obstacle: the readout blamed the manager's reputation instead.
    const talk = (skillMod(state.manager, 'negotiation', 0.008) - 1) * 30
    parts.push({ key: 'talk', v: talk, why: '你的谈判能力不足以说服他' })
    score += talk
    const pull = (state.manager.reputation - toTeam.reputation) * 0.55
    parts.push({
      key: 'manager',
      v: clamp(pull, -8, 20),
      why: '认为你的执教履历还不足以说服他',
    })
    score += clamp(pull, -8, 20)
  }

  const worst = parts.filter((x) => x.v < -1).sort((a, b) => a.v - b.v)[0]
  return {
    score,
    chance: 1 / (1 + Math.exp(-score / 14)),
    worst: worst ? { key: worst.key, why: worst.why } : undefined,
    insulting: false,
  }
}

/** Would the player sign for this club on these terms? */
export function playerAcceptsTerms(
  state: GameState, p: Player, toTeam: Team, terms: Contract, rng: Rng,
): { ok: boolean; reason?: string } {
  const s = scoreOffer(state, p, toTeam, terms)
  if (s.insulting) {
    return { ok: false, reason: `${p.ign} 认为这份报价缺乏诚意：${s.worst?.why}。` }
  }
  if (rng.chance(s.chance)) return { ok: true }
  return {
    ok: false,
    reason: s.worst
      ? `${p.ign} 拒绝了报价：${s.worst.why}。`
      : `${p.ign} 拒绝了报价，他对目前的处境还算满意。`,
  }
}

/** Coarse, honest read-out of how an offer is likely to land. */
export function offerOutlook(s: OfferScore): { level: 'good' | 'fair' | 'poor'; label: string } {
  if (s.insulting) return { level: 'poor', label: '几乎不可能' }
  if (s.chance >= 0.72) return { level: 'good', label: '很可能接受' }
  if (s.chance >= 0.38) return { level: 'fair', label: '有机会' }
  return { level: 'poor', label: '希望不大' }
}

const moneyish = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** A club must always be able to field five; only the human may go thin. */
export function canSell(state: GameState, p: Player): boolean {
  if (!p.teamId) return true
  if (squadOf(state, p.teamId).length > 5) return true
  // Our club gets a hard floor, an AI club does not. An AI club replaces what
  // it sells inside a week — across two simulated seasons not one of them ever
  // dropped below five — so "a free agent exists" is enough for them. Nobody
  // signs for us but us, and a manager who lets his fifth man go plays the rest
  // of the season two against five.
  if (p.teamId === state.myTeam) return false
  // a five-man club can still sell, as long as someone real is left to sign
  return Object.values(state.players).some((x) => !x.teamId)
}

/** Why this club cannot let anyone else go, or null when it can. */
export function squadFloorBlock(state: GameState, teamId: string): string | null {
  if (squadOf(state, teamId).length > 5) return null
  return teamId === state.myTeam
    ? '阵容只剩五人了——再放走一个就凑不出首发，比赛只能少人上场。先补人再说。'
    : '对方只剩五名球员，放人就凑不齐首发了。'
}

/**
 * Move a player, or report that you could not.
 *
 * This used to return void and bail out silently, and every caller took that
 * silence for success. A bid for a player at a five-man club came back
 * "签约完成：X 加盟 Y", the offer was marked accepted, and X never moved — the
 * "显示加入但是没这个人" a player reported after rebuilding a squad through
 * bids that all reported success and none of which landed.
 */
export function doTransfer(
  state: GameState, p: Player, toTeamId: string, fee: number, terms: Contract,
): boolean {
  const from = p.teamId ? state.teams[p.teamId] : null
  const to = state.teams[toTeamId]
  if (!to) return false
  // Every refusal comes first. The dressing-room reaction used to run above
  // these guards, so a sale that was then refused — the buyer's roster full,
  // our own squad down to five — still cost the squad its trust and morale
  // and still printed "他离队了" in the news for a player who never left.
  //
  // refuse a move that would leave a club unable to field a team — including
  // ours: a manager who sells down to two plays the rest of the season two
  // against five, which is not a decision, it is a broken save
  if (from && !canSell(state, p)) return false
  // and one that would put the buyer over the import limit, when the rule is on
  if (importBlock(state, toTeamId, p)) return false
  // and one that would take any club past the seven-man roster ceiling
  if (rosterBlock(state, toTeamId)) return false

  // the dressing room notices who you sold — now that he is actually sold
  if (from?.id === state.myTeam) {
    const notes: string[] = []
    trustOnDeparture(state, p, notes)
    for (const t of notes) {
      state.news.push({ day: state.day, kind: 'club', important: true, text: t })
    }
  }

  if (from) {
    from.roster = from.roster.filter((id) => id !== p.id)
    from.starters = from.starters.filter((id) => id !== p.id)
    // Selling a starter left the five at four and nothing ever refilled it.
    // The match still fields five — selectLineup tops it up — but everything
    // that asks "is he a starter?" (promised-role grievance, weekly trust,
    // the squad screen) said no about a man who plays every map.
    if (from.starters.length < 5) from.starters = autoStarters(state, from.id)
    // canSell let this go on the promise that a replacement was available.
    // Keep the promise here rather than at the next weekly tick — an AI club
    // that sold on a Monday played the week's fixture with four.
    if (from.id !== state.myTeam && from.roster.length < 5) {
      const pool = Object.values(state.players).filter((x) => !x.teamId && x.id !== p.id && !x.retiring)
      // fielding five outranks the import rule, so an illegal cover is the
      // last resort rather than a forbidden one
      const cover = (pool.filter((x) => !importBlock(state, from.id, x)).length ? pool.filter((x) => !importBlock(state, from.id, x)) : pool)
        .sort((a, b) => b.overall - a.overall)[0]
      if (cover) {
        cover.teamId = from.id
        cover.contractYears = 2
        cover.salary = expectedSalary(cover, from.tier)
        from.roster.push(cover.id)
        state.news.push({
          day: state.day, kind: 'transfer',
          text: `${from.name} 紧急签下自由人 ${cover.ign}（${cover.overall}）填补空缺。`,
        })
      }
    }
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
  // stamp the rating he arrives on, but only for our own signings — the badge
  // that reads it is about what the manager did with him
  if (toTeamId === state.myTeam) {
    p.arrivedOverall = p.overall
    state.tally ??= { signed: 0, hired: 0, earned: 0, commercial: 0 }
    state.tally.signed += 1
  }
  p.contract = { ...terms }
  p.salary = terms.salary
  p.contractYears = terms.years
  p.expiredYear = undefined      // a renewal ends the countdown to a free exit
  p.grievance = 0
  p.listed = false
  p.listedOn = undefined
  // the signing fee is paid on the day, by the buying club
  if (terms.signingBonus > 0) {
    to.budget -= terms.signingBonus
    if (to.id === state.myTeam) {
      state.finances.balance -= terms.signingBonus
      state.finances.log.push({ day: state.day, label: `签字费 ${p.ign}`, amount: -terms.signingBonus })
    }
  }
  p.morale = clamp(p.morale + 8, 0, 100)
  p.joinedYear = state.year
  refreshValue(p)

  // An AI club that pays for a player intends to field him: the five is
  // recomputed on every signing. It used to update only when the lineup was
  // short, so a full squad benched its own record signing — and the listing
  // logic then read "surplus" off that bench and shopped him within the week.
  // The manager's own five is the manager's own business.
  if (to.id !== state.myTeam) to.starters = autoStarters(state, to.id)
  else if (to.starters.length < 5) to.starters = autoStarters(state, to.id)
  // the club that just lost its caller promotes one within the week
  if (from) ensureCaller(state, from.id)

  // a move that took a player we were actively in talks over is not ordinary
  // market noise — it is the answer to a question we asked
  const watched = to.id !== state.myTeam &&
    ((state.enquiries ?? []).some((e) => e.playerId === p.id && !e.answer) ||
      state.offers.some((o) => o.playerId === p.id && o.status === 'pending' &&
        o.toTeam === state.myTeam))
  state.news.push({
    day: state.day,
    kind: 'transfer',
    text: (fee > 0
      ? `${to.name} 以 $${fee.toLocaleString()} 的转会费从 ${from?.name ?? '自由市场'} 签下 ${p.ign}（${p.overall}）。`
      : `${to.name} 免费签下自由人 ${p.ign}（${p.overall}）。`)
      + (watched ? ' 你此前正在接触这名选手。' : ''),
    important: to.id === state.myTeam || from?.id === state.myTeam || watched,
  })
  return true
}

export function releasePlayer(state: GameState, p: Player): string {
  const from = p.teamId ? state.teams[p.teamId] : null
  // A manager could strip his own squad to two and the game let him, then
  // played every remaining fixture two against five. Releasing is the one door
  // out of a five-man squad that nothing was watching.
  if (from) {
    const blocked = squadFloorBlock(state, from.id)
    if (blocked) return blocked
  }
  if (from?.id === state.myTeam) {
    const notes: string[] = []
    trustOnDeparture(state, p, notes)
    for (const t of notes) {
      state.news.push({ day: state.day, kind: 'club', important: true, text: t })
    }
  }
  if (from) {
    from.roster = from.roster.filter((id) => id !== p.id)
    from.starters = from.starters.filter((id) => id !== p.id)
    if (from.starters.length < 5) from.starters = autoStarters(state, from.id)
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
  p.listedOn = undefined
  p.morale = clamp(p.morale - 6, 0, 100)
  state.news.push({
    day: state.day, kind: 'transfer',
    text: `${from?.name ?? '某队'} 与 ${p.ign} 解除合同，该选手成为自由人。`,
    important: from?.id === state.myTeam,
  })
  return `${p.ign} 已离队，成为自由人。`
}

/** Rough squad need: which role is the club thinnest at? */
function weakestRole(state: GameState, team: Team): { role: Player['role']; strength: number } | null {
  const squad = squadOf(state, team.id)
  // 自由人 is not a position to fill — in the data it means "vlr never recorded
  // one", and world.ts's autoStarters already excludes it. Leaving it in made
  // it every squad's "weakest role" (nobody has one), which pointed two thirds
  // of the AI's shopping at a pool of ten players and killed the paid market.
  const roles: Player['role'][] = ['决斗者', '先锋', '控场', '哨卫']
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
export function aiTransferTick(state: GameState, rng: Rng, notes?: string[]): void {
  if (!windowOpen(state.day)) return

  const teams = Object.values(state.teams).filter((t) => t.id !== state.myTeam)
  // a free agent on his farewell season is done job-hunting
  const agents = Object.values(state.players).filter((p) => p.teamId === null && !p.retiring)

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
        .filter((p) => !importBlock(state, team.id, p))
        .sort((a, b) => b.overall - a.overall)[0]
      if (target) {
        const salary = Math.round(expectedSalary(target, team.tier) * rng.range(1.0, 1.15))
        const yrs = rng.int(1, 3)
        const terms = defaultContract(salary, yrs)
        if (playerAcceptsTerms(state, target, team, terms, rng).ok) {
          if (doTransfer(state, target, team.id, 0, terms)) {
            agents.splice(agents.indexOf(target), 1)
          }
        }
      }
      continue
    }

    // shopping for an upgrade — hungrier and less patient once the player's
    // club has a world title to answer for
    const rivalry = Math.min(state.rivalry ?? 0, 2)
    if (rng.chance(0.35 + 0.1 * rivalry) && room > 500000 - 120000 * rivalry) {
      const need = weakestRole(state, team)
      if (!need) continue
      const candidates = Object.values(state.players).filter(
        (p) =>
          // never our players: an AI club that wants one of ours has to bid
          // for him through bidForOurPlayers and wait for an answer. Without
          // this line doTransfer ran straight through — a listed or unhappy
          // star simply vanished on the weekly tick, 5 careers in 20.
          p.teamId && p.teamId !== team.id && p.teamId !== state.myTeam &&
          p.role === need.role &&
          p.overall > need.strength + 3 &&
          // nobody pays a transfer fee for a man who has said this season is
          // his last — his announcement is public
          !p.retiring &&
          !importBlock(state, team.id, p) &&
          (p.listed || p.morale < 45 || rng.chance(0.05)),
      )
      // half credit for room to grow: a 84-rated 19-year-old with 92 potential
      // outranks an 86-rated 28-year-old, which is how real rosters get rebuilt
      const value = (p: { overall: number; potential: number }) =>
        p.overall + Math.max(0, p.potential - p.overall) * 0.5
      const target = candidates.sort((a, b) => value(b) - value(a))[0]
      if (!target) continue
      const fee = Math.round(askingPrice(target) * rng.range(0.9, 1.25))
      if (fee > room) continue
      if (!clubAcceptsFee(target, fee, rng)) continue
      const salary = Math.round(expectedSalary(target, team.tier) * rng.range(1.0, 1.2))
      const terms = defaultContract(salary, rng.int(2, 3))
      if (playerAcceptsTerms(state, target, team, terms, rng).ok) {
        doTransfer(state, target, team.id, fee, terms)
      }
    }
  }

  bidForOurPlayers(state, rng, notes)
}

/**
 * Clubs put players on the market so there is something to buy.
 *
 * Without this the window opens onto an empty shop: only free agents were ever
 * available, and nobody sells. Squad depth, unhappiness and being surplus to
 * the starting five all push a player onto the list; being needed pulls them
 * back off it.
 */
export function refreshListings(state: GameState, rng: Rng, notes?: string[]): void {
  // Clubs put players up for sale every week and the manager was never told —
  // the market simply looked different next time you opened the screen. Only
  // listings worth our attention are reported: someone at our level or above,
  // which is what would actually make you go and look.
  // the bar is our own rating: "someone at least as good as what we already
  // have came onto the market" is a clear rule and keeps the line to a few
  // names a week rather than half the league
  const bar = state.teams[state.myTeam]?.rating ?? 60
  const fresh: string[] = []
  // New listings only happen while clubs can actually trade, but withdrawals
  // run all year: when a window shuts on an unsold player, the club stops
  // shopping him and puts him back in the squad rather than leaving him hanging.
  const canList = windowOpen(state.day)
  for (const team of Object.values(state.teams)) {
    if (team.id === state.myTeam) continue
    const squad = squadOf(state, team.id).sort((a, b) => b.overall - a.overall)
    for (const p of squad) {
      const benched = !team.starters.includes(p.id)
      const surplus = squad.length > 6 && benched
      const unhappy = (p.grievance ?? 0) > 40
      const expiring = p.contractYears <= 1
      const aging = p.age >= 29 && benched
      // a club does not shop the man it signed this season unless he is
      // actively miserable — buying whyz and listing him by Thursday was
      // market noise, not squad-building
      if (p.joinedYear === state.year && !unhappy) continue

      let chance = 0
      if (surplus) chance += 0.22
      if (unhappy) chance += 0.3
      if (expiring && benched) chance += 0.15
      if (aging) chance += 0.12
      // Real rosters are mostly exactly five, so a blanket "no thin squad sells"
      // rule silenced most of the league. A five-man club still won't shop a
      // player it is happy with — but it will let go of one who wants out.
      if (squad.length <= 5) {
        chance = unhappy ? 0.18 : expiring ? 0.08 : 0
      }
      if (!p.listed && canList && chance > 0 && rng.chance(chance)) {
        p.listed = true
        p.listedOn = state.day
        if (p.overall >= bar) fresh.push(`${p.ign}（${team.tag} · ${p.overall}）`)
        continue
      }
      if (!p.listed) continue

      // A listing that nobody bids on does not sit there forever. After a
      // couple of weeks the club gives up on selling and folds the player back
      // into the squad — which is also what stops the market growing without
      // bound, since previously only an unbenched, happy player could come off.
      // the day counter restarts each season, so a negative age means the
      // listing was carried over from last year — stale by definition
      const age = state.day - (p.listedOn ?? state.day)
      // a shut window ends the sale attempt outright
      const stale = age >= 14 || age < 0 || !canList
      const wanted = !benched && !unhappy
      if (wanted && rng.chance(0.25)) {
        p.listed = false
        p.listedOn = undefined
      } else if (stale && rng.chance(0.45)) {
        p.listed = false
        p.listedOn = undefined
        // taken off the market and given a role again, so the grievance eases
        p.grievance = clamp((p.grievance ?? 0) - 12, 0, 100)
        if (squad.length <= 5 && !team.starters.includes(p.id) && team.starters.length < 5) {
          team.starters = [...team.starters, p.id]
        }
      }
    }
  }
  if (notes && fresh.length) {
    notes.push(`📋 转会市场新挂牌：${fresh.slice(0, 4).join('、')}`
      + (fresh.length > 4 ? ` 等 ${fresh.length} 人` : ''))
  }
}

/**
 * Rival clubs come after our players.
 *
 * This is what makes a release clause or a no-poach clause worth anything: a
 * bid that meets a release clause goes through whether we like it or not,
 * everything else lands as an offer we answer.
 */
/**
 * `notes` is the turn's digest.
 *
 * A bid for one of our players is a decision the manager has to take — accept
 * or refuse, inside seven days — and it only ever reached state.news. So the
 * digest reported the withdrawal a week later without ever having reported the
 * bid: "TYLOO 撤回了对 zhe 的报价" for an offer nobody was told about, and a
 * decision that expired on its own.
 */
export function bidForOurPlayers(state: GameState, rng: Rng, notes?: string[]): void {
  // Bids arrive whatever the squad size — receiving one costs nothing, since
  // the manager decides. Only accepting can leave us short, and the agenda
  // already flags a squad under five.
  const mine = squadOf(state, state.myTeam)
  if (!mine.length) return

  // A world champion's starters are everyone's shopping list. Rivalry makes
  // the calls come more often and the money real — keeping a title-winning
  // five together is supposed to cost something.
  const rivalry = Math.min(state.rivalry ?? 0, 2)
  for (const team of Object.values(state.teams)) {
    if (team.id === state.myTeam) continue
    // a club with no room cannot complete the deal, so it must not open one:
    // the bid arrived, 接受 failed, and the toast never said why
    if (rosterBlock(state, team.id)) continue
    if (!rng.chance(0.12 + 0.05 * rivalry)) continue

    const need = weakestRole(state, team)
    const targets = mine.filter(
      (p) =>
        p.overall > (need?.strength ?? 0) + 2 &&
        !p.retiring &&
        (p.listed || (p.grievance ?? 0) > 30 || !!p.contract?.releaseClause || rng.chance(0.25)),
    )
    const target = targets.sort((a, b) => b.overall - a.overall)[0]
    if (!target) continue
    // `mine` was snapshotted before the loop, so a player already sold to the
    // first club this tick was still offered to the second and the third — a
    // clause could be "paid" three times and he changed clubs twice in a day
    if (target.teamId !== state.myTeam) continue
    if (target.contract?.noPoach && !target.listed) continue

    const clause = target.contract?.releaseClause ?? 0
    const ask = askingPrice(target)
    const room = team.budget - wageBill(state, team.id) * 0.6
    // a club will pay the clause exactly when it can afford it
    const fee = clause > 0 && clause <= room
      ? clause
      : Math.round(ask * rng.range(0.8, 1.2) * (1 + 0.15 * rivalry))
    if (fee > room) continue

    const terms: Contract = {
      ...defaultContract(Math.round(expectedSalary(target, team.tier) * rng.range(1.0, 1.25)), rng.int(2, 3)),
      promisedRole: target.overall >= (need?.strength ?? 0) + 8 ? 'star' : 'starter',
    }
    if (!playerAcceptsTerms(state, target, team, terms, rng).ok) continue

    const forced = clause > 0 && fee >= clause
    state.offers.push({
      id: `IN${state.offers.length}_${state.day}`,
      playerId: target.id,
      fromTeam: state.myTeam,
      toTeam: team.id,
      fee, salary: terms.salary, years: terms.years, terms,
      day: state.day,
      respondOn: state.day,
      status: 'pending',
      note: forced ? 'release-clause' : undefined,
    })

    if (forced) {
      // A clause is not a magic wand: doTransfer can still refuse (our squad
      // is down to five, the buyer's roster is full, the import rule bites).
      // Announcing the departure regardless printed "他已经离队" for a player
      // still sitting in the squad list.
      const left = doTransfer(state, target, team.id, fee, terms)
      state.offers[state.offers.length - 1].status = left ? 'accepted' : 'rejected'
      if (!left) {
        notes?.push(
          `🛡 ${team.name} 想触发 ${target.ign} 的解约金，但这笔交易无法完成`
          + '（我方阵容会不足五人，或对方名单已满），他留下了。',
        )
        continue
      }
      state.news.push({
        day: state.day, kind: 'transfer', important: true,
        text: `${team.name} 支付了 ${target.ign} 合同中的解约金 $${fee.toLocaleString()}，我们无权拒绝。`,
      })
      notes?.push(
        `🚨 ${team.name} 触发了 ${target.ign} 的解约金 $${fee.toLocaleString()}，`
        + '我们无权拒绝，他已经离队。',
      )
    } else {
      state.news.push({
        day: state.day, kind: 'transfer', important: true,
        text: `${team.name} 报价 $${fee.toLocaleString()} 求购 ${target.ign}，等待我们答复。`,
      })
      notes?.push(
        `💼 ${team.name} 报价 $${fee.toLocaleString()} 求购 ${target.ign}，`
        + '7 天内要给答复，逾期视为拒绝。',
      )
    }
  }
}

/** Offers other clubs have made for our players, awaiting our answer. */
export const incomingOffers = (state: GameState) =>
  state.offers.filter(
    (o) => o.status === 'pending' && o.fromTeam === state.myTeam && o.toTeam !== state.myTeam,
  )

/** Accept or reject a bid for one of our players. */
export function answerIncoming(state: GameState, offerId: string, accept: boolean): string {
  const o = state.offers.find((x) => x.id === offerId)
  if (!o || o.status !== 'pending') return '这份报价已经失效。'
  const p = state.players[o.playerId]
  const to = state.teams[o.toTeam]
  if (!p || !to) {
    o.status = 'expired'
    return '这份报价已经失效。'
  }
  // A bid can outlive the thing it was for. Accepting one for a player who has
  // already gone would have moved him out of whichever club he joined, and
  // reported a sale whose money never reached us.
  if (p.teamId !== state.myTeam) {
    o.status = 'expired'
    return `${p.ign} 已经不在队里了，这份报价失效。`
  }
  if (!accept) {
    o.status = 'rejected'
    // turning down a move a player wanted does not go unnoticed
    if ((p.grievance ?? 0) > 30 || p.listed) {
      p.grievance = clamp((p.grievance ?? 0) + 12, 0, 100)
      p.morale = clamp(p.morale - 6, 0, 100)
      return `已拒绝 ${to.name} 对 ${p.ign} 的报价。他本人对此并不高兴。`
    }
    return `已拒绝 ${to.name} 对 ${p.ign} 的报价。`
  }
  if (!doTransfer(state, p, to.id, o.fee, o.terms ?? defaultContract(o.salary, o.years))) {
    o.status = 'rejected'
    return squadFloorBlock(state, state.myTeam)
      ?? `这笔转会没能完成，${p.ign} 留下了。`
  }
  o.status = 'accepted'
  return `${p.ign} 以 $${o.fee.toLocaleString()} 转会至 ${to.name}。`
}

/**
 * Ask about a player who is not for sale.
 *
 * The market screen only ever showed listed players and free agents, which
 * meant the ones worth wanting were invisible. An enquiry is free of money and
 * costs a day's action: the club names a price and the player says whether he
 * is interested, and only then do you decide whether to bid.
 */
export const INTEREST_CN = {
  keen: '很有兴趣', open: '愿意谈', reluctant: '不太情愿', no: '明确拒绝',
} as const

export function enquireAbout(state: GameState, playerId: string): string {
  const shut = windowBlock(state)
  if (shut) return shut
  const p = state.players[playerId]
  if (!p) return '找不到这名选手。'
  if (!p.teamId) return '他是自由人，直接报价即可。'
  if (p.teamId === state.myTeam) return '他已经在你的队里了。'
  if (state.enquiries?.some((e) => e.playerId === playerId && !e.answer)) {
    return `已经在等 ${p.ign} 那边的答复了。`
  }
  const rng = new Rng(hashStr(`enq:${state.seed}:${state.day}:${playerId}`))
  state.enquiries = [...(state.enquiries ?? []), {
    id: `EQ${state.day}_${playerId}`,
    playerId, teamId: p.teamId,
    day: state.day,
    replyOn: state.day + rng.int(2, 5),
  }]
  const full = rosterBlock(state, state.myTeam)
  return `已就 ${p.ign} 向 ${state.teams[p.teamId]?.name} 问价，等待答复。${full ? '注意：名单已满（7/7），正式买入前要先放走一人。' : ''}`
}

/** Enquiries answered today. */
export function resolveEnquiries(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  for (const e of state.enquiries ?? []) {
    if (e.answer || e.replyOn > state.day) continue
    const p = state.players[e.playerId]
    const holder = p?.teamId ? state.teams[p.teamId] : null
    if (!p || !holder || p.teamId !== e.teamId) {
      e.answer = 'closed'
      e.reason = '这名选手的情况已经变了'
      continue
    }

    // a club names a price whether or not it wants to sell; an untouchable
    // player simply gets an absurd one
    const squad = squadOf(state, holder.id)
    const key = holder.starters.includes(p.id) && p.overall >= 78
    const thin = squad.length <= 5
    const premium = (key ? 1.9 : 1.15) * (thin ? 1.35 : 1) *
      (p.listed ? 0.8 : 1) * rng.range(0.9, 1.15)
    e.askingFee = Math.round(askingPrice(p) * premium)

    // and the player answers for himself
    const wants = (p.grievance ?? 0) > 35 || p.morale < 45 || p.contractYears <= 1
    const better = (state.teams[state.myTeam]?.reputation ?? 0) - holder.reputation
    const score = better * 1.4 + (wants ? 25 : 0) + (p.listed ? 20 : 0) -
      (p.loyalty - 50) * 0.5 + rng.range(-12, 12)
    e.interest = score > 28 ? 'keen' : score > 6 ? 'open' : score > -18 ? 'reluctant' : 'no'
    e.answer = e.interest === 'no' ? 'closed' : 'open'
    if (e.interest === 'no') {
      e.reason = better < 0 ? '不愿意去平台更差的球队' : '现在不想离开'
    }

    // An enquiry answers twice over — the club names a price, the player says
    // whether he wants to come — so both halves have to name who is speaking.
    // "本人" alone reads as "I, myself" in Chinese, which had readers asking
    // which side had refused.
    const label = INTEREST_CN[e.interest as keyof typeof INTEREST_CN]
    notes.push(
      `📋 就 ${p.ign} 问价：${holder.name} 开价约 ${Math.round((e.askingFee ?? 0) / 1000)}K，` +
      `选手本人${label}。`,
    )
  }
  state.enquiries = (state.enquiries ?? []).filter((e) => !e.answer || e.replyOn > state.day - 30)
  return notes
}

/**
 * Put a bid on the table. Null when the window is shut — see windowBlock.
 *
 * A bid already made is not withdrawn when the window closes: the selling club
 * takes 7-10 days to answer, so a bid placed on the last turn of the preseason
 * window is always answered after it. That deal still completes. What you
 * cannot do once it has shut is open a new one.
 */
export function makeOffer(
  state: GameState, playerId: string, toTeam: string, fee: number, terms: Contract,
): TransferOffer | null {
  if (windowBlock(state)) return null
  // nobody signs on the spot: the other side takes a week or so to come back,
  // and a rival can get there first in the meantime
  const rng = new Rng(hashStr(`offer:${state.seed}:${playerId}:${state.day}`))
  const offer: TransferOffer = {
    id: `O${state.offers.length}_${state.day}`,
    playerId,
    fromTeam: state.players[playerId]?.teamId ?? null,
    toTeam, fee, salary: terms.salary, years: terms.years, terms,
    day: state.day,
    respondOn: state.day + rng.int(7, 10),
    status: 'pending',
  }
  state.offers.push(offer)
  return offer
}

/**
 * Answer any offers whose waiting period is up.
 *
 * Deciding late rather than on submission is what makes an offer a commitment:
 * the money is not yours to spend twice, the player can be signed by someone
 * else while you wait, and the window can close underneath you.
 */
export function resolveDueOffers(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  for (const offer of state.offers) {
    if (offer.status !== 'pending') continue
    // bids for our own players wait on us — but not forever
    if (offer.fromTeam === state.myTeam && offer.toTeam !== state.myTeam) {
      if (state.day - offer.day >= 7) {
        offer.status = 'expired'
        const p = state.players[offer.playerId]
        notes.push(`${state.teams[offer.toTeam]?.name} 撤回了对 ${p?.ign} 的报价。`)
      }
      continue
    }
    if (state.day < (offer.respondOn ?? offer.day)) continue

    const p = state.players[offer.playerId]
    const to = state.teams[offer.toTeam]
    if (!p || !to) {
      offer.status = 'expired'
      continue
    }
    // somebody else got there first
    if (p.teamId === offer.toTeam) {
      offer.status = 'expired'
      continue
    }
    if (p.teamId !== offer.fromTeam) {
      offer.status = 'expired'
      offer.note = `${p.ign} 已经加盟了 ${state.teams[p.teamId ?? '']?.name ?? '别的俱乐部'}。`
      notes.push(offer.note)
      state.news.push({ day: state.day, kind: 'transfer', text: offer.note, important: true })
      continue
    }

    const msg = resolveMyOffer(state, offer, rng)
    const signed = (offer.status as TransferOffer['status']) === 'accepted'
    notes.push(msg)
    state.news.push({ day: state.day, kind: 'transfer', text: msg, important: signed })
  }
  // keep the list from growing without bound
  if (state.offers.length > 60) {
    state.offers = state.offers.filter((o) => o.status === 'pending').slice(-60)
  }
  return notes
}

/** Money committed to offers still awaiting an answer. */
export const committedFunds = (state: GameState): number =>
  state.offers
    .filter((o) => o.status === 'pending' && o.toTeam === state.myTeam)
    .reduce((s, o) => s + o.fee + (o.terms?.signingBonus ?? 0), 0)

/** Resolve an offer the human manager submitted. */
export function resolveMyOffer(state: GameState, offer: TransferOffer, rng: Rng): string {
  const p = state.players[offer.playerId]
  const to = state.teams[offer.toTeam]
  if (!p || !to) {
    offer.status = 'rejected'
    return '目标不存在。'
  }
  const cost = offer.fee + (offer.terms?.signingBonus ?? 0)
  if (cost > state.finances.balance) {
    offer.status = 'rejected'
    return '资金不足，无法支付这笔转会费。'
  }
  {
    const blocked = importBlock(state, offer.toTeam, p) ?? rosterBlock(state, offer.toTeam)
    if (blocked) {
      offer.status = 'rejected'
      return blocked
    }
  }
  if (p.teamId) {
    if (!clubAcceptsFee(p, offer.fee, rng)) {
      offer.status = 'rejected'
      const ask = askingPrice(p)
      return `${state.teams[p.teamId]?.name} 拒绝了报价，他们的心理价位在 $${ask.toLocaleString()} 左右。`
    }
  }
  const terms = offer.terms ?? defaultContract(offer.salary, offer.years)
  const verdict = playerAcceptsTerms(state, p, to, terms, rng)
  if (!verdict.ok) {
    offer.status = 'rejected'
    return verdict.reason ?? '选手拒绝了这份合同。'
  }
  if (!doTransfer(state, p, to.id, offer.fee, terms)) {
    offer.status = 'rejected'
    // name the real reason: the selling club would be left unable to field five
    return p.teamId
      ? `${state.teams[p.teamId]?.name ?? '对方'} 最终没有放人——${squadFloorBlock(state, p.teamId) ?? '这笔转会没能完成。'}`
      : `这笔签约没能完成，${p.ign} 仍是自由人。`
  }
  offer.status = 'accepted'
  return `签约完成：${p.ign} 加盟 ${to.name}。`
}
