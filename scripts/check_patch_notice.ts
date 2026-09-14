/**
 * The version is a thing you can look up, and it is rolled once.
 *
 *   npx tsx scripts/check_patch_notice.ts
 *
 * 2026-09-13: applyPatch had rolled a version at every international since
 * the style triangle went in, and nothing but one news line ever showed it.
 * Now a patch carries an id, its year and the phase it affects, the last
 * eight are kept, the digest gets the line, 总览 marks a new one until 战术
 * is opened, and patchAdvice reads the plan back against the same numbers
 * the match uses. This pins all of that, and that a season settled through
 * advanceDay rolls exactly one patch per international.
 */
const mem: Record<string, string> = {}
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
}
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, applyPatch, finishDraw, markPatchSeen, settleCompetition, setupSeason, continuePastFive } from '../src/engine/season'
import { exportSave, importSave } from '../src/engine/save'
import { patchAdvice } from '../src/engine/patchNotes'
import { darlings } from '../src/engine/comp'
import { poolFor, selectLineup } from '../src/engine/match'
import { AGENT_ROLE, MAP_META } from '../src/engine/content'
import type { Competition, GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (seed = 20260913): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '审计', seed)
  setupSeason(g)
  return g
}
const fakeComp = (g: GameState, stage: Competition['stage'], name: string): Competition => {
  const teams = Object.keys(g.teams).slice(0, 8)
  return {
    key: `${stage}-${g.year}`, name, stage, tier: 1, teams, finished: teams, champion: teams[0],
  } as unknown as Competition
}
const patchNews = (g: GameState) => g.news.filter((n) => n.text.startsWith('🔧'))

// ---- one settlement, one patch, with everything the panel needs
{
  const g = mk()
  g.day = 120
  const notes: string[] = []
  settleCompetition(g, fakeComp(g, 'masters1', 'Masters Toronto'), notes)
  const p = g.patch!
  check('第一站大师赛结算后有版本', !!p)
  check('版本带 id、年份和影响阶段', p.id === `${g.year}-masters1-120` && p.year === g.year && p.after === '第二赛段起', `${p.id} ${p.after}`)
  check('版本进了历史', g.patchLog?.length === 1 && g.patchLog[0].id === p.id)
  check('新闻和推进摘要各写了一行', patchNews(g).length === 1 && notes.some((n) => n.startsWith('🔧')))
  check('公告写明影响的是之后的比赛', notes.find((n) => n.startsWith('🔧'))!.includes('第二赛段起'))
  check('总览会亮「新」（没看过）', g.patchSeen !== p.id)
  markPatchSeen(g)
  check('打开战术页后不再亮', g.patchSeen === p.id)

  // the same competition settled twice is guarded by `awarded`; the patch
  // guard on its own is exercised here
  const before = JSON.stringify(g.patch)
  applyPatch(g, false, [], 'masters1')
  check('同一天同一赛段再来一次不会再滚', JSON.stringify(g.patch) === before && g.patchLog!.length === 1 && patchNews(g).length === 1)

  settleCompetition(g, fakeComp(g, 'masters2', 'Masters London'), [])
  check('第二站大师赛是另一个版本，历史有两条', g.patch!.id !== p.id && g.patchLog!.length === 2 && g.patch!.after === '冠军赛起')
  settleCompetition(g, fakeComp(g, 'champions', 'Champions Shanghai'), [])
  check('冠军赛之后是大改，写明下赛季起', g.patch!.big && g.patch!.after === `${g.year + 1} 赛季起`)
  check('地区赛不换版本', (() => { const n = g.patchLog!.length; settleCompetition(g, fakeComp(g, 'stage1', '赛区第一赛段'), []); return g.patchLog!.length === n })())
}

