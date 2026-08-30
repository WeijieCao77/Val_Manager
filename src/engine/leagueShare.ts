/**
 * The league's money, and the manager's seat at that table.
 *
 * Mid-career finances had a structural hole the group chat found before the
 * telemetry did: reputation and trophies piled up, but the only income that
 * scaled was sponsorship, and sponsorship tops out. Wages do not. The real
 * VCT answers this with the partnership model — a stipend for being in the
 * league, plus a cut of team-themed bundle sales — so this game does too.
 *
 * Three streams, all deliberately sized against a wage bill of $2–4M:
 *
 *   联盟津贴 — every club, weekly, by tier. The floor under the whole league,
 *   AI clubs included, which is what keeps the world's books from rotting.
 *
 *   年度捆绑包 — the club's own capsule, settled when the season ends. The
 *   club takes `share` percent of a pot that either stays flat (固定) or
 *   rides reputation and results (销量) — the manager picks the mode before
 *   the season starts and negotiates the share once a year.
 *
 *   特别企划 — some seasons the league proposes a themed drop mid-year:
 *   take a buyout now, or bet on your own season and settle it at the end.
 *
 * Everything routes through the same weekly/at-settlement paths finance.ts
 * already uses, so the finance screen and the board read it like any other
 * line.
 */
import { clamp } from './rng'
import type { GameState, LeagueDeal } from './types'

/** What being in the league pays a club per season, by tier. */
export const LEAGUE_STIPEND: Record<number, number> = { 1: 600_000, 2: 100_000 }

export const SHARE_MIN = 50
export const SHARE_MAX = 80

export const leagueDealOf = (state: GameState): LeagueDeal =>
  (state.leagueDeal ??= { share: 55, mode: 'fixed' })

/** The stipend as the weekly settlement pays it. */
export const weeklyStipend = (tier: number): number =>
  Math.round((LEAGUE_STIPEND[tier] ?? 0) / 48)

/**
 * The season's bundle pot, before the club's share is applied.
 *
 * 固定 pays the same whatever happened. 销量 starts lower and rides champ
 * points and reputation — a champion at rep 80 roughly doubles the fixed
 * figure, a quiet season at a small club undercuts it. Challengers capsules
 * sell a fraction of a VCT one.
 */
export function bundlePot(state: GameState): number {
  const me = state.teams[state.myTeam]
  if (!me) return 0
  const deal = leagueDealOf(state)
  const pot = deal.mode === 'fixed'
    ? 520_000
    : 220_000 + 9_000 * me.champPoints + 7_000 * Math.max(0, me.reputation - 50)
  return Math.round(pot * (me.tier === 1 ? 1 : 0.3))
}

/** The 特别企划 bet, if one was taken: a second, smaller results-driven pot. */
export function betPot(state: GameState): number {
  const me = state.teams[state.myTeam]
  if (!me) return 0
  const pot = 100_000 + 5_000 * me.champPoints + 4_000 * Math.max(0, me.reputation - 50)
  return Math.round(pot * (me.tier === 1 ? 1 : 0.3))
}

/** The buyout the league offers instead of the bet. */
export const BUNDLE_BUYOUT = 280_000

/**
 * Settle the year's bundle money. Called at season end, before champ points
 * reset — the pot is judged on the season that was actually played.
 */
export function settleLeagueSeason(state: GameState, notes: string[]): void {
  const me = state.teams[state.myTeam]
  if (!me) return
  const deal = leagueDealOf(state)

  const payout = Math.round(bundlePot(state) * deal.share / 100)
  if (payout > 0) {
    me.budget += payout
    state.finances.balance += payout
    state.finances.log.push({ day: state.day, label: `联盟分成 · 年度捆绑包（${deal.share}%）`, amount: payout })
    notes.push(`📦 联盟年度捆绑包结算：${deal.mode === 'fixed' ? '固定模式' : '销量模式'}，你的 ${deal.share}% 分成到账 $${payout.toLocaleString()}。`)
  }

  if (deal.bundleBet) {
    const bet = betPot(state)
    me.budget += bet
    state.finances.balance += bet
    state.finances.log.push({ day: state.day, label: '联盟特别企划 · 销量对赌', amount: bet })
    notes.push(`🎲 特别企划对赌结算：$${bet.toLocaleString()}`
      + `（当年买断价 $${BUNDLE_BUYOUT.toLocaleString()}——${bet >= BUNDLE_BUYOUT ? '赌对了' : '这次买断更划算'}）。`)
    deal.bundleBet = false
  }
}

