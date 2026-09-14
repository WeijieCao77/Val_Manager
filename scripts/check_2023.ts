/**
 * 2023 plays like 2023.
 *
 *   npx tsx scripts/check_2023.ts
 *
 * A career started in 2023 (world_2023.json, rulebook vct-2023): LOCK//IN
 * in São Paulo with every league side and two Chinese clubs in one 32-team
 * bracket, three leagues of ten playing a single round robin, China's
 * domestic circuit, Masters Tokyo with twelve (3/4/3/2), a Last Chance
 * Qualifier per league and a Chinese qualifier for Champions, Champions in
 * Los Angeles with sixteen; no Kickoff groups, no Masters I, no Stage 2
 * league. The whole season runs through advanceDay to 2024.
 */
const mem: Record<string, string> = {}
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
}
import { readFileSync } from 'node:fs'
import { createNewGame } from '../src/engine/world'
import { advanceDay, finishDraw, setupSeason, continuePastFive, dateLabel } from '../src/engine/season'
import { stagesOf, stageAtIn } from '../src/engine/rulebook'
import { createManager } from '../src/engine/manager'
import { agentAvailable } from '../src/engine/eras'
import type { RawWorld } from '../src/engine/eras'
import { REGIONS } from '../src/engine/types'
import type { GameState } from '../src/engine/types'
import { exportSave, importSave } from '../src/engine/save'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const w = JSON.parse(readFileSync('src/data/world_2023.json', 'utf8')) as RawWorld
const t1 = w.teams.filter((t) => t.tier === 1)
check('四个赛区各十支一级队（中国是进化赛的十支）', REGIONS.every((r) => t1.filter((t) => t.region === r).length === 10))
const club = t1.find((t) => t.tag === 'FNC') ?? t1[0]
const g: GameState = createNewGame(club.id, '审计', 20260914, createManager('审计', 30, 'expro'), { world: w, year: 2023 })
setupSeason(g)
g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
check('2023 档用 vct-2023 规则集', g.rulesetId === 'vct-2023' && g.year === 2023)
const stages = stagesOf(g).map((s) => s.key)
check('日历：季前、LOCK//IN、联赛、Masters、LCQ、Champions、休赛期，没有 Masters I 和 Stage 2', stages.join() === 'preseason,kickoff,stage1,masters2,stage2,champions,offseason', stages.join())
check('日历铺满一年', stagesOf(g).every((s, i, a) => i === 0 || s.start === a[i - 1].end + 1) && stagesOf(g)[0].start === 0 && stagesOf(g).at(-1)!.end === 363)
const lockin = g.comps.kickoff
check('LOCK//IN 是一个 32 队的单败签表，在圣保罗', !!lockin && lockin.teams.length === 32 && lockin.city === '圣保罗' && !lockin.region, `${lockin?.teams.length}`)
check('LOCK//IN 第一轮 16 场', g.fixtures.filter((f) => f.comp === 'kickoff').length === 16)
check('没有分赛区的 Kickoff', !REGIONS.some((r) => g.comps[`kickoff:${r}`]))
for (const r of REGIONS) {
  const s1 = g.comps[`stage1:${r}`]
  const rounds = new Set(g.fixtures.filter((f) => f.comp === `stage1:${r}` && !f.label.startsWith('KO:')).map((f) => f.label)).size
  check(`${r} 联赛十队、单循环 9 轮${r === 'China' ? '（中国进化赛）' : ''}`, !!s1 && s1.teams.length === 10 && rounds === 9, `${s1?.teams.length} 队 ${rounds} 轮 ${s1?.name}`)
}
check('没有 Stage 2 联赛', !REGIONS.some((r) => g.comps[`stage2:${r}`]))
check('开档时 Gekko 还没上线，Harbor 已有', !agentAvailable(g, 'Gekko') && agentAvailable(g, 'Harbor'))
check('顶栏日期 2023 年 1 月', dateLabel(g).startsWith('2023年1月'))

// the season
let guard = 0
const seen = new Set<string>()
let lockinChamp: string | undefined
let lockinDepth = 0
while (g.year === 2023 && guard++ < 420) {
  advanceDay(g, { autoResolveDrawDecisions: true })
  seen.add(g.stage)
  if (g.comps.kickoff?.champion && !lockinChamp) { lockinChamp = g.comps.kickoff.champion; lockinDepth = g.comps.kickoff.finished.length }
  if (g.midReview) continuePastFive(g)
  if (g.pendingDrawId) finishDraw(g, g.pendingDrawId)
}
check('一整季推进到 2024', g.year === 2024, `${g.year} day ${g.day}`)
check('经过的赛段没有 Masters I', !seen.has('masters1') && seen.has('masters2') && seen.has('champions'))
// the comps of the season just played were cleared by setupSeason; read the record
const news = g.news.map((n) => n.text)
check('LOCK//IN 决出冠军，32 队排满名次', !!lockinChamp && lockinDepth === 32, `${lockinChamp} depth ${lockinDepth}`)
check('Masters（东京）有 12 队', news.some((n) => /Masters II（东京）参赛名单/.test(n)), news.find((n) => /Masters II（/.test(n))?.slice(0, 60))
check('每个赛区都有 LCQ，中国有资格赛', news.filter((n) => /LCQ名单|冠军赛中国资格赛名单/.test(n)).length === 4, String(news.filter((n) => /LCQ名单|资格赛名单/.test(n)).length))
check('Champions（洛杉矶）办了', news.some((n) => /VALORANT Champions（洛杉矶）/.test(n)))
check('三次版本更替：LOCK//IN 不算，东京和洛杉矶各一次', (g.patchLog?.length ?? 0) === 2, String(g.patchLog?.length))
const back = importSave(exportSave(g))
check('读档后规则集不变', back.rulesetId === 'vct-2023' && stageAtIn(back, 30) === 'kickoff')
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
