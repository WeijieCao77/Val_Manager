/**
 * 洛杉矶 2023: the series (80 real players of VALORANT Champions 2023, their own pool) and its launch price —
 * built and dealt exactly as 首尔 2024 and 曼谷 2025 are.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { ALL_CARDS, LOS_ANGELES_CARDS, BASE_PLAYER_CARDS, cardById, personOf } from '../src/engine/cards'
import { LOS_ANGELES_TEAMS, losAngelesFace } from '../src/engine/losangeles2023'
import {
  PACKS, PACK_ORDER, MYTHIC_FLOOR, HARD_PITY, BANGKOK_SALE_OFF, LOS_ANGELES_LAUNCH, LOS_ANGELES_SALE_LAST,
  newGacha, openPack, openPacks, packCost, packRetired, migrateGacha, setSlot, personTaken, seriesProgress, fullSetProgress,
} from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { buildArena, playRivalMatch, ARENA_TEAM } from '../src/engine/arena'
import { clubSets } from '../src/engine/clubSets'
import { matchesFilter, EMPTY_FILTER } from '../src/engine/cardFilter'

let n = 0
const ok = (what: string, cond: boolean, detail = '') => { n++; assert(cond, `${what} ${detail}`); console.log(`ok   ${what}${detail ? `  — ${detail}` : ''}`) }
const by = (ign: string) => LOS_ANGELES_CARDS.find(c => c.ign === ign)!

// ---- the series
ok('80 张，一人一张，编号 1–80', LOS_ANGELES_CARDS.length === 80 && new Set(LOS_ANGELES_CARDS.map(personOf)).size === 80
  && new Set(LOS_ANGELES_CARDS.map(c => c.losAngeles!.number)).size === 80 && LOS_ANGELES_CARDS.every(c => c.id === `la23:${c.losAngeles!.vlrId}`))
ok('16 支战队，每队五人', LOS_ANGELES_TEAMS.length === 16 && LOS_ANGELES_TEAMS.every(t => LOS_ANGELES_CARDS.filter(c => c.clubTag === t.tag).length === 5))
ok('每张卡都查得到、有照片、有出场、有位置', LOS_ANGELES_CARDS.every(c => cardById(c.id) === c && !!c.face && existsSync(`public${c.face}`)
  && c.losAngeles!.maps > 0 && c.roles.length > 0))
ok('照片是洛杉矶冠军赛的', LOS_ANGELES_CARDS.every(c => c.face!.startsWith('/events/los-angeles-2023/') && losAngelesFace(c.losAngeles!.vlrId)?.source?.includes('flickr.com/photos/valorantesports/')))
const faces = LOS_ANGELES_CARDS.map(c => losAngelesFace(c.losAngeles!.vlrId) as { cutout?: boolean; photo?: string; confirmed?: boolean })
ok('每张照片都把人从背景里抠出来了（只剩选手本人站在卡面上）', faces.every(f => f.cutout === true))
ok('whzy 用的是他自己那组照片（16:31），不是被说明写成 whz 的 Biank（16:35 那张）', faces[LOS_ANGELES_CARDS.findIndex(c => c.ign === 'whzy')].photo !== '53102991504')
ok('Yuicaw 那张双人照主人确认过，抠图后只剩他', !!faces[LOS_ANGELES_CARDS.findIndex(c => c.ign === 'Yuicaw')].confirmed)
ok('队名按当届：DRX、Giants（不是后来的 KRX、GX）', by('MaKo').clubTag === 'DRX' && by('Cloud').clubTag === 'GIA'
  && !LOS_ANGELES_CARDS.some(c => c.clubTag === 'KRX' || c.clubTag === 'GX'))
ok('ID 按当届写：FNS、TZH、C0M', ['FNS', 'TZH', 'C0M'].every(i => !!by(i)))
ok('名次：EG 冠军、PRX 亚军、LOUD 季军、FNATIC 第四', ['EG', 'PRX', 'LOUD', 'FNC'].every((t, i) => LOS_ANGELES_TEAMS.find(x => x.tag === t)?.placement === i + 1))
const callers = LOS_ANGELES_CARDS.filter(c => c.isIgl).map(c => c.ign).sort()
ok('十六支队各一个当年的指挥（TL 是 Redgar，不是后来的 nAts）', callers.join() === ['Boostio', 'd4v41', 'saadhak', 'Boaster', 'stax', 'Haodong', 'Biank', 'MrFaliN',
  'ANGE1', 'FNS', 'Munchkin', 'rhyme', 'Redgar', 'BerLIN', 'Klaus', 'Laz'].sort().join()
  && LOS_ANGELES_TEAMS.every(t => LOS_ANGELES_CARDS.filter(c => c.clubTag === t.tag && c.isIgl).length === 1), callers.join())
const counts = ['gold', 'silver', 'bronze'].map(r => LOS_ANGELES_CARDS.filter(c => c.rarity === r).length)
ok('金 / 银 / 铜 = 20 / 53 / 7，没有彩卡', counts.join('/') === '20/53/7' && !LOS_ANGELES_CARDS.some(c => c.rarity === 'mythic'), counts.join('/'))
ok('赛事 MVP Demon1 加 5 分，到顶 96', by('Demon1').rating === 96 && by('Demon1').rarity === 'gold', `${by('Demon1').rating}`)
ok('首尔、曼谷的公式：Leo 91、Chronicle 78、crow 69', by('Leo').rating === 91 && by('Chronicle').rating === 78 && by('crow').rating === 69)
ok('没有人打得比队友少到算替补', LOS_ANGELES_TEAMS.every(t => new Set(LOS_ANGELES_CARDS.filter(c => c.clubTag === t.tag).map(c => c.losAngeles!.maps)).size === 1))
ok('进了全部卡牌，系列筛选出 80 张', LOS_ANGELES_CARDS.every(c => ALL_CARDS.includes(c))
  && ALL_CARDS.filter(c => matchesFilter(c, { ...EMPTY_FILTER, series: 'los-angeles-2023' })).length === 80)

// ---- the pack: the 首尔包's and 曼谷包's price and odds
ok('洛杉矶包和曼谷包同价同出率', (['cost', 'draws', 'mythic', 'gold', 'silver', 'floor', 'shop'] as const).every(k => PACKS.losangeles2023[k] === PACKS.bangkok2025[k]))
ok('在卡包列表里，不会下线', PACK_ORDER.includes('losangeles2023') && !packRetired('losangeles2023', '2027-06-01') && !packRetired('bangkok2025', '2027-06-01'))
const DAY = '2026-10-25'
const g = newGacha('LA-AUDIT', '洛杉矶测试', DAY)
const regionalBefore = seriesProgress(g).map(s => [s.region, s.total])
const clubsBefore = clubSets(g).map(s => [s.clubId, s.total]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
const fullBefore = fullSetProgress(g).total
g.coins = 1e8
const seen = new Set<string>()
let fine = true
for (let i = 0; i < 4000; i++) {
  const before = g.coins
  const pulls = openPack(g, 'losangeles2023', 'coins', DAY)
  fine &&= before - g.coins === 3000 && pulls.length === 3 && pulls.some(p => p.card.rarity !== 'bronze')
    && pulls.every(p => p.card.kind === 'player' && p.card.event === 'los-angeles-2023')
  for (const p of pulls) seen.add(p.card.id)
}
ok('4000 包：每包 3 张、至少一银、只出洛杉矶卡、原价 3000', fine)
ok('80 个人都抽得到', seen.size === 80, `${seen.size}`)
g.pity = HARD_PITY; g.mythicDry = MYTHIC_FLOOR
ok('金卡保底照常；不碰彩卡保底', openPack(g, 'losangeles2023', 'coins', DAY).some(p => p.card.rarity === 'gold') && g.mythicDry === MYTHIC_FLOOR)
const isLa = (p: { card: { kind: string } }) => p.card.kind === 'player' && (p.card as { event?: string }).event === 'los-angeles-2023'
let clean = true
for (const kind of ['scout', 'elite', 'cn', 'pac', 'ame', 'emea', 'coach', 'bangkok2025'] as const) {
  for (let i = 0; i < 30; i++) clean &&= !openPack(g, kind, 'coins', DAY).some(isLa)
}
for (let i = 0; i < 30; i++) { g.packs.ten = 1; clean &&= !openPack(g, 'ten', 'pack').some(isLa) }
for (let i = 0; i < 10; i++) { g.packs.legend = 1; clean &&= !openPack(g, 'legend', 'pack').some(isLa) }
ok('别的包都不出洛杉矶卡（曼谷包、十连包、彩卡包也不）', clean)

// ---- the launch sale
const sale = Math.round(3000 * (1 - BANGKOK_SALE_OFF))
const days = [LOS_ANGELES_LAUNCH, '', LOS_ANGELES_SALE_LAST]
days[1] = new Date(Date.parse(`${LOS_ANGELES_LAUNCH}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
ok(`上线头三天 85 折：${days.join('、')} 是 ${sale}`, days.every(d => packCost('losangeles2023', d) === sale)
  && Date.parse(`${LOS_ANGELES_SALE_LAST}T00:00:00Z`) - Date.parse(`${LOS_ANGELES_LAUNCH}T00:00:00Z`) === 2 * 86_400_000)
const before = new Date(Date.parse(`${LOS_ANGELES_LAUNCH}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
const after = new Date(Date.parse(`${LOS_ANGELES_SALE_LAST}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
ok('之前和之后都是 3000，曼谷包不跟着打折', packCost('losangeles2023', before) === 3000 && packCost('losangeles2023', after) === 3000
  && packCost('bangkok2025', LOS_ANGELES_LAUNCH) === 3000)
{
  const s = newGacha('LA-SALE', '折扣', LOS_ANGELES_LAUNCH); s.coins = 10_000
  openPack(s, 'losangeles2023', 'coins', LOS_ANGELES_LAUNCH)
  ok(`折扣期真的只扣 ${sale}`, s.coins === 10_000 - sale, `${10_000 - s.coins}`)
}
{
  const a = newGacha('LA-MULTI', '连开', DAY); a.coins = 1e6
  const r = runAction(a, 'open', { kind: 'losangeles2023', payWith: 'coins', count: 10 }, { today: DAY, now: Date.parse(`${DAY}T04:00:00Z`), seed: 11 } as never)
  const res = (r as { result?: { packs: number; pulled: { cardId: string }[] } }).result
  ok('连开 10 个洛杉矶包：30 张、扣 30000', r.ok && res?.packs === 10 && res.pulled.length === 30 && a.coins === 1e6 - 30_000
    && res.pulled.every(p => p.cardId.startsWith('la23:')))
  const b = newGacha('LA-MULTI2', '连开', DAY); b.coins = 1e6
  ok('openPacks 同样认洛杉矶包', openPacks(b, 'losangeles2023', 'coins', 3, DAY).flat().length === 9)
}

// ---- identity, saves, the arena, and the collections they must not bend
const saved = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
ok('存档来回一趟，洛杉矶卡都还在', LOS_ANGELES_CARDS.every(c => saved.cards[c.id]))
ok('赛区进度、俱乐部收集、全图鉴的总数不变', JSON.stringify(seriesProgress(g).map(s => [s.region, s.total])) === JSON.stringify(regionalBefore)
  && JSON.stringify(clubSets(g).map(s => [s.clubId, s.total]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) === JSON.stringify(clubsBefore)
  && fullSetProgress(g).total === fullBefore)
const aspas = by('aspas')
const base = BASE_PLAYER_CARDS.find(c => c.playerId === aspas.playerId)!
g.cards[base.id] = { id: base.id, level: 0, dupes: 0, seen: 1, got: DAY }
setSlot(g, 0, aspas.id)
ok('常规卡和洛杉矶卡是同一个人，不能同时上场', !!base && personTaken(g, base.id))
const historical = LOS_ANGELES_CARDS.filter(c => c.playerId.startsWith('historic:'))
ok('不在 2026 年名单里的人也有卡（Boostio、Laz、crow…）', historical.length === 31 && ['Boostio', 'Laz', 'crow', 'Redgar'].every(i => historical.some(c => c.ign === i)), `${historical.length}`)
const five = [...historical.slice(0, 3), ...LOS_ANGELES_CARDS.filter(c => c.clubTag === 'EG').slice(0, 2)]
const squad = { slots: five.map(c => c.id), coach: null }
const arena = buildArena(squad, () => 0, 123)
ok('他们在对战里真的坐上位置', arena.state.teams[ARENA_TEAM].roster.length === 5 && five.every((c, i) => arena.state.players[`A${i}`].ign === c.ign))
const result = playRivalMatch(squad, () => 0, { ...squad, name: '洛杉矶镜像', tag: 'LA23', levels: {}, div: 5, points: 0 }, 1, 777)
ok('打一场：双方五人都有数据', result.lines.length === 5 && result.opp?.lines.length === 5)

console.log(`\n全部通过（${n} 项）`)
