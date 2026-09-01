/**
 * The long haul: whole careers, start to verdict, across many seeds.
 *
 * check_endings.ts proves the CONDITIONS are right on hand-built records.
 * This proves the ten years in between can actually be played — that the youth
 * intake keeps the world stocked, that nothing throws on the way to 2036, and
 * that every career reaches a verdict rather than an empty screen.
 *
 * It is deliberately not an assertion-per-line test; it plays the game and
 * complains about anything that looks wrong.
 *
 *     npx tsx scripts/smoke_finale.ts [seeds]
 */
import { createNewGame } from '../src/engine/world'
import { squadOf } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { Rng } from '../src/engine/rng'
import { setupSeason, advanceDay, continuePastFive, SEASON_DAYS } from '../src/engine/season'
import { endingOf, endingsFor, ENDING_COUNT, FINAL_YEAR } from '../src/engine/endings'
import { RUN_ACHIEVEMENTS, earnedNow } from '../src/engine/achievements'
import { PROSPECTS } from '../src/engine/prospects'
import { doTransfer, windowOpen } from '../src/engine/transfer'
import { contractLength, expectedSalary } from '../src/engine/player'
import type { GameState, Player } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

const SEEDS = Number(process.argv[2] ?? 6)
/**
 * With --survive the board never loses faith.
 *
 * A caretaker that never trains, never sets a tactic and never scouts gets
 * sacked around the fourth season — correctly, because it is bad at the job.
 * But that means the default run never reaches 2036 and so never exercises the
 * thing this script exists to test. --survive stands in for a manager who is
 * actually good enough to be kept: it changes nothing about the world, only
 * whether the board acts on the caretaker's results.
 */
const SURVIVE = process.argv.includes('--survive')
let bad = 0
const gripe = (m: string) => { console.log(`  ⚠️  ${m}`); bad++ }

/**
 * A caretaker manager: signs a free agent whenever the squad drops below six,
 * and nothing else.
 *
 * Without one, every career is sacked by 2029 — an unmanaged squad bleeds
 * players to expiring contracts, nobody replaces them, it plays four-a-side and
 * the board acts. That is correct behaviour, but it means an unmanaged run
 * never reaches the finale, so it cannot test the finale. This is the smallest
 * thing that keeps a career alive, and it doubles as proof that the youth pool
 * can actually be signed: most of what it finds after 2027 are prospects.
 */
function caretake(g: GameState, rng: Rng): number {
  if (!windowOpen(g.day)) return 0
  const mine = g.teams[g.myTeam]
  if (!mine || mine.roster.length >= 6) return 0
  const free = Object.values(g.players)
    .filter((p: Player) => !p.teamId && !p.retired)
    .sort((a, b) => b.overall - a.overall)
  let signed = 0
  for (const p of free) {
    if (mine.roster.length >= 6) break
    const terms = {
      salary: Math.round(expectedSalary(p) * 1.1),
      years: contractLength(p, rng, squadOf(g, g.myTeam)),
      role: 'starter' as const,
    }
    if (doTransfer(g, p, g.myTeam, 0, terms)) signed++
  }
  return signed
}

/** Hold the board where it cannot fire us, without touching anything else. */
function state_keepFaith(g: GameState): void {
  if (g.boardConfidence < 55) g.boardConfidence = 55
  g.onNotice = false
  g.missedStreak = 0
}

const TAGS = ['TYL', 'SEN', 'FNC', 'PRX', 'NRG', 'T1']
const seen = new Map<string, number>()
/** every achievement any of these careers managed to earn, and how often */
const badges = new Map<string, number>()

