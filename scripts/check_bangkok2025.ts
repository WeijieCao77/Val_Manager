/**
 * 曼谷 2025: the series (41 real players of Masters Bangkok, their own pool),
 * its launch price and the 首尔包 leaving the shop, and 连开 — up to ten
 * packs in one action, which must come out exactly as ten single opens.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { ALL_CARDS, BANGKOK_CARDS, BASE_PLAYER_CARDS, SEOUL_CARDS, cardById, personOf } from '../src/engine/cards'
import { BANGKOK_TEAMS } from '../src/engine/bangkok2025'
import {
  PACKS, MYTHIC_FLOOR, HARD_PITY, MULTI_OPEN_MAX, BANGKOK_SALE_OFF, SEOUL_LAST_DAY,
  newGacha, openPack, openPacks, packCost, packRetired, migrateGacha, setSlot, personTaken, seriesProgress,
} from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { buildArena, playRivalMatch, ARENA_TEAM } from '../src/engine/arena'
import { clubSets } from '../src/engine/clubSets'

let n = 0
const ok = (what: string, cond: boolean, detail = '') => { n++; assert(cond, `${what} ${detail}`); console.log(`ok   ${what}${detail ? `  — ${detail}` : ''}`) }

// ---- the series
ok('41 张，一人一张，编号 1–41', BANGKOK_CARDS.length === 41 && new Set(BANGKOK_CARDS.map(personOf)).size === 41
  && new Set(BANGKOK_CARDS.map(c => c.bangkok!.number)).size === 41)
ok('8 支战队，T1 六人、其余五人', BANGKOK_TEAMS.length === 8
  && BANGKOK_TEAMS.every(t => BANGKOK_CARDS.filter(c => c.clubTag === t.tag).length === (t.tag === 'T1' ? 6 : 5)))
ok('每张卡都查得到、有照片、有出场、有位置', BANGKOK_CARDS.every(c => cardById(c.id) === c && !!c.face && existsSync(`public${c.face}`)
  && c.bangkok!.maps > 0 && c.roles.length > 0))
ok('照片是曼谷 Features Day 的', BANGKOK_CARDS.every(c => c.face!.startsWith('/events/bangkok-2025/')))
ok('队名按当届：DRX（不是后来的 KRX）', BANGKOK_CARDS.find(c => c.ign === 'MaKo')?.clubTag === 'DRX' && !BANGKOK_CARDS.some(c => c.clubTag === 'KRX'))
ok('名次：T1 冠军、G2 亚军、EDG 季军', ['T1', 'G2', 'EDG'].every((t, i) => BANGKOK_TEAMS.find(x => x.tag === t)?.placement === i + 1))
ok('Tejo 算先锋、Vyse 算哨卫', BANGKOK_CARDS.find(c => c.ign === 'trent')?.role === '先锋' && BANGKOK_CARDS.find(c => c.ign === 'CHICHOO')?.role === '哨卫')
const callers = BANGKOK_CARDS.filter(c => c.isIgl).map(c => c.ign).sort()
ok('八支队各一个指挥（VIT 是 Sayf）', callers.join() === ['stax', 'valyn', 'nobody', 'Sayf', 'MaKo', 'nAts', 'johnqt', 'heybay'].sort().join(), callers.join())
const carpe = BANGKOK_CARDS.find(c => c.ign === 'carpe')!
ok('出场不到本队三分之一的替补减分：carpe 2 图', carpe.bangkok!.maps === 2 && carpe.rating === 73, `${carpe.rating}`)
const counts = ['gold', 'silver', 'bronze'].map(r => BANGKOK_CARDS.filter(c => c.rarity === r).length)
ok('金 / 银 / 铜 = 12 / 25 / 4，没有彩卡', counts.join('/') === '12/25/4' && !BANGKOK_CARDS.some(c => c.rarity === 'mythic'), counts.join('/'))
const meteor = BANGKOK_CARDS.find(c => c.ign === 'Meteor')!, kk = SEOUL_CARDS.find(c => c.ign === 'ZmjjKK')!
ok('赛事 MVP 加 5 分：Meteor 87（金）、首尔 ZmjjKK 92', meteor.rating === 87 && meteor.rarity === 'gold' && kk.rating === 92, `${meteor.rating} / ${kk.rating}`)
ok('别人不受 MVP 加分影响：iZu 84、首尔 Derke 88', BANGKOK_CARDS.find(c => c.ign === 'iZu')!.rating === 84 && SEOUL_CARDS.find(c => c.ign === 'Derke')!.rating === 88)
ok('进了全部卡牌', BANGKOK_CARDS.every(c => ALL_CARDS.includes(c)))

// ---- the pack: the 首尔包's price and odds
ok('曼谷包和首尔包同价同出率', (['cost', 'draws', 'mythic', 'gold', 'silver', 'floor', 'shop'] as const).every(k => PACKS.bangkok2025[k] === PACKS.seoul2024[k]))
const g = newGacha('BANGKOK-AUDIT', '曼谷测试', '2026-10-05')
const regionalBefore = seriesProgress(g).map(s => [s.region, s.total])
const clubsBefore = clubSets(g).map(s => [s.clubId, s.total]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
g.coins = 1e8
const seen = new Set<string>()
let fine = true
for (let i = 0; i < 3000; i++) {
  const before = g.coins
  const pulls = openPack(g, 'bangkok2025', 'coins', '2026-10-05')
  fine &&= before - g.coins === 3000 && pulls.length === 3 && pulls.some(p => p.card.rarity !== 'bronze')
    && pulls.every(p => p.card.kind === 'player' && p.card.event === 'bangkok-2025')
  for (const p of pulls) seen.add(p.card.id)
}
ok('3000 包：每包 3 张、至少一银、只出曼谷卡、原价 3000', fine)
ok('41 个人都抽得到', seen.size === 41, `${seen.size}`)
g.pity = HARD_PITY; g.mythicDry = MYTHIC_FLOOR
ok('金卡保底照常；不碰彩卡保底', openPack(g, 'bangkok2025', 'coins').some(p => p.card.rarity === 'gold') && g.mythicDry === MYTHIC_FLOOR)
const isBkk = (p: { card: { kind: string } }) => p.card.kind === 'player' && (p.card as { event?: string }).event === 'bangkok-2025'
let clean = true
for (const kind of ['scout', 'elite', 'cn', 'pac', 'ame', 'emea', 'coach', 'seoul2024'] as const) {
  for (let i = 0; i < 30; i++) clean &&= !openPack(g, kind, 'coins', '2026-10-05').some(isBkk)
}
for (let i = 0; i < 30; i++) { g.packs.ten = 1; clean &&= !openPack(g, 'ten', 'pack').some(isBkk) }
ok('别的包都不出曼谷卡（首尔包、十连包也不）', clean)

// ---- the launch sale and the 首尔包 leaving the shop
const sale = Math.round(3000 * (1 - BANGKOK_SALE_OFF))
ok('上线头三天 85 折：10-01、10-02、10-03 是 2550', ['2026-10-01', '2026-10-02', '2026-10-03'].every(d => packCost('bangkok2025', d) === sale), `${sale}`)
ok('之前和之后都是 3000', packCost('bangkok2025', '2026-09-30') === 3000 && packCost('bangkok2025', '2026-10-04') === 3000)
{
  const s = newGacha('BANGKOK-SALE', '折扣', '2026-10-02'); s.coins = 10_000
  openPack(s, 'bangkok2025', 'coins', '2026-10-02')
  ok('折扣期真的只扣 2550', s.coins === 10_000 - sale, `${10_000 - s.coins}`)
}
ok('首尔包 10-07 还能买，10-08 起下线', !packRetired('seoul2024', SEOUL_LAST_DAY) && packRetired('seoul2024', '2026-10-08')
  && !packRetired('bangkok2025', '2027-01-01'))
{
  const s = newGacha('SEOUL-GONE', '下线', '2026-10-08'); s.coins = 10_000; s.packs.seoul2024 = 1
  let refused = ''
  try { openPack(s, 'seoul2024', 'coins', '2026-10-08') } catch (e) { refused = (e as Error).message }
  ok('下线后花金币买不了，金币不动', /已下线/.test(refused) && s.coins === 10_000, refused)
  ok('库存里的首尔包照样能开', openPack(s, 'seoul2024', 'pack', '2026-10-08').length === 3 && s.packs.seoul2024 === 0)
  const r = runAction(s, 'open', { kind: 'seoul2024', payWith: 'coins' }, { today: '2026-10-08', now: Date.parse('2026-10-08T04:00:00Z'), seed: 7 } as never)
  ok('服务器动作同样拒绝', !r.ok && /已下线/.test((r as { why: string }).why))
}

// ---- 连开: ten packs in one go are ten single opens, pack for pack
const twin = (s: GachaState) => JSON.parse(JSON.stringify(s)) as GachaState
const strip = (s: GachaState) => ({ ...s, log: s.log.map(l => l.text) })
for (const [kind, payWith] of [['bangkok2025', 'coins'], ['elite', 'coins'], ['ten', 'pack']] as const) {
  const a = newGacha(`MULTI-${kind}`, '连开', '2026-10-02'); a.coins = 1e6; a.packs.ten = 12; a.pity = 30; a.mythicDry = 1190
  const b = twin(a)
  const many = openPacks(a, kind, payWith, MULTI_OPEN_MAX, '2026-10-02')
  const one: string[][] = []
  for (let i = 0; i < MULTI_OPEN_MAX; i++) one.push(openPack(b, kind, payWith, '2026-10-02').map(p => p.card.id))
  ok(`连开 10 个${PACKS[kind].name}（${payWith === 'coins' ? '金币' : '库存'}）＝ 一包一包开 10 次`,
    JSON.stringify(many.map(p => p.map(x => x.card.id))) === JSON.stringify(one)
    && JSON.stringify(strip(a)) === JSON.stringify(strip(b)),
    `${many.flat().length} 张，彩卡保底 ${a.mythicDry}，金卡保底 ${a.pity}`)
}
{
  const a = newGacha('MULTI-BAD', '连开', '2026-10-05'); a.coins = 7000; a.packs.elite = 3
  const before = JSON.stringify(a)
  const refuse = (f: () => unknown) => { try { f(); return '' } catch (e) { return (e as Error).message } }
  const why = [
    refuse(() => openPacks(a, 'bangkok2025', 'coins', 3, '2026-10-05')), // 9000 > 7000
    refuse(() => openPacks(a, 'elite', 'pack', 4, '2026-10-05')), // 3 in stock
    refuse(() => openPacks(a, 'elite', 'pack', 11, '2026-10-05')),
    refuse(() => openPacks(a, 'elite', 'pack', 0, '2026-10-05')),
    refuse(() => openPacks(a, 'elite', 'pack', 2.5, '2026-10-05')),
    refuse(() => openPacks(a, 'ten', 'coins', 2, '2026-10-05')),
  ]
  ok('钱不够、库存不够、超过 10、0、小数、非卖品：一包都不开，账号不动', why.every(Boolean) && JSON.stringify(a) === before, why.join(' | '))
  ok('刚好够的时候开得了：7000 金币开 2 个曼谷包', openPacks(a, 'bangkok2025', 'coins', 2, '2026-10-05').length === 2 && a.coins === 1000)
}
{
  // 'auto': the stock first, coins for the rest — six in stock and ten asked for is four bought
  const env = { today: '2026-10-05', now: Date.parse('2026-10-05T04:00:00Z'), seed: 3 } as never
  const a = newGacha('MULTI-AUTO', '连开', '2026-10-05'); a.packs.elite = 6; a.coins = 1e5
  const price = packCost('elite', '2026-10-05')
  const b = twin(a)
  const many = openPacks(a, 'elite', 'auto', 10, '2026-10-05')
  const one: string[][] = []
  for (let i = 0; i < 10; i++) one.push(openPack(b, 'elite', i < 6 ? 'pack' : 'coins', '2026-10-05').map(p => p.card.id))
  ok('库存 6 个、连开 10 包：先开库存 6 个，再花金币买 4 包',
    many.length === 10 && a.packs.elite === 0 && a.coins === 1e5 - 4 * price
    && JSON.stringify(many.map(p => p.map(x => x.card.id))) === JSON.stringify(one), `${a.coins}`)
  const c = newGacha('MULTI-AUTO2', '连开', '2026-10-05'); c.packs.elite = 8; c.coins = 0
  ok('库存够的时候一个金币都不花', openPacks(c, 'elite', 'auto', 5, '2026-10-05').length === 5 && c.packs.elite === 3 && c.coins === 0)
  const d = newGacha('MULTI-AUTO3', '连开', '2026-10-05'); d.packs.elite = 6; d.coins = price * 3
  const before = JSON.stringify(d)
  const refuse = (f: () => unknown) => { try { f(); return '' } catch (e) { return (e as Error).message } }
  const why = refuse(() => openPacks(d, 'elite', 'auto', 10, '2026-10-05'))
  ok('金币只够补 3 包时 10 包一包都不开，库存不动', /金币不够，4 包/.test(why) && JSON.stringify(d) === before, why)
  const e = newGacha('MULTI-AUTO4', '连开', '2026-10-05'); e.packs.ten = 3; e.coins = 1e6
  ok('买不到的包库存不够就不开', /买不到/.test(refuse(() => openPacks(e, 'ten', 'auto', 4, '2026-10-05'))) && e.packs.ten === 3)
  const f = newGacha('MULTI-AUTO5', '连开', '2026-10-05'); f.packs.elite = 6; f.coins = 1e5
  const r = runAction(f, 'open', { kind: 'elite', payWith: 'auto', count: 10 }, env)
  ok('服务器动作认 auto', r.ok && f.packs.elite === 0 && f.coins === 1e5 - 4 * price)
  const g1 = newGacha('MULTI-AUTO6', '单开', '2026-10-05'); g1.packs.elite = 1; g1.coins = 1e5
  ok('auto 单开有库存先用库存', runAction(g1, 'open', { kind: 'elite', payWith: 'auto' }, env).ok && g1.packs.elite === 0 && g1.coins === 1e5)
}
{
  const a = newGacha('MULTI-ACT', '连开', '2026-10-05'); a.packs.scout = 10
  const r = runAction(a, 'open', { kind: 'scout', payWith: 'pack', count: 10 }, { today: '2026-10-05', now: Date.parse('2026-10-05T04:00:00Z'), seed: 99 } as never)
  const res = (r as { result?: { packs: number; pulled: unknown[] } }).result
  ok('服务器动作：count 10 → 10 包 10 张，库存清空', r.ok && res?.packs === 10 && res.pulled.length === 10 && a.packs.scout === 0)
  const r2 = runAction(a, 'open', { kind: 'scout', payWith: 'pack', count: 2 }, { today: '2026-10-05', now: Date.parse('2026-10-05T04:00:00Z'), seed: 99 } as never)
  ok('库存不够时动作失败，说清楚', !r2.ok && /没有这种卡包|库存只有/.test((r2 as { why: string }).why))
  const b = newGacha('SINGLE-ACT', '单开', '2026-10-05'); b.packs.scout = 1
  const r3 = runAction(b, 'open', { kind: 'scout', payWith: 'pack' }, { today: '2026-10-05', now: Date.parse('2026-10-05T04:00:00Z'), seed: 5 } as never)
  ok('不带 count 还是原来的单开回复', r3.ok && !('packs' in ((r3 as { result: object }).result)))
}

// ---- identity, saves, the arena, and the collections they must not bend
const saved = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
ok('存档来回一趟，曼谷卡都还在', BANGKOK_CARDS.every(c => saved.cards[c.id]))
ok('赛区进度和俱乐部收集的总数不变', JSON.stringify(seriesProgress(g).map(s => [s.region, s.total])) === JSON.stringify(regionalBefore)
  && JSON.stringify(clubSets(g).map(s => [s.clubId, s.total]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) === JSON.stringify(clubsBefore))
const chichoo = BANGKOK_CARDS.find(c => c.ign === 'CHICHOO')!
const base = BASE_PLAYER_CARDS.find(c => c.playerId === chichoo.playerId)!
g.cards[base.id] = { id: base.id, level: 0, dupes: 0, seen: 1, got: '2026-10-05' }
setSlot(g, 0, chichoo.id)
ok('常规卡和曼谷卡是同一个人，不能同时上场', personTaken(g, base.id))
const historical = BANGKOK_CARDS.filter(c => c.playerId.startsWith('historic:'))
ok('三位不在 2026 年的人（carpe、Sayf、Flashback）', historical.map(c => c.ign).sort().join() === 'Flashback,Sayf,carpe')
const five = [...historical, ...BANGKOK_CARDS.filter(c => c.clubTag === 'G2').slice(0, 2)]
const squad = { slots: five.map(c => c.id), coach: null }
const arena = buildArena(squad, () => 0, 123)
ok('他们在对战里真的坐上位置', arena.state.teams[ARENA_TEAM].roster.length === 5 && five.every((c, i) => arena.state.players[`A${i}`].ign === c.ign))
const result = playRivalMatch(squad, () => 0, { ...squad, name: '曼谷镜像', tag: 'B25', levels: {}, div: 5, points: 0 }, 1, 777)
ok('打一场：双方五人都有数据', result.lines.length === 5 && result.opp?.lines.length === 5)

console.log(`\n全部通过（${n} 项）`)
