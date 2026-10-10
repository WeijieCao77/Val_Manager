/**
 * 历代强队: your retired five against twelve teams that won a world event,
 * as they were that week (owner, 2026-10-10).
 *
 * The opponents are data, not invention — the five who played the most
 * rounds for the team at the event, each rated by the live algorithm on the
 * day after it (scripts/rating/build_history_teams.py). Four chapters of
 * three, ordered by how often a middling silver retired five beats them
 * (scripts/measure_history_teams.ts), so the first chapter is the one a
 * starting collection clears and 2021 Sentinels is the last.
 *
 * Your side: five retired starters (the 传奇联赛 door), your own levels and
 * coach. No 体力, a loss is played again for free, BO3. A chapter cleared
 * pays one 退役选手包, the whole board one more — each once per account.
 */
import HT from '../data/history_teams.json'
import type { Squad } from './cards'
import { leagueEntry, note } from './gacha'
import type { GachaState, PackKind } from './gacha'

export interface HistoryStage {
  id: string
  chapter: number
  event: string
  short: string
  year: number
  team: string
  tag: string
  result: string
  /** the five's average era rating */
  rating: number
  five: Squad
}
type Row = { id: string; chapter: number; event: string; short: string; year: number; team: string; tag: string; result: string; rating: number; players: { vlrId: string }[] }
export const HISTORY_STAGES: HistoryStage[] = (HT as unknown as { stages: Row[] }).stages.map((s) => ({
  id: s.id, chapter: s.chapter, event: s.event, short: s.short, year: s.year, team: s.team, tag: s.tag,
  result: s.result, rating: s.rating,
  five: { slots: s.players.map((p) => `ht:${s.id}:${p.vlrId}`), coach: null },
}))
export const HISTORY_CHAPTERS = [...new Set(HISTORY_STAGES.map((s) => s.chapter))]
export const HISTORY_BO = 3
export const HISTORY_CHAPTER_PACK: { pack: PackKind; count: number } = { pack: 'retired', count: 1 }
export const HISTORY_FULL_PACK: { pack: PackKind; count: number } = { pack: 'retired', count: 1 }

export interface HistoryState {
  /** stage ids beaten at least once */
  cleared: string[]
  /** chapters whose pack has been paid */
  paid: number[]
  /** the whole-board pack has been paid */
  full: boolean
  /** matches played per stage, won or lost */
  tries: Record<string, number>
}

const STAGE_IDS = new Set(HISTORY_STAGES.map((s) => s.id))

/** The account's record, cleaned on the way in (the client never writes it; this is for old or odd saves). */
export function historyState(g: GachaState): HistoryState {
  const raw = (g.history ?? {}) as Partial<HistoryState>
  const cleared = Array.isArray(raw.cleared) ? [...new Set(raw.cleared.filter((x) => typeof x === 'string' && STAGE_IDS.has(x)))] : []
  const paid = Array.isArray(raw.paid) ? [...new Set(raw.paid.filter((c) => HISTORY_CHAPTERS.includes(c)))] : []
  const tries: Record<string, number> = {}
  if (raw.tries && typeof raw.tries === 'object') {
    for (const [k, v] of Object.entries(raw.tries)) if (STAGE_IDS.has(k) && Number.isFinite(v) && v > 0) tries[k] = Math.trunc(v)
  }
  g.history = { cleared, paid, full: raw.full === true, tries }
  return g.history
}

/** A stage is open when every stage before it on the board is beaten. */
export function stageOpen(h: HistoryState, id: string): boolean {
  const i = HISTORY_STAGES.findIndex((s) => s.id === id)
  return i >= 0 && HISTORY_STAGES.slice(0, i).every((s) => h.cleared.includes(s.id))
}

/** Five retired starters, as in 传奇联赛. */
export const historyEntry = (squad: Squad): { ok: true } | { ok: false; why: string } => {
  const e = leagueEntry(squad, 'retired')
  return e.ok ? e : { ok: false, why: e.why.replace('传奇联赛', '历代强队') }
}

export interface HistoryOutcome {
  win: boolean
  /** the first win over this stage */
  firstClear: boolean
  /** the chapter this win finished, whose pack was just paid */
  chapterDone?: number
  /** this win finished the board */
  full?: boolean
  /** 退役选手包 paid by this match */
  packs: number
}

export function recordHistory(g: GachaState, stageId: string, win: boolean): HistoryOutcome {
  const h = historyState(g)
  h.tries[stageId] = (h.tries[stageId] ?? 0) + 1
  const out: HistoryOutcome = { win, firstClear: false, packs: 0 }
  if (!win || h.cleared.includes(stageId)) return out
  h.cleared.push(stageId)
  out.firstClear = true
  const st = HISTORY_STAGES.find((s) => s.id === stageId)!
  const pay = (r: { pack: PackKind; count: number }) => {
    g.packs[r.pack] = (g.packs[r.pack] ?? 0) + r.count
    out.packs += r.count
  }
  const chapter = HISTORY_STAGES.filter((s) => s.chapter === st.chapter)
  if (!h.paid.includes(st.chapter) && chapter.every((s) => h.cleared.includes(s.id))) {
    h.paid.push(st.chapter)
    out.chapterDone = st.chapter
    pay(HISTORY_CHAPTER_PACK)
  }
  if (!h.full && HISTORY_STAGES.every((s) => h.cleared.includes(s.id))) {
    h.full = true
    out.full = true
    pay(HISTORY_FULL_PACK)
  }
  note(g, `历代强队：赢了 ${st.short} ${st.team}${out.packs ? `，退役选手包 ×${out.packs}` : ''}`)
  return out
}
