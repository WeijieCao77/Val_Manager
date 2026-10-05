/**
 * 淘汰赛预测分享卡: everything on the canvas, nothing on top of anything else,
 * the bracket's columns in round order (sharePlayoff.ts playoffShareLayout).
 *
 *   npx tsx scripts/check_share_playoff.ts
 */
import { playoffShareLayout, PO_SHARE_H, PO_SHARE_W } from '../src/ui/cards/sharePlayoff'
import { FEEDS, P_SLOTS } from '../src/engine/predictPlayoffs'
import type { Box } from '../src/ui/cards/sharePlayoff'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const L = playoffShareLayout()
const inside = (b: Box) => b.x >= 40 && b.y >= 40 && b.x + b.w <= PO_SHARE_W - 40 && b.y + b.h <= PO_SHARE_H - 40
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const named: [string, Box][] = [['header', L.header], ['hero', L.hero], ['footer', L.footer], ['qr', L.qr],
  ...P_SLOTS.map((k) => [k, L.match[k]] as [string, Box])]
check('1080 × 1350（4:5）', L.width === 1080 && L.height === 1350)
const out = named.filter(([, b]) => !inside(b)).map(([n, b]) => `${n} ${JSON.stringify(b)}`)
check('每一块都在画布内，四边留白至少 40', out.length === 0, out.join(' '))
const hits: string[] = []
for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
  if (overlap(named[i][1], named[j][1])) hits.push(`${named[i][0]}×${named[j][0]}`)
}
check('没有两块叠在一起', hits.length === 0, hits.join(' '))
check('队徽在冠军区里', L.crest.x >= L.hero.x && L.crest.y >= L.hero.y && L.crest.x + L.crest.w <= L.hero.x + L.hero.w && L.crest.y + L.crest.h <= L.hero.y + L.hero.h)
// every match sits to the right of the matches that feed it
const late = Object.entries(FEEDS).filter(([k, refs]) => refs.some((r) => {
  const from = 'win' in r ? r.win : r.lose
  return L.match[from as keyof typeof L.match].x > L.match[k as keyof typeof L.match].x
}))
check('每场比赛都在它的来源右边或同列（败者组从胜者组掉下来）', late.length === 0, late.map(([k]) => k).join(' '))
check('标题在各自那一列的比赛上方', L.titles.every((t) => P_SLOTS.some((k) => L.match[k].x === t.x && L.match[k].y > t.y)))
check('二维码至少 120 像素，扫得出来', L.qr.w >= 120 && L.qr.h === L.qr.w)
console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
