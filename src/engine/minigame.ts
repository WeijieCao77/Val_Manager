/**
 * 位置小游戏 — three short games, one per position, that pay a card of that
 * position.
 *
 * The card mode's day is a slot machine and a spectator seat, and the one
 * screen that asks the player to know something (每日挑战) is a quiz. These
 * ask the player to DO the thing a position does: a duelist takes the first
 * fight, so his game is reaction; an initiator brings information, so his is
 * memory of a real minimap; a sentinel holds one angle all round, so his is
 * attention. The controller's game is still being designed and is not here.
 *
 * Everything that matters runs on the server. A round is opened by the
 * server (`minigame_start`), which spends one of the day's plays and hands
 * out a seed the client never chose; the puzzle is derived from that seed on
 * both sides by the functions below; the client sends back a transcript of
 * what it did and the server judges it against the same puzzle and its own
 * clock. Reaction times shorter than a human's, a finish before the round
 * could have ended, a round left open too long — refused. The reward is a
 * pack, dealt by openPack like every other pack, from a pool that holds only
 * that position's players.
 *
 * Five plays a day across all positions (the owner's number). That is the
 * only thing capping the packs, so the packs are one card each and pay no
 * 彩卡; check_minigame.ts holds the rest of the rules.
 */
import { Rng } from './rng'
import type { Role } from './types'
import { RECON_WINDOWS } from './minimapSpots'
import type { ReconWindow } from './minimapSpots'

export type MiniGame = 'aim' | 'recon' | 'schulte'
export const MINI_GAMES: readonly MiniGame[] = ['aim', 'recon', 'schulte']
export const MINI_ROLE: Record<MiniGame, Role> = { aim: '决斗者', recon: '先锋', schulte: '哨卫' }
export const MINI_CN: Record<MiniGame, string> = { aim: '首杀反应', recon: '侦察报点', schulte: '舒尔特方格' }
export type Tier = '金' | '银' | '铜'

/** plays a day, shared across the positions — one game five times or spread out */
export const MINIGAME_DAILY = 5
/** a round left open this long is dead; the play it spent is not refunded */
export const MINIGAME_TTL_MS = 10 * 60 * 1000
/** coins alongside the pack (金), or instead of one (铜) */
export const MINI_COINS: Record<Tier, number> = { 金: 200, 银: 0, 铜: 80 }
/** which tiers pay the position pack */
export const MINI_PAYS_PACK: Record<Tier, boolean> = { 金: true, 银: true, 铜: false }
/** no human presses twice this fast; a transcript that does is not a human's */
export const MIN_STEP_MS = 120

export interface MinigameLive { game: MiniGame; seed: number; startedAt: number }
export interface MinigameState {
  /** the server date the counter belongs to */
  day: string | null
  plays: number
  live: MinigameLive | null
  /** packs paid out, lifetime */
  won: number
  /** best score per game, for the screen */
  best: Partial<Record<MiniGame, number>>
}
export const newMinigame = (): MinigameState => ({ day: null, plays: 0, live: null, won: 0, best: {} })
export function refreshMinigame(m: MinigameState, today: string): void {
  if (m.day !== today) { m.day = today; m.plays = 0 }
}

export type Verdict =
  | { ok: true; tier: Tier; score: number; summary: string; detail: Record<string, number> }
  | { ok: false; why: string }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// ---------------------------------------------------------------- 哨卫 · 舒尔特方格
export const SCHULTE_N = 25
export const SCHULTE_PENALTY_MS = 500
export const SCHULTE_GOLD_MS = 25_000
export const SCHULTE_SILVER_MS = 35_000
/** the 25 numbers in grid order; dealt at start, so nothing can be memorised beforehand */
export const schulteOrder = (seed: number): number[] =>
  new Rng((seed ^ 0x5c4e) >>> 0).shuffle(Array.from({ length: SCHULTE_N }, (_, i) => i + 1))

export function judgeSchulte(t: unknown, elapsedMs: number): Verdict {
  const tr = (t ?? {}) as { taps?: unknown; wrong?: unknown }
  const taps = Array.isArray(tr.taps) ? tr.taps.map(num) : null
  if (!taps || taps.length !== SCHULTE_N || taps.some((x) => x == null || x < 0)) return { ok: false, why: '记录不完整' }
  const ts = taps as number[]
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] < MIN_STEP_MS) return { ok: false, why: '有一步快得不像人' }
  const wrong = Math.max(0, Math.min(200, Math.round(num(tr.wrong) ?? 0)))
  const last = ts[ts.length - 1]
  if (last > elapsedMs + 2000) return { ok: false, why: '记录的时间比服务器的钟还快' }
  if (last > 5 * 60_000) return { ok: false, why: '这局放太久了' }
  const ms = last + wrong * SCHULTE_PENALTY_MS
  const tier: Tier = ms <= SCHULTE_GOLD_MS ? '金' : ms <= SCHULTE_SILVER_MS ? '银' : '铜'
  const score = Math.max(0, Math.min(100, Math.round(100 - (ms - 15_000) / 300)))
  return {
    ok: true, tier, score,
    summary: `${(ms / 1000).toFixed(1)} 秒完成${wrong ? `（含 ${wrong} 次点错的罚时）` : ''}`,
    detail: { ms, wrong },
  }
}

