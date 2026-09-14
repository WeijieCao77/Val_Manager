/**
 * The auto plan never recommends what cannot grow, and says why.
 *
 *   npx tsx scripts/check_training_advice.ts
 *
 * 2026-09-13, from a player: 「枪法已经练满，但点自动推荐仍然推荐练枪法」.
 * The recommendation excluded attributes at 97 and above while the engine
 * trained them to 99, so a duelist on 98 aim was sent to... whatever the
 * second weight was, or rested, depending on which screen you read. Now one
 * number (ATTR_MAX) is read by the advice, the weekly gain and the winter
 * growth, the advice carries its reason, and a hand-picked focus on a full
 * attribute banks nothing.
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
import { advanceDay, setupSeason } from '../src/engine/season'
import { importSave, exportSave } from '../src/engine/save'
import { squadOf } from '../src/engine/roster'
import { AI_POLISH_STOP, ATTR_MAX, REST_AT, aiTrainingFocus, recommendedTrainingFocus, trainingAdvice, weeklyTick } from '../src/engine/training'
import { ATTR_KEYS } from '../src/engine/types'
import type { Attrs, GameState, Player } from '../src/engine/types'
import { Rng } from '../src/engine/rng'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260826)
  setupSeason(g)
  return g
}
const g = mk()
const squad = squadOf(g, g.myTeam)
const base = squad[0]
const attrsAll = (v: number): Attrs => Object.fromEntries(ATTR_KEYS.map((k) => [k, v])) as Attrs
const fit = (over: Partial<Player>): Player => ({
  ...base, fatigue: 10, injuredUntil: 0, potential: 95, overall: 80, attrs: attrsAll(70), isIgl: false, ...over,
})

// ---- the report: 枪法 full, the rest not
{
  const p = fit({ role: '决斗者', attrs: { ...attrsAll(70), aim: ATTR_MAX } })
  const a = trainingAdvice(p)
  check('决斗者枪法 99：不再推荐枪法', a.focus !== 'aim', a.focus)
  check('改推荐权重次之的反应', a.focus === 'reaction', a.focus)
  check('理由写明枪法已满、改练什么', /枪法已到 99/.test(a.reason) && /反应/.test(a.reason), a.reason)
  const q = fit({ role: '决斗者', attrs: { ...attrsAll(70), aim: 98 } })
  check('枪法 98 还能涨一点，照旧推荐枪法（97 那条线没了）', trainingAdvice(q).focus === 'aim')
}

// ---- nothing left to grow, potential full, tired, hurt
{
  const p = fit({ attrs: attrsAll(ATTR_MAX) })
  const a = trainingAdvice(p)
  check('全部属性 99：休息，理由是保状态', a.focus === 'rest' && a.kind === 'hold', a.reason)
  const c = fit({ potential: 80, overall: 80 })
  const b = trainingAdvice(c)
  check('总评到潜力：休息保状态，理由说到上限', b.focus === 'rest' && b.kind === 'hold' && /潜力上限/.test(b.reason), b.reason)
  const t = fit({ fatigue: REST_AT })
  const d = trainingAdvice(t)
  check('疲劳到线：休息恢复，理由带数字', d.focus === 'rest' && d.kind === 'recover' && /疲劳 45，到 45/.test(d.reason), d.reason)
  const h = fit({ injuredUntil: 20 })
  check('受伤（带日历）：休息恢复', trainingAdvice(h, 5).kind === 'recover' && /伤/.test(trainingAdvice(h, 5).reason))
  check('受伤但不带日历（AI 周循环自己跳过伤员）：按属性给', trainingAdvice(h).kind === 'grow')
  check('疲劳排在潜力前面：又累又满先说累', trainingAdvice(fit({ fatigue: 60, potential: 80, overall: 80 })).kind === 'recover')
}

// ---- positions and the caller
{
  const roles = ['决斗者', '先锋', '控场', '哨卫', '自由人'] as const
  const picks = roles.map((role) => trainingAdvice(fit({ role })).focus)
  check('五个位置各有自己的首选', picks[0] === 'aim' && picks[1] !== 'aim' && picks[2] === 'utility' && picks[3] === 'awareness', picks.join(','))
  const igl = fit({ isIgl: true, attrs: { ...attrsAll(ATTR_MAX), igl: 60 } })
  check('指挥只剩指挥能练时推荐指挥', trainingAdvice(igl).focus === 'igl')
  const not = fit({ isIgl: false, attrs: { ...attrsAll(ATTR_MAX), igl: 60 } })
  check('非指挥的指挥不算可练项：休息', trainingAdvice(not).focus === 'rest')
  check('recommendedTrainingFocus 就是 advice.focus', roles.every((role) => recommendedTrainingFocus(fit({ role })) === trainingAdvice(fit({ role })).focus))
}

// ---- a hand-picked full attribute banks nothing; the AI follows the same rule
{
  const h = mk()
  const p = squadOf(h, h.myTeam)[0]
  p.attrs.aim = ATTR_MAX; p.potential = 99; p.fatigue = 0; p.xp = {}
  h.training[p.id] = 'aim'
  weeklyTick(h, new Rng(3))
  check('手动练已满的枪法：进度条不动、枪法不涨', (p.xp.aim ?? 0) === 0 && p.attrs.aim === ATTR_MAX, `xp ${p.xp.aim}`)
  check('手动选择没被推进覆盖', h.training[p.id] === 'aim')
  const ai = Object.values(h.teams).find((t) => t.id !== h.myTeam)!
  const q = h.players[ai.roster[0]]
  q.attrs = { ...attrsAll(70), aim: ATTR_MAX }; q.role = '决斗者'; q.potential = 95; q.overall = 80; q.fatigue = 0
  weeklyTick(h, new Rng(4))
  check('AI 俱乐部的计划也不会落在已满的属性上', h.training[q.id] !== 'aim' && h.training[q.id] !== 'rest', String(h.training[q.id]))
  // AI clubs stop polishing at 97 — the line their ten-season balance was tuned on — while the manager's club reads 99
  const s = fit({ role: '决斗者', attrs: { ...attrsAll(70), aim: AI_POLISH_STOP } })
  check(`AI 的同一套判断在 ${AI_POLISH_STOP} 停手，经理自己的队到 ${ATTR_MAX}`, aiTrainingFocus(s) !== 'aim' && trainingAdvice(s).focus === 'aim')
}

// ---- an old save with fields missing still gets advice
{
  const raw = JSON.parse(exportSave(mk()))
  const st = raw.state ?? raw
  for (const p of Object.values(st.players) as Partial<Player>[]) { delete p.xp; delete p.isIgl; delete p.roles }
  const old = importSave(JSON.stringify(raw))
  const p = squadOf(old, old.myTeam)[0]
  const a = trainingAdvice(p, old.day)
  check('旧存档缺 xp/isIgl：照样给出建议和理由', !!a.focus && a.reason.length > 4, a.reason)
  let threw = false
  try { for (let i = 0; i < 8; i++) advanceDay(old, { autoResolveDrawDecisions: true }) } catch { threw = true }
  check('旧存档推进一周不报错', !threw)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
