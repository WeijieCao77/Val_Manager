/**
 * Two verdicts, and conditions that can actually be reached.
 *
 * Every ending is judged off the save's own record — honours, tenures, the
 * squad — never off a flag written when something happened, so an imported
 * save gets the same answer as one played straight through. These build the
 * record by hand and check the answer.
 *
 * The trophy line is built on the season the game really runs: three
 * international events a year, so a 全冠年 is Masters I + Masters II +
 * Champions, and 黄金之路 is three of those in a row. The exact strings matter
 * — they are what settleCompetition writes into `honours` — so the ones used
 * here are asserted against the engine's own list rather than retyped.
 *
 *     npx tsx scripts/check_endings.ts
 */
// Titles come from the constant, never a literal: this file used to spell
// Champions its own way, matching a copy in endings.ts that the season never
// awarded — so the test and the code agreed and both were wrong.
import { createNewGame, WORLD_TEAMS, squadOf } from '../src/engine/world'
import { setupSeason, advanceDay, moveToClub } from '../src/engine/season'
import {
  DYNASTY_ENDINGS, ENDING_COUNT, ENDINGS, endingOf, endingsFor, factsOf,
  CHAMPIONS, FINAL_YEAR, INTL_TITLES, STORY_ENDINGS,
} from '../src/engine/endings'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (tag = 'TYL'): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === tag)!.id, '审计', 20260828)
  setupSeason(g)
  g.year = FINAL_YEAR
  g.finished = true
  return g
}
const won = (g: GameState, year: number, title: string) => g.honours.push({ year, title })
/** A clean sweep of a year's three international events. */
const perfect = (g: GameState, year: number) => {
  for (const t of INTL_TITLES) won(g, year, t)
}
const has = (g: GameState, key: string) => endingsFor(g).some((e) => e.key === key)

// ---- the catalogue is well-formed
{
  const keys = ENDINGS.map((e) => e.key)
  check('结局 key 不重复', new Set(keys).size === keys.length)
  check('两条线都有内容',
    DYNASTY_ENDINGS.length > 0 && STORY_ENDINGS.length > 0,
    `王朝 ${DYNASTY_ENDINGS.length}，故事 ${STORY_ENDINGS.length}，共 ${ENDING_COUNT}`)
  check('每个结局都有标题和条件说明',
    ENDINGS.every((e) => e.title.length > 0 && e.brief.length > 0))
  // each track must end in a catch-all, or a career can finish and be told nothing
  const blank = mk()
  const two = endingOf(blank)
  check('哪怕一无所获也有两个结局', !!two.dynasty && !!two.story,
    `${two.dynasty?.title} ／ ${two.story?.title}`)
}

// ---- no ending is unconditional, and none contradicts another
{
  // Written as `() => true` fallbacks, 「空手而归」 and 「来过」 unlocked for
  // everybody — a nine-title dynasty was told it had also finished empty-handed.
  const rich = mk()
  perfect(rich, FINAL_YEAR - 1); perfect(rich, FINAL_YEAR)
  const got = endingsFor(rich).map((e) => e.key)
  check('夺冠的生涯不会同时解锁「空手而归」', !got.includes('nothing'), got.join('、'))
  check('也不会同时解锁「有过高光」', !got.includes('silverware'))
  check('走完十年不会同时解锁「来过」', !got.includes('shortStay'))

  // and the two tracks still always resolve, at both extremes
  for (const [label, g] of [['一无所获', mk()], ['满贯', rich]] as const) {
    const two = endingOf(g)
    check(`${label}的生涯仍然两条线都有结局`, !!two.dynasty && !!two.story,
      `${two.dynasty?.title} ／ ${two.story?.title}`)
  }
}

// ---- 全冠年 is the three international events, and nothing else counts
{
  const g = mk()
  won(g, 2030, 'Masters I')
  won(g, 2030, 'Masters II')
  check('只拿两站大师赛不算全冠年', !has(g, 'perfectYear'), `全冠 ${factsOf(g).perfectYears.length} 年`)
  won(g, 2030, CHAMPIONS)
  check('补上冠军赛才是全冠年', has(g, 'perfectYear'))

  // and a regional title cannot stand in for one of them
  const h = mk()
  won(h, 2030, 'Masters I')
  won(h, 2030, 'Masters II')
  won(h, 2030, 'VCT China · Stage 1')
  check('赛区冠军不能顶替冠军赛', !has(h, 'perfectYear'))
}