// ---------------------------------------------------------------- 决斗者 · 首杀反应
export const AIM_ROUND_MS = 20_000
export const AIM_UP_MS = 900
export interface AimTarget { at: number; x: number; y: number }
/** when and where each target lights up; the client only reports what it hit */
export function aimSchedule(seed: number): AimTarget[] {
  const rng = new Rng((seed ^ 0xa1a1) >>> 0)
  const out: AimTarget[] = []
  let t = 800
  while (t + AIM_UP_MS <= AIM_ROUND_MS) {
    out.push({ at: t, x: 0.06 + rng.next() * 0.82, y: 0.06 + rng.next() * 0.78 })
    t += AIM_UP_MS + 200 + Math.round(rng.next() * 450)
  }
  return out
}
export function judgeAim(seed: number, t: unknown, elapsedMs: number): Verdict {
  const targets = aimSchedule(seed)
  const tr = (t ?? {}) as { hits?: unknown }
  if (!Array.isArray(tr.hits) || tr.hits.length !== targets.length) return { ok: false, why: '记录不完整' }
  if (elapsedMs < AIM_ROUND_MS - 1500) return { ok: false, why: '这局还没到时间就结束了' }
  const react: number[] = []
  for (const h of tr.hits) {
    if (h == null) continue
    const r = num(h)
    if (r == null || r > AIM_UP_MS) return { ok: false, why: '记录对不上靶子' }
    if (r < MIN_STEP_MS) return { ok: false, why: '有一枪快得不像人' }
    react.push(r)
  }
  const hits = react.length, misses = targets.length - hits
  const rate = hits / targets.length
  const avg = hits ? react.reduce((a, b) => a + b, 0) / hits : AIM_UP_MS
  const tier: Tier = rate >= 0.75 && avg <= 380 ? '金' : rate >= 0.6 && avg <= 480 ? '银' : '铜'
  const score = Math.max(0, Math.round(rate * 60 + Math.max(0, (700 - avg) / 500) * 40))
  return {
    ok: true, tier, score,
    summary: `${hits} 个首杀 / ${misses} 次被首杀，平均反应 ${Math.round(avg)} ms`,
    detail: { hits, misses, avg: Math.round(avg) },
  }
}

// ---------------------------------------------------------------- 先锋 · 侦察报点
export const RECON_N = 4
export const RECON_SHOW_MS = 1000
export const RECON_GAP_MS = 260
/** two men never stand closer than this, in minimap fractions */
export const RECON_SEP = 0.09
/** one whole minimap width in metres, from Riot's own scale (100 units ≈ 1 m) */
export const METRES_PER_MAP: Record<ReconWindow['map'], number> = {
  ascent: 1 / 7.0e-5 / 100, bind: 1 / 5.9e-5 / 100, haven: 1 / 7.5e-5 / 100,
}
export const RECON_MAP_CN: Record<ReconWindow['map'], string> = {
  ascent: 'Ascent 亚海悬城', bind: 'Bind 源工重镇', haven: 'Haven 隐世修所',
}
export interface ReconPuzzle { window: ReconWindow; windowIndex: number; enemies: { x: number; y: number }[] }
export function reconPuzzle(seed: number): ReconPuzzle {
  const rng = new Rng((seed ^ 0x5eed) >>> 0)
  const windowIndex = rng.int(0, RECON_WINDOWS.length - 1)
  const window = RECON_WINDOWS[windowIndex]
  const enemies: { x: number; y: number }[] = []
  for (const [x, y] of rng.shuffle(window.spots.slice())) {
    if (enemies.every((e) => Math.hypot(e.x - x, e.y - y) >= RECON_SEP)) enemies.push({ x, y })
    if (enemies.length === RECON_N) break
  }
  return { window, windowIndex, enemies }
}
const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((v, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [v, ...p])))
export function judgeRecon(seed: number, t: unknown, elapsedMs: number): Verdict {
  const { window, enemies } = reconPuzzle(seed)
  const tr = (t ?? {}) as { marks?: unknown }
  if (!Array.isArray(tr.marks) || tr.marks.length !== RECON_N) return { ok: false, why: '记录不完整' }
  const marks: { x: number; y: number }[] = []
  for (const m of tr.marks) {
    const x = num((m as unknown[])?.[0]), y = num((m as unknown[])?.[1])
    if (x == null || y == null || x < window.x - 0.01 || x > window.x + window.s + 0.01 || y < window.y - 0.01 || y > window.y + window.s + 0.01) return { ok: false, why: '标记不在这块地图上' }
    marks.push({ x, y })
  }
  if (elapsedMs < RECON_N * (RECON_SHOW_MS + RECON_GAP_MS) - 500) return { ok: false, why: '人还没亮完就报点了' }
  const mpm = METRES_PER_MAP[window.map]
  let best: { sum: number; d: number[] } | null = null
  for (const p of perms([0, 1, 2, 3])) {
    const d = p.map((mi, ei) => Math.hypot(enemies[ei].x - marks[mi].x, enemies[ei].y - marks[mi].y) * mpm)
    const sum = d.reduce((a, b) => a + b, 0)
    if (!best || sum < best.sum) best = { sum, d }
  }
  const avg = best!.sum / RECON_N
  const exact = best!.d.filter((d) => d <= 3).length
  const tier: Tier = avg <= 4 ? '金' : avg <= 8 ? '银' : '铜'
  const score = Math.round(best!.d.reduce((s, d) => s + Math.min(1, Math.max(0, (15 - d) / 12)), 0) / RECON_N * 100)
  return {
    ok: true, tier, score,
    summary: `平均误差 ${avg.toFixed(1)} 米，${exact} 个报在 3 米内`,
    detail: { avg: Math.round(avg * 10) / 10, exact },
  }
}

/** The server's judgement of a finished round. */
export function judgeMinigame(game: MiniGame, seed: number, transcript: unknown, elapsedMs: number): Verdict {
  if (game === 'schulte') return judgeSchulte(transcript, elapsedMs)
  if (game === 'aim') return judgeAim(seed, transcript, elapsedMs)
  return judgeRecon(seed, transcript, elapsedMs)
}
