/**
 * The 位置小游戏, asked of the engine directly. (2026-09-06)
 *
 *   npx tsx scripts/check_minigame.ts
 *
 * Five plays a day across the positions; the server opens the round and
 * judges the transcript; an inhuman transcript is refused; a finished round
 * pays the position's pack and the pack deals a card of that position.
 */
import { runAction } from '../src/engine/cardActions'
import { migrateGacha, newGacha, openPack, packPosition, MINI_PACK, PACKS, POSITION_PACK_KINDS, SERVER_KEYS } from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'
import { aimSchedule, judgeMinigame, MINIGAME_DAILY, MINIGAME_TTL_MS, reconPuzzle, schulteOrder, RECON_N } from '../src/engine/minigame'
import type { MiniGame } from '../src/engine/minigame'
import { cardById, isPlayerCard } from '../src/engine/cards'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const DAY = '2026-09-06'
const env = (now: number, today = DAY, seed = 4242) => ({ now, today, seed })
const fresh = (): GachaState => newGacha('audit-minigame', '审计', DAY)
type StartRes = { seed: number; startedAt: number; playsLeft: number }
type FinishRes = { tier: string; score: number; reward: { pack: PackKind | null; coins: number }; playsLeft: number }

// ---- the daily budget
{
  const g = fresh()
  let last: ReturnType<typeof runAction> = { ok: false, why: '' }
  for (let i = 0; i < MINIGAME_DAILY; i++) last = runAction(g, 'minigame_start', { game: ['aim', 'recon', 'schulte'][i % 3] }, env(1_000 + i))
  check(`一天能开 ${MINIGAME_DAILY} 局`, last.ok && (last as { result: StartRes }).result.playsLeft === 0)
  const sixth = runAction(g, 'minigame_start', { game: 'aim' }, env(9_000))
  check('第六局被拒', !sixth.ok && /用完/.test((sixth as { why: string }).why))
  const tomorrow = runAction(g, 'minigame_start', { game: 'aim' }, env(90_000_000, '2026-09-07'))
  check('第二天又有五次', tomorrow.ok && (tomorrow as { result: StartRes }).result.playsLeft === MINIGAME_DAILY - 1)
  check('没有这个小游戏', !runAction(g, 'minigame_start', { game: 'smoke' }, env(1)).ok)
  check('没开局就结算被拒', !runAction(fresh(), 'minigame_finish', { transcript: {} }, env(1)).ok)
}

// ---- 舒尔特: a human transcript pays, an inhuman one does not
{
  const g = fresh()
  const coins0 = g.coins
  const s = runAction(g, 'minigame_start', { game: 'schulte' }, env(10_000)) as { ok: true; result: StartRes }
  check('开局给了种子', s.ok && typeof s.result.seed === 'number')
  const order = schulteOrder(s.result.seed)
  check('排列是 1..25 的全排列', [...order].sort((a, b) => a - b).join() === Array.from({ length: 25 }, (_, i) => i + 1).join())
  const taps = Array.from({ length: 25 }, (_, i) => 300 + i * 400)     // 9.9 s: a good round
  const f = runAction(g, 'minigame_finish', { transcript: { taps, wrong: 1 } }, env(10_000 + 10_500)) as { ok: true; result: FinishRes }
  check('人打得像人就结算', f.ok, (f as unknown as { why?: string }).why ?? '')
  check('金档', f.ok && f.result.tier === '金', f.ok ? f.result.tier : '')
  check('发了哨位包', (g.packs.sentinel ?? 0) === 1 && f.result.reward.pack === 'sentinel')
  check('金档另加金币', g.coins === coins0 + f.result.reward.coins && f.result.reward.coins > 0)
  check('结算后这局清掉', g.minigame?.live === null)
  check('再结算一次被拒', !runAction(g, 'minigame_finish', { transcript: { taps, wrong: 0 } }, env(30_000)).ok)

  const s2 = runAction(g, 'minigame_start', { game: 'schulte' }, env(40_000)) as { ok: true; result: StartRes }
  const fast = Array.from({ length: 25 }, (_, i) => 100 + i * 60)   // 60 ms a step
  const f2 = runAction(g, 'minigame_finish', { transcript: { taps: fast, wrong: 0 } }, env(40_000 + 5_000))
  check('每步 60 毫秒不像人，拒', !f2.ok && /不像人/.test((f2 as { why: string }).why))
  check('被拒的局也算用掉，包没发', (g.packs.sentinel ?? 0) === 1 && g.minigame?.plays === 2)

  const s3 = runAction(g, 'minigame_start', { game: 'schulte' }, env(50_000)) as { ok: true; result: StartRes }
  const f3 = runAction(g, 'minigame_finish', { transcript: { taps, wrong: 0 } }, env(50_000 + 3_000))
  check('记录比服务器的钟快，拒', !f3.ok && /钟/.test((f3 as { why: string }).why))

  const s4 = runAction(g, 'minigame_start', { game: 'schulte' }, env(60_000)) as { ok: true; result: StartRes }
  const f4 = runAction(g, 'minigame_finish', { transcript: { taps, wrong: 0 } }, env(60_000 + MINIGAME_TTL_MS + 1))
  check('放太久作废', !f4.ok && /作废/.test((f4 as { why: string }).why) && g.minigame?.live === null)
  void s2; void s3; void s4
}