for (let s = 0; s < SEEDS; s++) {
  const tag = TAGS[s % TAGS.length]
  const g: GameState = createNewGame(
    WORLD_TEAMS.find((t) => t.tag === tag)!.id, `压测${s}`, 20260828 + s * 7919,
  )
  setupSeason(g)
  const rng = new Rng(90210 + s)

  let days = 0
  const cap = (FINAL_YEAR - 2026 + 2) * SEASON_DAYS + 400
  let intakeYears = 0
  let signings = 0
  let droughtFrom = 0
  let lastYear = g.year
  while (!g.gameOver && days < cap) {
    try {
      // the 2030 settlement pauses the clock; a finale smoke plays the back five
      if (g.midReview) continuePastFive(g)
      advanceDay(g, { auto: true })
    } catch (e) {
      gripe(`${tag} 第 ${g.year} 年第 ${g.day} 天抛异常：${(e as Error).message}`)
      break
    }
    days++
    // achievements are cumulative in the real game, so collect them as they
    // become true rather than only asking at the end
    if (days % 7 === 0) for (const k of earnedNow(g)) badges.set(k, (badges.get(k) ?? 0) + 1)
    if (SURVIVE) {
      state_keepFaith(g)
    }
    if (windowOpen(g.day)) {
      const n = caretake(g, rng)
      signings += n
    }
    if (g.year !== lastYear) {
      intakeYears++
      lastYear = g.year
      // the world must not run dry mid-career
      const pool = Object.values(g.players)
      const free = pool.filter((p) => !p.teamId).length
      const thin = Object.values(g.teams).filter((t) => t.roster.length < 5).length
      if (free === 0) gripe(`${tag} ${g.year} 年自由人为 0`)
      if (thin > 3) gripe(`${tag} ${g.year} 年有 ${thin} 支队伍不足 5 人`)
      // Not a gripe: everyone in the pool was born by 2009, so a world made of
      // real people simply has no teenagers left by the back half of the
      // decade. Reported so the shape of it is visible, not flagged as broken.
      const kids = pool.filter((p) => p.age <= 21).length
      if (kids === 0 && !droughtFrom) droughtFrom = g.year
    }
  }

  const earned = endingsFor(g)
  const two = endingOf(g)
  const mine = squadOf(g, g.myTeam)
  const label = `${tag} → ${g.year} 年 · ${g.finished ? '任期走完' : '中途下课'}`
    + ` · ${g.honours.length} 冠 · 结局「${earned[0]?.title ?? '无'}」`
    + ` · ${two.dynasty?.title ?? '—'}／${two.story?.title ?? '—'}`
    + `（共解锁 ${earned.length}）· 阵容 ${mine.length} 人`
    + ` · 签入 ${signings} 人（其中青训 ${mine.filter((p) => p.id.startsWith('Y')).length} 人在队）`
    + (droughtFrom ? ` · ${droughtFrom} 年起世界上再无 21 岁以下选手` : '')
  console.log(label)

  if (!g.gameOver) gripe(`${tag} 跑满 ${days} 天仍未结束`)
  if (g.finished) {
    if (g.year !== FINAL_YEAR) gripe(`${tag} 任期结束于 ${g.year}，应为 ${FINAL_YEAR}`)
    if (!earned.length) gripe(`${tag} 走完十年却没有任何结局`)
    if (mine.length < 5) gripe(`${tag} 结束时自家阵容只剩 ${mine.length} 人`)
    if (intakeYears < 5) gripe(`${tag} 只经历了 ${intakeYears} 次赛季轮转`)
  }
  for (const e of earned) seen.set(`${e.track}·${e.title}`, (seen.get(`${e.track}·${e.title}`) ?? 0) + 1)
}

console.log(`\n世界额外并入 ${PROSPECTS.length} 名真实选手（开局即自由人）`
  + (SURVIVE ? '｜董事会压力已关闭，专测十年路径' : '｜董事会照常施压'))
console.log(`${SEEDS} 段生涯里出现过的结局（共 ${ENDING_COUNT} 种）：`)
for (const [t, n] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`  ${t} ×${n}`)

console.log(`\n局内成就（共 ${RUN_ACHIEVEMENTS.length} 条）——这 ${SEEDS} 段生涯里拿到了哪些：`)
const got = RUN_ACHIEVEMENTS.filter((a) => badges.has(a.key))
const missed = RUN_ACHIEVEMENTS.filter((a) => !badges.has(a.key))
console.log('  拿到 ' + got.length + '：' + got.map((a) => a.title).join('、'))
console.log('  没拿到 ' + missed.length + '：' + missed.map((a) => `${a.title}（${a.brief}）`).join('；'))

console.log(bad ? `\n${bad} 处异常` : '\n没有异常')
process.exit(bad ? 1 : 0)
