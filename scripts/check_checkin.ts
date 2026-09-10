/**
 * 每日签到：格子上写的和实际发的必须是同一个包。
 *
 *   npx tsx scripts/check_checkin.ts
 *
 * 「很多人反馈每日签到里有一个选拔包实际上发的是试训包」。屏幕上那条格子是
 * 七天一轮的——第 3、第 6 格写着选拔包，第 7 格写着十连包——但奖励是按「连续
 * 签到的总天数」算的，两者只有第一周对得上：连签第 10 天，格子亮的是本轮第 3
 * 格（选拔包），10 不是 3 的倍数，发的是试训包。
 *
 * 所以这里不是去测「10 % 3」，而是把整整四轮走一遍，每一天都拿屏幕上那条格
 * 子的说法和真发的包对一次。格子的算法从 ui/cards/Packs.tsx 抄过来，抄错了
 * 这里也会响。
 */
import { checkIn, newGacha } from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const day = (n: number): string => {
  const d = new Date('2026-01-01T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** what the seven-box strip on 抽卡页 promises for this streak — Packs.tsx */
const promised = (streak: number): PackKind => {
  const box = streak > 0 ? ((streak - 1) % 7) + 1 : 0
  return box === 7 ? 'ten' : box % 3 === 0 ? 'elite' : 'scout'
}
const CN: Record<string, string> = { ten: '十连包', elite: '选拔包', scout: '试训包' }

const g: GachaState = newGacha('audit')
const rows: string[] = []
let mismatch = 0
let elites = 0
let tens = 0
for (let i = 0; i < 28; i++) {
  const r = checkIn(g, day(i))
  const streak = r.streak
  // the extra 试训包 rides along with every check-in; the day's OWN pack is
  // the best thing in the envelope
  const got: PackKind = r.packs.ten ? 'ten' : r.packs.elite ? 'elite' : 'scout'
  const want = promised(streak)
  if (got !== want) { mismatch++; rows.push(`第 ${streak} 天：格子写 ${CN[want]}，实发 ${CN[got]}`) }
  if (got === 'elite') elites++
  if (got === 'ten') tens++
  check(`连签第 ${String(streak).padStart(2)} 天，发的就是格子上写的 ${CN[want]}`, got === want,
    got === want ? '' : `实发 ${CN[got]}`)
}
check('四周里一次都没有对不上', mismatch === 0, rows.join('；'))
check('每轮两个选拔包，四轮八个', elites === 8, `${elites} 个`)
check('每轮一个十连包，四轮四个', tens === 4, `${tens} 个`)
check('每天都还有那个 300 金币和试训包', (g.packs.scout ?? 0) >= 28, `试训包 ${g.packs.scout}`)

// ---- 断签之后从头数，格子也从头数
{
  const h: GachaState = newGacha('audit2')
  const start = h.packs.elite ?? 0           // 开局本来就送了一个
  for (let i = 0; i < 5; i++) checkIn(h, day(i))
  const broke = checkIn(h, day(9))          // 中间断了三天
  check('断签之后连续天数归 1', broke.streak === 1, `${broke.streak}`)
  const third = checkIn(h, day(10)).streak === 2 && checkIn(h, day(11)).streak === 3
  check('重新数到第 3 天，选拔包又来了', third && (h.packs.elite ?? 0) - start === 2,
    `签到发了 ${(h.packs.elite ?? 0) - start} 个`)
}

// ---- 同一天签两次只算一次
{
  const h: GachaState = newGacha('audit3')
  checkIn(h, day(0))
  const again = checkIn(h, day(0))
  check('同一天再签一次什么都不给', again.already && again.coins === 0 && !Object.keys(again.packs).length)
}

console.log(bad ? `\n${bad} 条不过` : '\n全部通过')
process.exit(bad ? 1 : 0)