// ---- 黄金之路 is three perfect years running: nine titles, none dropped
{
  const g = mk()
  perfect(g, 2030); perfect(g, 2031); perfect(g, 2032)
  check('连续三个全冠年 →「黄金之路」', has(g, 'golden'),
    `${g.honours.length} 冠，连续 ${factsOf(g).perfectStreak} 年`)
  check('九座国际冠军', g.honours.length === 9)

  const gap = mk()
  perfect(gap, 2030); perfect(gap, 2031); perfect(gap, 2033)
  check('中间断了一年就不算', !has(gap, 'golden'), `最长连续 ${factsOf(gap).perfectStreak} 年`)

  const five = mk()
  for (const y of [2030, 2031, 2032, 2033, 2034]) perfect(five, y)
  check('连续五个全冠年 →「不朽」', has(five, 'immortal'))
  check('「不朽」排在「黄金之路」前面', endingOf(five).dynasty?.key === 'immortal')
}

// ---- the Champions streak line
{
  const g = mk()
  won(g, 2030, CHAMPIONS); won(g, 2031, CHAMPIONS)
  check('连续两年冠军赛 →「卫冕」', has(g, 'defend'))
  won(g, 2032, CHAMPIONS)
  check('连续三年 →「三连霸」', has(g, 'threePeat'))
  won(g, 2033, CHAMPIONS); won(g, 2034, CHAMPIONS)
  check('连续五年 →「五连霸」', has(g, 'fivePeat'))
  check('五连霸压过三连霸', endingOf(g).dynasty?.key === 'fivePeat')
}

// ---- 大师 is for the nearly-man: internationals, but never the big one
{
  const g = mk()
  won(g, 2030, 'Masters I'); won(g, 2032, 'Masters II')
  check('只拿大师赛 →「大师」', endingOf(g).dynasty?.key === 'masterOnly')
  won(g, 2033, CHAMPIONS)
  check('拿到冠军赛之后就不再是「大师」', !has(g, 'masterOnly'))
}

// ---- 乐极生悲: a fall, not merely an absence
{
  const g = mk()
  won(g, 2030, CHAMPIONS); won(g, 2031, CHAMPIONS)
  g.year = 2033
  check('连冠之后颗粒无收 →「乐极生悲」', has(g, 'icarus'))

  const one = mk()
  won(one, 2030, CHAMPIONS)
  one.year = 2033
  check('只拿过一次冠军不算「乐极生悲」', !has(one, 'icarus'))

  const still = mk()
  won(still, 2030, CHAMPIONS); won(still, 2031, CHAMPIONS)
  won(still, 2033, 'VCT China · Stage 1')
  still.year = 2034
  check('之后还有进账就不算', !has(still, 'icarus'))
}

// ---- 本土主义 counts imports by passport, not by the region field
{
  const g = mk()
  won(g, 2030, CHAMPIONS)
  const me = g.teams[g.myTeam]!
  // isImport reads NATIONALITY first and only falls back to region, so a
  // homegrown squad has to be homegrown by passport
  for (const p of squadOf(g, g.myTeam)) { p.region = me.region; p.nat = undefined }
  check('全本土夺冠 →「本土主义」', has(g, 'homegrown'), `外援 ${factsOf(g).imports} 人`)
  squadOf(g, g.myTeam)[0]!.nat = me.region === 'EMEA' ? 'kr' : 'fr'
  check('签一个外援就没了', !has(g, 'homegrown'), `外援 ${factsOf(g).imports} 人`)
}

// ---- the two tracks are independent: you get one of each
{
  // The sweep runs to the final year on purpose: leave a gap after it and
  // 「乐极生悲」 correctly takes the story slot, which is a different test.
  const g = mk()
  perfect(g, FINAL_YEAR - 2); perfect(g, FINAL_YEAR - 1); perfect(g, FINAL_YEAR)
  const me = g.teams[g.myTeam]!
  for (const p of squadOf(g, g.myTeam)) { p.region = me.region; p.nat = undefined }
  const two = endingOf(g)
  check('战绩线给出「黄金之路」', two.dynasty?.key === 'golden')
  check('同一段生涯的故事线另有其人', two.story?.key === 'homegrown',
    `${two.story?.title}`)
  check('两个结局分属不同的线', two.dynasty?.track !== two.story?.track)
}

