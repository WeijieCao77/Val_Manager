/**
 * KRX is DRX renamed (owner, 2026-10-13: 「把KRX和DRX两个队伍视作一个队伍队员互相有
 * 羁绊，KRX是改名后的DRX」): a 首尔/曼谷 DRX card, a retired DRX or KRX card, today's
 * KRX players and their coach all count as one club.
 *
 *   npx tsx scripts/check_club_rename.ts
 */
import { cardById, chemistry } from '../src/engine/cards'
import { squadTeamIdentity } from '../src/engine/teamIdentity'

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  ${detail}` : ''}`)
  if (!ok) bad++
}
const need = (id: string) => {
  const c = cardById(id)
  if (!c) { console.log(`FAIL 找不到卡 ${id}`); process.exit(1) }
  return c
}
const link = (a: string, b: string) => {
  need(a); need(b)
  return chemistry({ slots: [a, b, null, null, null], coach: null }).links[0]?.why ?? null
}

// 现役 KRX: p:P155 MaKo, p:P158 yong; 首尔 DRX: s24:804 BuZz; 曼谷 DRX: b25:1916 free1ng
// 退役: R:zest-1015 Zest (DRX 彩卡), r:25025 Estrella (KRX 普卡)
check(link('s24:804', 'p:P158') === 'club', '首尔 DRX 和现役 KRX 是同队', String(link('s24:804', 'p:P158')))
check(link('b25:1916', 'p:P158') === 'club', '曼谷 DRX 和现役 KRX 是同队', String(link('b25:1916', 'p:P158')))
check(link('s24:804', 'b25:1916') === 'club', '首尔 DRX 和曼谷 DRX 是同队', String(link('s24:804', 'b25:1916')))
check(link('R:zest-1015', 'p:P158') === 'club', '退役 DRX 彩卡和现役 KRX 是同队', String(link('R:zest-1015', 'p:P158')))
check(link('r:25025', 's24:804') === 'former', '退役 KRX 普卡和首尔 DRX 有老队友默契', String(link('r:25025', 's24:804')))
check(link('R:zest-1015', 'r:25025') === 'former', '退役 DRX 和退役 KRX 有老队友默契', String(link('R:zest-1015', 'r:25025')))

const coached = chemistry({ slots: ['s24:804', 'R:zest-1015', null, null, null], coach: 'c:termi' }).coachLinks
check(coached.filter((l) => l.why === 'club').length === 2, 'KRX 教练 termi 算首尔 DRX 和退役 DRX 彩卡是自己队的', JSON.stringify(coached))

// 队标背景: a retired DRX 彩卡 beside four of today's KRX and termi is a KRX five
const ident = squadTeamIdentity({ slots: ['R:zest-1015', 'p:P155', 'p:P158', 'p:P157', 'p:P159'], coach: 'c:termi' })
check(ident?.tag === 'KRX', '退役 DRX 彩卡 + 四名现役 KRX + termi 有 KRX 队标背景', String(ident?.tag))

// nobody else moved: another club's Seoul card is still no 同队 of KRX's
check(link('s24:804', 'p:P1') !== 'club', '别的队照旧不算同队', String(link('s24:804', 'p:P1')))
if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