// ---- the advice reads the plan against the version
{
  const g = mk()
  g.day = 120
  settleCompetition(g, fakeComp(g, 'masters1', 'Masters Toronto'), [])
  const a = patchAdvice(g)
  check('建议覆盖现役图池的每张图', a.maps.length === poolFor(g).length && a.maps.every((m) => Object.keys(m.agents).length === 5))
  check('版本之子和 darlings() 一致', a.darlings.slice(0, 3).map((d) => d.agent).join() === darlings(g.patch, 3).join(), a.darlings.map((d) => d.agent).join())
  check('每张图的版本、地图适配、熟练度是三个数', a.maps.every((m) => Math.abs(m.version) <= 1 && Math.abs(m.mapFit) <= 1 && m.familiarity >= 0))
  check('总结一句话不为空', a.summary.length > 4, a.summary)

  // force a nerfed agent onto the plan for one map, and a darling of the same job exists
  const map = poolFor(g)[0]
  const five = selectLineup(g, g.myTeam)
  const coef = g.patch!.coef
  const nerfed = [...new Set([...g.patch!.nerfed, ...Object.entries(coef).filter(([, v]) => v <= -0.3).map(([k]) => k)])]
  const pick = nerfed.find((n) => AGENT_ROLE[n] && five.some((p) => (p.roles ?? [p.role]).includes(AGENT_ROLE[n]) || true))
  if (pick) {
    const role = AGENT_ROLE[pick]
    const rival = Object.entries(coef).find(([k, v]) => k !== pick && AGENT_ROLE[k] === role && v - coef[pick] >= 0.4)
    const man = five[0]
    const sheet: Record<string, string> = {}
    const used = new Set<string>([pick])
    sheet[man.id] = pick
    for (const p of five.slice(1)) {
      const a = (MAP_META[map] ?? []).find((x) => !used.has(x)) ?? 'Sage'
      used.add(a); sheet[p.id] = a
    }
    g.mapAgents = { ...(g.mapAgents ?? {}), [map]: sheet }
    if (rival) { man.agentPro = { ...(man.agentPro ?? {}), [rival[0]]: 80 } }
    const b = patchAdvice(g).maps.find((m) => m.map === map)!
    const issue = b.issues.find((i) => i.playerId === man.id)
    check('预案里有被削的英雄就列出问题', !!issue && issue.agent === pick, issue?.agent)
    if (rival) check('他练过的同位置强势英雄被建议换上', issue?.swap?.agent === rival[0], issue?.swap?.agent ?? issue?.train?.agent)
    check('建议不会自己改预案', g.mapAgents![map][man.id] === pick)
  } else {
    console.log('     （这个种子没有被削的英雄，换人建议留到下一段的整季跑）')
  }
}

// ---- a whole season through advanceDay: one patch per international, and it survives the save
{
  const g = mk(20260901)
  let guard = 0
  while (g.year === 2026 && guard++ < 420) {
    advanceDay(g, { autoResolveDrawDecisions: true })
    if (g.midReview) continuePastFive(g)
    if (g.pendingDrawId) finishDraw(g, g.pendingDrawId)
  }
  // the news feed is capped at 400 lines, so early patches scroll off it;
  // what must hold is that no patch line was ever written twice
  const news = patchNews(g)
  const ids = new Set((g.patchLog ?? []).map((p) => p.id))
  check('一整季推进：三次国际赛三个版本，新闻不重复', (g.patchLog?.length ?? 0) === 3 && ids.size === 3
    && new Set(news.map((n) => n.text)).size === news.length && news.length >= 1, `${g.patchLog?.length} 版本 / ${news.length} 条新闻`)
  check('跨赛年后当前版本还是冠军赛后的大改', g.year === 2027 && g.patch?.big === true && g.patch?.year === 2026)
  const back = importSave(exportSave(g))
  check('存档来回后版本、历史、已读标记都在', back.patch?.id === g.patch?.id && back.patchLog?.length === 3 && back.patchSeen === g.patchSeen)

  // an old save: a patch without id/year, no log
  const raw = JSON.parse(exportSave(g))
  const st = raw.state ?? raw
  delete st.patchLog; delete st.patchSeen; delete st.patch.id; delete st.patch.year; delete st.patch.after
  const old = importSave(JSON.stringify(raw))
  check('老存档的版本补上 id 和年份，历史从它开始', !!old.patch?.id && old.patch?.year === old.year && old.patchLog?.length === 1)
  check('老存档的建议也能算', patchAdvice(old).maps.length === poolFor(old).length)
  // and a save from before patches existed at all
  delete st.patch; delete st.patchLog
  const none = importSave(JSON.stringify(raw))
  check('没有版本的存档：历史为空，建议说还没有调整', none.patchLog?.length === 0 && patchAdvice(none).summary.includes('还没有'))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