/**
 * Ask the league for a bigger cut. Once a year, and the answer depends on
 * what you bring to the table: the club's name, last season's silverware,
 * and whether the manager can actually run a negotiation.
 */
export function negotiateShare(state: GameState): string {
  const me = state.teams[state.myTeam]
  if (!me) return '找不到俱乐部。'
  const deal = leagueDealOf(state)
  if (deal.talkedYear === state.year) return '今年已经和联盟谈过了——他们的预算一年只批一次。'
  if (deal.share >= SHARE_MAX) return `分成已经是联盟给过的最高档（${SHARE_MAX}%），没有再谈的余地了。`
  deal.talkedYear = state.year

  const skill = state.manager?.skills.negotiation ?? 50
  const titles = state.honours.filter((h) => h.year >= state.year - 1).length
  const p = clamp(
    0.22
    + (skill - 50) * 0.008
    + (me.reputation - 55) * 0.005
    + titles * 0.06
    // the first raise is easy to grant; each one after digs into the league's own cut
    - (deal.share - 55) * 0.012,
    0.05, 0.85,
  )
  // deterministic per year+seed: a reload does not re-roll the league's mood
  const roll = ((state.seed ^ (state.year * 2654435761)) >>> 8) % 1000 / 1000
  if (roll < p) {
    deal.share = Math.min(SHARE_MAX, deal.share + 5)
    const msg = `联盟松口了：捆绑包分成提到 ${deal.share}%。`
    state.news.push({ day: state.day, kind: 'club', important: true, text: `🤝 ${msg}` })
    return msg
  }
  return `联盟这次没让步——分成维持 ${deal.share}%，明年可以再谈。战绩和声望是最好的筹码。`
}

/** Pick how this season's bundle settles. Locked once the season is underway. */
export function setDealMode(state: GameState, mode: LeagueDeal['mode']): string {
  const deal = leagueDealOf(state)
  if (deal.mode === mode) return ''
  if (state.day >= 63) return '合作方式要在赛季初（Masters I 之前）和联盟定下来，现在改不了了。'
  if (deal.modeYear === state.year) return '今年的合作方式已经定过一次了。'
  deal.mode = mode
  deal.modeYear = state.year
  return mode === 'sales'
    ? '已改为销量分成：收入跟着声望和成绩走——打得越好，捆绑包卖得越多。'
    : '已改为固定结算：不论成绩，每年一笔稳定的分成。'
}

/** The league floats a themed capsule. Generated when Stage 1 opens, some years. */
export function offerBundle(state: GameState, notes: string[]): void {
  const me = state.teams[state.myTeam]
  if (!me || me.tier !== 1) return
  state.leagueOffer = { year: state.year, expires: state.day + 10 }
  const line = `📦 联盟提出为 ${me.name} 推出主题捆绑包：可以现在拿 $${BUNDLE_BUYOUT.toLocaleString()} 买断，`
    + '也可以按销量对赌、赛季结束结算。去「财务」页答复,10 天内有效。'
  notes.push(line)
  state.news.push({ day: state.day, kind: 'club', important: true, text: line })
}

/** The manager's answer to the capsule proposal. */
export function answerBundle(state: GameState, take: 'cash' | 'bet'): string {
  const offer = state.leagueOffer
  if (!offer || offer.year !== state.year) return '现在没有待答复的联盟企划。'
  if (state.day > offer.expires) { state.leagueOffer = undefined; return '这个企划已经过期了。' }
  state.leagueOffer = undefined
  const me = state.teams[state.myTeam]
  if (take === 'cash') {
    if (me) me.budget += BUNDLE_BUYOUT
    state.finances.balance += BUNDLE_BUYOUT
    state.finances.log.push({ day: state.day, label: '联盟特别企划 · 买断', amount: BUNDLE_BUYOUT })
    return `买断成交：$${BUNDLE_BUYOUT.toLocaleString()} 到账。`
  }
  leagueDealOf(state).bundleBet = true
  return '选择销量对赌——赛季结束时按声望和成绩结算。现在，去把成绩打出来。'
}

/** A day's housekeeping: an unanswered proposal quietly lapses. */
export function tickLeagueOffer(state: GameState, notes: string[]): void {
  const offer = state.leagueOffer
  if (offer && (state.day > offer.expires || offer.year !== state.year)) {
    state.leagueOffer = undefined
    notes.push('📦 联盟的主题捆绑包企划无人答复，撤回了。')
  }
}
