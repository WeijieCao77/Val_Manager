/**
 * Who people are, in all four worlds. (2026-09-18)
 *
 *   npx tsx scripts/check_people.ts
 *
 * 「选手身份要对好」. Three things went wrong before this existed, all from
 * treating a handle as a person: the 2023 KRÜ Klaus (Nicolás Ferrari) wore the
 * Korean klaus's P-id and photograph; four Korean Challengers players carried
 * the name and birthday of a Malaysian, an Indonesian, a Cambodian and a
 * Taiwanese player whose Liquipedia page sits under the same handle; and
 * nobody outside the 2026 world had a face at all, because H ids were dealt
 * per year. Also here: a man who coaches now is not on the market (Biank).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dossierOf } from '../src/engine/dossier'
import { createNewGame, WORLD_PLAYERS } from '../src/engine/world'
import { createManager } from '../src/engine/manager'
import { ALL_CARDS, isPlayerCard } from '../src/engine/cards'
import type { RawWorld } from '../src/engine/eras'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const J = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const dossier = J('src/data/dossier.json')
const over = J('data-raw/overrides.json')
const people = J('data-raw/people.json') as Record<string, { nat?: string; real?: string; birth?: string }>
const vlrOfP = new Map<string, string>(Object.entries(dossier.players).map(([id, d]: [string, any]) => [id, String(d.vlr ?? '')]))

console.log('=== 历史档：一个 vlr 编号一个人 ===')
const seen = new Map<string, string>()     // id -> vlr, across years
for (const year of [2023, 2024, 2025]) {
  const w = J(`src/data/world_${year}.json`) as RawWorld
  const tier = new Map(w.teams.map((t) => [t.id, t.tier]))
  check(`${year}: 每个人都带 vlr 编号`, w.players.every((p: any) => p.vlrId), w.players.filter((p: any) => !p.vlrId).slice(0, 3).map((p) => p.ign).join(','))
  const wrongP = w.players.filter((p: any) => p.id.startsWith('P') && vlrOfP.get(p.id) && vlrOfP.get(p.id) !== String(p.vlrId))
  check(`${year}: 沿用 P 编号的，vlr 编号和 2026 的那个人一致`, wrongP.length === 0, wrongP.slice(0, 4).map((p: any) => `${p.id}:${p.ign}`).join(','))
  const clash = w.players.filter((p: any) => seen.has(p.id) && seen.get(p.id) !== String(p.vlrId))
  check(`${year}: 同一个编号在各年是同一个人`, clash.length === 0, clash.slice(0, 4).map((p) => `${p.id}:${p.ign}`).join(','))
  for (const p of w.players as any[]) seen.set(p.id, String(p.vlrId))
  const vids = w.players.map((p: any) => String(p.vlrId))
  check(`${year}: 没有人出现两次`, new Set(vids).size === vids.length)
  const t1 = w.players.filter((p) => tier.get(p.teamId ?? '') === 1)
  const faces = t1.filter((p) => { const d = dossierOf(p.id); return d?.img && existsSync(`public/faces/${d.img}`) })
  check(`${year}: 一级队选手 95% 以上有照片`, faces.length / t1.length >= 0.95, `${faces.length}/${t1.length}`)
  check(`${year}: 每个人都有国籍`, w.players.every((p) => p.nat || dossierOf(p.id)?.nat))
  const off = w.players.filter((p: any) => people[String(p.vlrId)]?.birth && p.birth && p.birth !== people[String(p.vlrId)].birth && !p.id.startsWith('P'))
  check(`${year}: 生日来自按 vlr 编号核对过的记录`, off.length <= 3, off.slice(0, 4).map((p) => `${p.ign} ${p.birth}`).join(','))
}
{
  const w23 = J('src/data/world_2023.json') as RawWorld
  const klaus = w23.players.find((p) => p.ign === 'Klaus') as any
  check('2023 KRÜ 的 Klaus 是阿根廷人 Nicolás Ferrari，不是 2026 的韩国 klaus', klaus?.nat === 'ar' && klaus.id !== 'P196' && /Ferrari/.test(klaus.realName ?? ''), `${klaus?.id} ${klaus?.nat} ${klaus?.realName}`)
  check('2023 NRG 的指挥叫 FNS', w23.players.some((p) => p.ign === 'FNS') && !w23.players.some((p) => p.ign === 'FiNESSE'))
  const w25 = J('src/data/world_2025.json') as RawWorld
  const k = w25.players.find((p) => p.ign.toLowerCase() === 'k1ng') as any
  check('2025 NBL 的 k1Ng 是巴基斯坦人，没有韩国 k1Ng 的名字', k?.nat === 'pk' && !/이승원/.test(k.realName ?? ''), `${k?.nat} ${k?.realName}`)
}

{
  // owner, 2026-09-18: 「狼队aluba和balua是一个人」 — vlr keeps two pages for him
  const w23 = J('src/data/world_2023.json') as RawWorld
  const him = w23.players.filter((p) => ['aluba', 'balua'].includes(p.ign.toLowerCase()))
  check('2023 ME 的 aluba 只有一个人，用他 2026 的编号', him.length === 1 && him[0].id === 'P220', him.map((p) => `${p.id}:${p.ign}`).join(','))
  for (const year of [2023, 2024, 2025]) {
    const w = J(`src/data/world_${year}.json`) as RawWorld
    const un = w.players.filter((p) => ['Shao', 'SUYGETSU'].includes(p.ign) && p.nat !== 'ru')
    check(`${year}: Shao、SUYGETSU 是俄罗斯，不是 vlr 的空白旗`, un.length === 0, un.map((p) => `${p.ign}:${p.nat}`).join(','))
  }
}
for (const [ign, nat] of [['Shao', 'ru'], ['SUYGETSU', 'ru'], ['jawgemo', 'kh']]) {
  const p = WORLD_PLAYERS.find((x) => x.ign === ign)
  check(`2026：${ign} 的国籍是 ${nat}（世界和档案一致）`, p?.nat === nat && dossierOf(p.id)?.nat === nat, `${p?.nat} / ${p && dossierOf(p.id)?.nat}`)
}

console.log('\n=== 2026：串了人的四个韩国选手 ===')
for (const [ign, real] of [['kAyle', '정수용'], ['Ray', '오은혁'], ['Cloudy', '구민재'], ['shu', '윤시후']]) {
  const p = WORLD_PLAYERS.find((x) => (x.handle ?? x.ign) === ign)
  check(`${ign} 是 ${real}`, !!p && (p.realName ?? '').includes(real) && (p.nat || dossierOf(p.id)?.nat) === 'kr', `${p?.realName} / ${p?.nat}`)
}
for (const [vid, h] of Object.entries(over.handles as Record<string, { ign: string; vlr: string }>)) {
  const p = WORLD_PLAYERS.find((x) => vlrOfP.get(x.id) === vid)
  if (p) check(`${h.vlr} 在游戏里叫 ${h.ign}`, p.ign === h.ign && ALL_CARDS.some((c) => isPlayerCard(c) && c.playerId === p.id && c.ign === h.ign))
}

console.log('\n=== 现任教练不在转会市场 ===')
{
  const g = createNewGame('T0', '测试', 7, createManager('测试', 'veteran', 'young'))
  for (const [ign, tag] of Object.entries(over.nowCoach as Record<string, string>)) {
    const raw = WORLD_PLAYERS.find((p) => p.ign.toLowerCase() === ign.toLowerCase())
    check(`${ign}（${tag} 教练）不是可签的选手`, !!raw && !g.players[raw.id], raw?.id)
    check(`${ign} 的选手卡还在`, ALL_CARDS.some((c) => isPlayerCard(c) && c.playerId === raw?.id))
    const club = Object.values(g.teams).find((t) => t.tag === tag)
    check(`${tag} 的主教练是 ${ign}`, club?.coach?.name.toLowerCase() === ign.toLowerCase(), club?.coach?.name)
  }
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
