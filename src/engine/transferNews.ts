/**
 * 转会新闻: every move, listing, rumour and request, as a record rather than a sentence.
 *
 * The group (2026-10-08): 「转会消息不是很清晰」. Moves reached the manager as free text in
 * state.news — the same list as match results and sponsor mail, capped at 400 lines — so a
 * transfer from two months ago was simply gone, and a line like 「X 以 $Y 从 Z 签下 W」 could
 * not be filtered, sorted or drawn with crests. This is the transfer page's own ledger: who,
 * from which club, to which club, for how much, and what kind of story it is — 传闻 that may
 * come to nothing, a player who wants out, a club listing him, the deal itself.
 *
 * Entries are short-keyed because they live in the save, which has a browser quota to fit
 * (saves were cut from 5.7 MB to 1.8 MB for it) — about 90 bytes each. FEED_MAX bounds them: when full, last
 * seasons' talk (rumours, requests, listings) goes before any completed move does.
 */
import type { GameState, Player } from './types'
import { careerDayOf } from './clock'

export type TxKind =
  | 'rumor'    // 传闻 / 绯闻 — a club linked with a player; `c` says how solid
  | 'wants'    // 意向 — the player wants out, maybe to a named club (`t`)
  | 'listed'   // 挂牌 — his club has put him up for sale
  | 'done'     // 官宣 — moved between clubs (fee may be 0 for a clause-free move)
  | 'free'     // 自由签约 — a free agent signed
  | 'release'  // 离队 — released, or his contract ran out
  | 'off'      // 告吹 — a pursuit that did not happen
  | 'bid'      // 报价 — a club bid for one of ours, awaiting our answer

export interface TxNews {
  y: number
  d: number
  k: TxKind
  /** player id, and his name and rating on the day */
  p: string
  n: string
  o?: number
  /** the club he is at / leaving (null: a free agent) */
  f?: string | null
  /** the club he is going to, or being linked with */
  t?: string | null
  fee?: number
  /** rumours: 1 绯闻 (talk), 2 有消息称 (a club is watching), 3 谈判中 (a real approach) */
  c?: 1 | 2 | 3
  /** a few words of why: 合同到期, 选手申请转会, 战绩 3胜9负 … */
  w?: string
}

/** our club is on one side of it — read now, so after a change of job it means the new club */
export const involves = (e: TxNews, club: string): boolean => e.f === club || e.t === club

export const FEED_MAX = 600

export const TX_KIND_CN: Record<TxKind, string> = {
  rumor: '传闻', wants: '意向', listed: '挂牌', done: '官宣', free: '自由签约', release: '离队', off: '告吹', bid: '报价',
}
export const RUMOR_CN: Record<1 | 2 | 3, string> = { 1: '绯闻', 2: '有消息称', 3: '谈判中' }

/** what kind of story it is, for the feed's filter chips */
export const TX_GROUPS: { key: string; label: string; kinds: TxKind[] }[] = [
  { key: 'all', label: '全部', kinds: [] },
  { key: 'done', label: '官宣', kinds: ['done', 'free'] },
  { key: 'rumor', label: '传闻', kinds: ['rumor', 'off'] },
  { key: 'wants', label: '意向', kinds: ['wants'] },
  { key: 'listed', label: '挂牌', kinds: ['listed'] },
  { key: 'release', label: '离队', kinds: ['release'] },
]

const TALK = new Set<TxKind>(['rumor', 'wants', 'listed', 'off', 'bid'])

/** Write one story to the feed. */
export function txNews(
  state: GameState, k: TxKind, p: Pick<Player, 'id' | 'ign' | 'overall'>,
  extra: { f?: string | null; t?: string | null; fee?: number; c?: 1 | 2 | 3; w?: string } = {},
): TxNews {
  const e: TxNews = { y: state.year, d: state.day, k, p: p.id, n: p.ign, o: Math.round(p.overall) }
  if (extra.f !== undefined) e.f = extra.f
  if (extra.t !== undefined) e.t = extra.t
  if (extra.fee) e.fee = Math.round(extra.fee)
  if (extra.c) e.c = extra.c
  if (extra.w) e.w = extra.w
  const feed = (state.transferFeed ??= [])
  feed.push(e)
  if (feed.length > FEED_MAX) trimFeed(state)
  return e
}

/**
 * Make room: talk more than a month old first (a rumour's story is over by then — the deal or
 * the 告吹 carries it), then the oldest of anything. Dropping only LAST seasons' talk kept a
 * season's worth of chatter and pushed the moves out: about 1–1.5 seasons survived (review).
 * Moves alone are ~170 a season, so 600 holds three seasons and more of them.
 */
export function trimFeed(state: GameState): void {
  const feed = state.transferFeed
  if (!feed || feed.length <= FEED_MAX) return
  let over = feed.length - FEED_MAX
  const stale = careerDayOf(state) - 30
  const kept = feed.filter((e) => {
    if (over > 0 && TALK.has(e.k) && careerDayOf({ year: e.y, day: e.d }) < stale) { over--; return false }
    return true
  })
  state.transferFeed = over > 0 ? kept.slice(over) : kept
}

/**
 * He has joined a club, by whatever road — a sale, a free signing, an emergency cover, a
 * roster top-up, a real-world arrival. The AI's resale rule reads `movedOn`, and whatever he
 * had going at his last club (a listing, a transfer request) does not follow him: only the
 * sale path did this, so a man topped up into a squad on day 364 arrived still 「listed」 and
 * 「asking out」 and was sold on inside a fortnight (review, 2026-10-08).
 */
export function joinedClub(state: GameState, p: Player): void {
  p.movedOn = careerDayOf(state)
  p.wantsOut = undefined
  p.listed = false
  p.listedOn = undefined
}

/** This season's record for a club, from its played fixtures (scrims aside). */
export function seasonRecord(state: GameState, teamId: string): { w: number; l: number } {
  let w = 0
  let l = 0
  for (const f of state.fixtures) {
    if (!f.played || f.scrim || !f.result) continue
    if (f.teamA !== teamId && f.teamB !== teamId) continue
    const a = f.result.mapsWonA > f.result.mapsWonB
    if ((f.teamA === teamId) === a) w++
    else l++
  }
  return { w, l }
}