// ---- 判定发生在休赛期之前：结算的是刚打完最后一季的那支队，不是散伙后的残部
{
  const g = mk()
  won(g, FINAL_YEAR, CHAMPIONS)
  g.finished = false
  const me = g.teams[g.myTeam]!
  const squad = squadOf(g, g.myTeam)
  // A deal that ran out LAST winter: the managed club gets one year of grace,
  // so `contractYears = 1` would only put him on notice, not out the door.
  for (const p of squad) {
    p.contractYears = 0
    p.expiredYear = FINAL_YEAR - 1
    p.region = me.region
    p.nat = undefined
  }
  squad[0]!.nat = me.region === 'EMEA' ? 'kr' : 'fr'
  const before = squad.length

  g.day = 0
  g.boardConfidence = 80
  let guard = 0
  while (!g.gameOver && guard++ < 500) { g.onNotice = false; advanceDay(g) }

  const after = squadOf(g, g.myTeam)
  check('结局判定时阵容还没散', after.length >= before - 1,
    `赛季末 ${before} 人，判定时 ${after.length} 人`)
  check('刚到期的外援仍然算数——「本土主义」不会白送',
    !has(g, 'homegrown'), `外援 ${factsOf(g).imports} 人`)
}

// ---- 换俱乐部之后，「接手时的阵容」指的是这家俱乐部
{
  // startingSquad was written once at world creation and moveToClub never
  // touched it, so the moment you changed jobs nobody on the new team was on
  // that list: 「推倒重来」 and the 大换血 badge fired for free, and
  // 「一起走到最后」 became impossible.
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260828)
  setupSeason(g)
  const other = WORLD_TEAMS.find((t) => t.tier === 1 && t.id !== g.myTeam)!
  moveToClub(g, other.id)
  const here = new Set(squadOf(g, g.myTeam).map((p) => p.id))
  check('换队后 startingSquad 指向新东家的阵容',
    (g.startingSquad ?? []).length > 0 && (g.startingSquad ?? []).every((id) => here.has(id)),
    `${(g.startingSquad ?? []).length} 人`)

  g.year = FINAL_YEAR
  g.finished = true
  won(g, 2035, CHAMPIONS)
  check('刚换队不会白送「推倒重来」', !has(g, 'rebuild'))
  check('而「一起走到最后」仍然成立', has(g, 'loyal'))
}

// ---- 「草根」看的是你接手那天的级别，不是现在的
{
  // Ascension sets team.tier = 1, so reading the club's current tier erased
  // the very thing the ending is about: a manager who took a second-division
  // side up and then won the region read back as having started in the first.
  const low = WORLD_TEAMS.find((t) => t.tier === 2)!
  const g = createNewGame(low.id, '审计', 20260828)
  setupSeason(g)
  check('接手次级队时记下了级别', g.startTier === 2, String(g.startTier))
  g.teams[g.myTeam]!.tier = 1                    // 晋级
  g.year = FINAL_YEAR
  g.finished = true
  won(g, 2035, `VCT ${g.teams[g.myTeam]!.region} · Stage 1`)
  check('升上去之后仍然算「从次级起步」', has(g, 'grassroots'))
}

// ---- 十年真的会结束，而不是无限跑下去
{
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260828)
  setupSeason(g)
  let guard = 0
  while (!g.gameOver && guard++ < 4200) {
    g.boardConfidence = 80          // 不让解雇提前结束，这里测的是十年到期
    g.onNotice = false
    advanceDay(g)
  }
  check('十个赛季之后生涯自动结束', !!g.finished, `${g.year} 年：${g.gameOver ?? '仍在进行'}`)
  check('结束于最后一个赛季', g.year === FINAL_YEAR, String(g.year))
  const two = endingOf(g)
  check('并且给出了两个结局', !!two.dynasty && !!two.story,
    `${two.dynasty?.title} ／ ${two.story?.title}`)
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
