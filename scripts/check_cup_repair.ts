/**
 * A cup drawn against a club that has since left the world.
 *
 *   npx tsx scripts/check_cup_repair.ts
 *
 * 2026-09-13, from the group: 「杯赛有？队伍的bug」. Weibo Gaming (T77) went
 * out of world.json on 2026-09-09, and an account that had entered a cup
 * with WBG in the bracket kept the id: the round showed 「?」, 打8强 answered
 * 「没成功，等会儿再试」 every time, and the cup could not be cleared because it
 * was not finished. Loading the account must swap the missing club for a
 * real one that keeps the bracket climbing, and the round must then play.
 */
import { migrateGacha, newGacha, openPack, autoSquad, STAMINA_MAX } from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { CUP_TEAMS } from '../src/engine/cupTeams'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
;(globalThis as never as { fetch: unknown }).fetch = undefined

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const rating = new Map(CUP_TEAMS.map((t) => [t.id, t.rating]))
const known = (id: string) => rating.has(id)
const DEAD = 'T77' // Weibo Gaming, struck 2026-09-09
check('T77 真的已经不在世界里了', !known(DEAD))

const now = Date.parse('2026-09-13T01:00:00Z')
const env = { now, today: '2026-09-13', seed: 7 }
const fresh = (): GachaState => {
  const g = newGacha('VM-CUPR-CUPR-CUPR-CUPR-CUPR', '签表修补', '2026-09-01')
  g.packs.ten = 6
  for (let i = 0; i < 6; i++) openPack(g, 'ten' as PackKind, 'pack')
  g.squad = autoSquad(g)
  g.daily.stamina = STAMINA_MAX
  g.daily.staminaAt = now
  return g
}

// ---- the screenshot: 16强 Çilekler 59 won, 8强 WBG, 4强 QT DIG∞ 63, 决赛 AQG 63
{
  const g = fresh()
  g.cup = {
    path: ['T56', DEAD, 'T65', 'T73'], round: 1,
    legs: [{ opponent: 'T56', win: true, mapsWon: 2, mapsLost: 0 }],
    done: false, won: false, entry: 5,
  }
  const before = JSON.parse(JSON.stringify(g)) as GachaState
  // the way it was: the round cannot be played, and the cup cannot be put away
  let threw = false
  try { runAction(before, 'cup_play', {}, env) } catch { threw = true }
  const r0 = threw ? null : runAction(before, 'cup_play', {}, env)
  check('修之前这一轮打不了（服务器报错或拒绝）', threw || !r0?.ok)
  const clear = runAction(JSON.parse(JSON.stringify(g)), 'cup_clear', {}, env)
  check('修之前也清不掉，账号卡死', !clear.ok)

  const m = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
  const cup = m.cup!
  check('加载后签表里每一队都存在', cup.path.every(known), cup.path.join(','))
  check('已经打完的一轮没动', cup.path[0] === 'T56' && cup.legs.length === 1 && cup.round === 1)
  check('后面两轮也没动', cup.path[2] === 'T65' && cup.path[3] === 'T73')
  const sub = cup.path[1]
  const r = rating.get(sub)!
  check('顶上的队综合分在前后两轮之间，签表还是一轮比一轮强', r >= rating.get('T56')! && r <= rating.get('T65')!,
    `${CUP_TEAMS.find((t) => t.id === sub)?.name} ${r}`)
  check('顶上的队不是签表里已有的', new Set(cup.path).size === 4)
  const again = migrateGacha(JSON.parse(JSON.stringify(m)), m.id)
  check('再加载一次不会再换', again.cup!.path.join() === cup.path.join())

  const play = runAction(m, 'cup_play', {}, env)
  check('修好后 8强 打得了', play.ok, play.ok ? '' : play.why)
  check('打完签表往前走或者出局', !!m.cup && (m.cup.round === 2 || m.cup.done))
}

// ---- the dead club in the final, and two dead clubs at once
{
  const g = fresh()
  g.cup = { path: ['T56', 'T69', DEAD], round: 0, legs: [], done: false, won: false, entry: 5 }
  const m = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
  const rs = m.cup!.path.map((id) => rating.get(id)!)
  check('决赛的队没了，顶上来的不比半决赛弱', m.cup!.path.every(known) && rs[2] >= rs[1], rs.join(' → '))

  const h = fresh()
  h.cup = { path: [DEAD, 'T69', 'T99'], round: 0, legs: [], done: false, won: false, entry: 5 }
  const n = migrateGacha(JSON.parse(JSON.stringify(h)), h.id)
  const ns = n.cup!.path.map((id) => rating.get(id)!)
  check('两队都没了也各补一队，互不重复', n.cup!.path.every(known) && new Set(n.cup!.path).size === 3, ns.join(' → '))
}

// ---- a healthy bracket is left exactly alone
{
  const g = fresh()
  runAction(g, 'cup_enter', {}, env)
  const path = g.cup!.path.slice()
  const m = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
  check('正常的签表一个字不改', m.cup!.path.join() === path.join())
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