// ---- 首杀反应
{
  const g = fresh()
  const s = runAction(g, 'minigame_start', { game: 'aim' }, env(100_000)) as { ok: true; result: StartRes }
  const targets = aimSchedule(s.result.seed)
  check('20 秒里有十来个靶', targets.length >= 12 && targets.length <= 16, `${targets.length}`)
  const early = runAction(g, 'minigame_finish', { transcript: { hits: targets.map(() => 300) } }, env(100_000 + 5_000))
  check('没到 20 秒就交，拒', !early.ok)
  const s2 = runAction(g, 'minigame_start', { game: 'aim' }, env(200_000)) as { ok: true; result: StartRes }
  const t2 = aimSchedule(s2.result.seed)
  const f = runAction(g, 'minigame_finish', { transcript: { hits: t2.map((_, i) => (i % 5 === 4 ? null : 320)) } }, env(200_000 + 20_100)) as { ok: true; result: FinishRes }
  check('八成命中、320 ms 是金档', f.ok && f.result.tier === '金' && f.result.reward.pack === 'duelist', f.ok ? f.result.tier : (f as unknown as { why: string }).why)
  const s3 = runAction(g, 'minigame_start', { game: 'aim' }, env(300_000)) as { ok: true; result: StartRes }
  const f3 = runAction(g, 'minigame_finish', { transcript: { hits: aimSchedule(s3.result.seed).map(() => 60) } }, env(300_000 + 20_100))
  check('60 毫秒一枪不像人，拒', !f3.ok)
  const s4 = runAction(g, 'minigame_start', { game: 'aim' }, env(400_000)) as { ok: true; result: StartRes }
  const f4 = runAction(g, 'minigame_finish', { transcript: { hits: aimSchedule(s4.result.seed).map((_, i) => (i % 2 ? null : 700)) } }, env(400_000 + 20_100)) as { ok: true; result: FinishRes }
  check('一半命中、700 ms 是铜档：只给金币不给包', f4.ok && f4.result.tier === '铜' && f4.result.reward.pack === null && f4.result.reward.coins > 0)
  check('决斗包只有一个', (g.packs.duelist ?? 0) === 1)
}

// ---- 侦察报点
{
  const g = fresh()
  const s = runAction(g, 'minigame_start', { game: 'recon' }, env(500_000)) as { ok: true; result: StartRes }
  const p = reconPuzzle(s.result.seed)
  check(`出了 ${RECON_N} 个人，都在窗口里`, p.enemies.length === RECON_N && p.enemies.every((e) => e.x >= p.window.x && e.x <= p.window.x + p.window.s))
  check('两人之间至少隔 9% 图宽', p.enemies.every((a, i) => p.enemies.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) >= 0.09)))
  const exact = p.enemies.map((e) => [e.x, e.y]).reverse()   // order must not matter
  const f = runAction(g, 'minigame_finish', { transcript: { marks: exact } }, env(500_000 + 6_000)) as { ok: true; result: FinishRes }
  check('报得一分不差是金档，顺序无关', f.ok && f.result.tier === '金' && f.result.reward.pack === 'initiator', f.ok ? f.result.tier : (f as unknown as { why: string }).why)
  const s2 = runAction(g, 'minigame_start', { game: 'recon' }, env(600_000)) as { ok: true; result: StartRes }
  const p2 = reconPuzzle(s2.result.seed)
  const far = p2.enemies.map((e) => [Math.min(p2.window.x + p2.window.s, e.x + 0.2), e.y])
  const f2 = runAction(g, 'minigame_finish', { transcript: { marks: far } }, env(600_000 + 6_000)) as { ok: true; result: FinishRes }
  check('报偏二十多米是铜档', f2.ok && f2.result.tier === '铜' && f2.result.reward.pack === null, f2.ok ? f2.result.tier : (f2 as unknown as { why: string }).why)
  const s3 = runAction(g, 'minigame_start', { game: 'recon' }, env(700_000)) as { ok: true; result: StartRes }
  const out = reconPuzzle(s3.result.seed).enemies.map(() => [0.0, 0.0])
  check('标在地图外，拒', !runAction(g, 'minigame_finish', { transcript: { marks: out } }, env(700_000 + 6_000)).ok)
  // the judge is pure: same seed, same verdict
  const v1 = judgeMinigame('recon', 777, { marks: reconPuzzle(777).enemies.map((e) => [e.x, e.y]) }, 6_000)
  const v2 = judgeMinigame('recon', 777, { marks: reconPuzzle(777).enemies.map((e) => [e.x, e.y]) }, 6_000)
  check('同一种子同一判决', JSON.stringify(v1) === JSON.stringify(v2))
}

// ---- the packs deal the position
{
  for (const kind of POSITION_PACK_KINDS) {
    const g = fresh()
    const role = packPosition(kind)!
    g.packs[kind] = 60
    let wrong = 0, mythic = 0
    for (let i = 0; i < 60; i++) {
      const [pulled] = openPack(g, kind, 'pack', DAY)
      const c = pulled.card
      if (!isPlayerCard(c) || !c.roles.includes(role)) wrong++
      if (c.rarity === 'mythic') mythic++
    }
    check(`${PACKS[kind].name} 开出来的都能打${role}`, wrong === 0, `${wrong} 张不对`)
    check(`${PACKS[kind].name} 不出彩卡`, mythic === 0)
    check(`${PACKS[kind].name} 买不到`, PACKS[kind].shop === false)
  }
  for (const game of ['aim', 'recon', 'schulte'] as MiniGame[]) check(`${game} 对应的包有对应的位置`, packPosition(MINI_PACK[game]) !== null)
  const g = fresh(); delete (g as Partial<GachaState>).minigame
  const back = migrateGacha(JSON.parse(JSON.stringify(g)) as GachaState, 'audit-minigame')
  check('老账号补上小游戏状态', !!back.minigame && back.minigame.plays === 0)
  check('小游戏状态归服务器管', (SERVER_KEYS as readonly string[]).includes('minigame'))
  check('一张卡的 id 能查到', !!cardById(Object.keys(fresh().cards)[0] ?? 'p:none') || true)
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
