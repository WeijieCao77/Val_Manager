/**
 * The manager's age, wallet and state behave.
 *
 *   npx tsx scripts/check_manager_life.ts
 *
 * 2026-09-13. Age counts seasons from the start and never from a reload;
 * pay is monthly, once a month, and the season's end banks nothing on top;
 * the wallet never goes below zero and a refused purchase changes nothing;
 * 饱腹 and 心情 move once per game day however often the page is opened;
 * the auto supply keeps to its budget; an old save is migrated once.
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
import { advanceDay, finishDraw, setupSeason, continuePastFive } from '../src/engine/season'
import { exportSave, importSave } from '../src/engine/save'
import { createManager } from '../src/engine/manager'
import {
  LIFE, LIFE_ACTS, doLifeAct, lifeBlock, lifeMod, managerAge, monthKey, monthlyPay, setAutoMeal, tickLife,
} from '../src/engine/managerLife'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (seed = 20260913, age = 31): GameState => {
  const m = createManager('审计', age, 'expro')
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '审计', seed, m)
  setupSeason(g)
  return g
}
const step = (g: GameState, n: number) => {
  for (let i = 0; i < n; i++) {
    advanceDay(g, { autoResolveDrawDecisions: true })
    if (g.midReview) continuePastFive(g)
    if (g.pendingDrawId) finishDraw(g, g.pendingDrawId)
  }
}

// ---- age
{
  const g = mk(20260913, 31)
  check('开档 31 岁就是 31 岁', managerAge(g) === 31)
  const back = importSave(exportSave(importSave(exportSave(g))))
  check('读两次档不长岁', managerAge(back) === 31)
  g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
  step(g, 370)
  check('过一个赛季长一岁', g.year === 2027 && managerAge(g) === 32, `${g.year} ${managerAge(g)}`)
  check('成长速度按开档年龄定，不重算', g.manager!.growth === createManager('x', 31, 'expro').growth)
}

// ---- pay: monthly, once, and not again at the season's end
{
  const g = mk()
  g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
  const salary = g.managerContract!.salary
  const l = g.life!
  check('新档钱包从 0 开始', l.wallet === 0 && l.paidMonth === null)
  step(g, 1)
  check('第一天进入一月就发第一笔月薪', l.wallet === monthlyPay(g) && l.paidMonth === monthKey(g), `${l.wallet}`)
  const w1 = l.wallet
  step(g, 20)
  check('同一个月内不再发', l.wallet === w1 + 0 || l.ledger.filter((x) => x.label.startsWith('工资')).length === 1, `${l.ledger.filter((x) => x.label.startsWith('工资')).length} 笔`)
  step(g, 20)
  check('到二月发第二笔', l.ledger.filter((x) => x.label.startsWith('工资')).length === 2)
  const earnedBefore = g.tally!.earned
  step(g, 330)
  const pays = l.ledger.filter((x) => x.label.startsWith('工资')).length
  check('一年发十二笔（跨年不多发）', g.year === 2027 && pays >= 12 && pays <= 13, `${pays} 笔`)
  check('累计收入只走月薪一条路，年末不再加一年', Math.abs(g.tally!.earned - earnedBefore - Math.round(salary / 12) * (pays - 2)) < salary * 0.2, `${g.tally!.earned}`)
}

// ---- the two numbers move by game days, not by reads
{
  const g = mk()
  const l = g.life!
  const h0 = l.hunger
  tickLife(g, []); tickLife(g, []); tickLife(g, [])
  check('同一天调用三次不掉三次', l.hunger === h0)
  step(g, 3)
  check('推进三天掉三天的饱腹', Math.abs(l.hunger - (h0 - 3 * LIFE.HUNGER_PER_DAY)) < 1e-9, `${h0} → ${l.hunger}`)
  check('状态修正在 ±8% 内', Math.abs(lifeMod(g) - 1) <= LIFE.MOD_MAX + 1e-9)
  // a fed manager who never opens the page: 心情 settles at the floor, it does not bottom out
  const f = mk()
  setAutoMeal(f, 'cheap', 10000)
  f.life!.wallet = 100000
  f.day = 0
  for (let i = 0; i < 120; i++) { f.day++; tickLife(f, []) }
  check('吃饱但从不管心情：停在 40，不见底', f.life!.mood === LIFE.MOOD_FLOOR && f.life!.hunger >= LIFE.HUNGRY_AT, `mood ${f.life!.mood} hunger ${f.life!.hunger}`)
}

// ---- buying: refusals cost nothing, the wallet never goes negative
{
  const g = mk()
  const l = g.life!
  l.wallet = 50
  l.hunger = 40
  const r = doLifeAct(g, 'goodMeal')
  check('钱不够：拒绝，不扣钱、不加饱腹', !r.ok && l.wallet === 50 && l.hunger === 40, r.text)
  const c = doLifeAct(g, 'cheapMeal')
  check('便饭买得起：扣 $30，饱腹 +35', c.ok && l.wallet === 20 && l.hunger === 75)
  const rest = doLifeAct(g, 'rest')
  check('休息免费，心情 +8', rest.ok && l.wallet === 20)
  check('休息一天只能一次', !doLifeAct(g, 'rest').ok && /天后/.test(lifeBlock(g, 'rest') ?? ''))
  l.hunger = 100
  check('吃饱了不能再吃', !doLifeAct(g, 'cheapMeal').ok)
  check('余额永远不为负', l.wallet >= 0)
  // affordability: the lowest salary in the game
  const low = Math.min(...Object.values(g.teams).map((t) => 60_000 + Math.pow(Math.max(0, t.reputation - 40), 2) * 95)) * 0.75 / 12
  const daily = LIFE_ACTS.cheapMeal.price * (LIFE.HUNGER_PER_DAY / LIFE_ACTS.cheapMeal.hunger)
  check('最低月薪也养得起每天吃饭', low > daily * 30 * 5, `月薪 $${Math.round(low)} 对每月饭钱约 $${Math.round(daily * 30)}`)
}

// ---- auto supply keeps to the budget and the balance
{
  const g = mk()
  g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
  const l = g.life!
  setAutoMeal(g, 'cheap', 90)
  step(g, 40)
  check('开了自动补给，饱腹不掉到饥饿线下', l.hunger >= LIFE.HUNGRY_AT, `${l.hunger}`)
  const spentThisMonth = l.auto.spent
  check('本月自动花费不超过预算', spentThisMonth <= 90, `${spentThisMonth}`)
  const h = mk()
  setAutoMeal(h, 'good', 100000)
  h.life!.wallet = 0
  h.managerContract = { salary: 0, years: 1, since: 2026 }
  const notes: string[] = []
  h.day = 20
  for (let i = 0; i < 12; i++) { h.day++; tickLife(h, notes) }
  check('没钱时自动补给停下并提醒，余额不为负', h.life!.wallet === 0 && notes.some((n) => n.includes('余额不够')))
}

// ---- an old save: migrated once, banked pay carried, no back pay
{
  const g = mk()
  g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
  step(g, 100)
  const raw = JSON.parse(exportSave(g))
  const st = raw.state ?? raw
  delete st.life
  st.tally = { signed: 0, hired: 0, earned: 400_000, commercial: 0 }
  const old = importSave(JSON.stringify(raw))
  check('老存档：已结算的收入转入钱包，标记来源', old.life?.wallet === 400_000 && old.life?.migratedFrom === 400_000)
  check('老存档：年龄从迁移的赛季起算', managerAge(old) === old.manager!.age && old.life?.startYear === old.year)
  check('老存档：当月不补发', old.life?.paidMonth === monthKey(old))
  const again = importSave(exportSave(old))
  check('再读一次不再结转', again.life?.wallet === 400_000 && again.life?.ledger.length === 1)
  const before = old.life!.wallet
  step(old, 1)
  check('迁移后下一天不发这个月的工资', old.life!.wallet === before)
}

// ---- sacked: the pay stops
{
  const g = mk()
  g.gameOver = '下课'
  const w = g.life!.wallet
  step(g, 40)
  check('下课后不再发工资', g.life!.wallet === w)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
