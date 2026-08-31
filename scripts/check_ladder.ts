/**
 * The ladder, from 青铜 III to a number with no ceiling.
 *
 *   npx tsx scripts/check_ladder.ts
 *
 * Two complaints, both about the same thing: 「段位太少了」 and 「到大师就封顶
 * 了，一直打那个星也不会长」. So each division is cut into numbered rungs, and
 * 大师 stops counting stars and starts counting points.
 *
 * The rungs are deliberately NOT a longer climb — the same 26 stars reach 大师
 * as before, cut into sixteen promotions instead of five. That is the thing
 * most easily broken by a later tweak, so it is asserted here in both
 * directions: the total per division, and the number of rungs.
 */
import {
  DIVISIONS, MASTER_DIV, MASTER_WIN, MASTER_LOSS, TIERS_PER_DIV, masterPoints,
  masterTitle, newGacha, oppBumpFor, rankName, recordLadder, starsFor,
  starsOnTier, tierOf, tierStars,
} from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'

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
const fresh = (): GachaState => newGacha('VM-TEST', '审计', '2026-09-01')

// ---- the rungs, and that they did not lengthen the climb
{
  const toMaster = DIVISIONS.slice(0, MASTER_DIV)
    .reduce((n, _, d) => n + starsFor(d), 0)
  check('打到大师还是 26 颗星，没有变长', toMaster === 26, `${toMaster} 颗`)
  const rungs = TIERS_PER_DIV.slice(0, MASTER_DIV).reduce((a, b) => a + b, 0)
  check('小段数量比原来的 5 个大段多得多', rungs === 16, `${rungs} 个小段`)
  check('钻石是四个小段', TIERS_PER_DIV[4] === 4)
  check('大师没有小段', TIERS_PER_DIV[MASTER_DIV] === 1 && starsFor(MASTER_DIV) === 0)

  // the badge counts down inside a division: III → II → I
  check('青铜从 III 开始', rankName(0, 0) === '青铜 III', rankName(0, 0))
  check('攒满就到 I', rankName(0, 2) === '青铜 I', rankName(0, 2))
  check('钻石从 IV 开始', rankName(4, 0) === '钻石 IV', rankName(4, 0))
  check('大师显示分数而不是罗马数字', rankName(MASTER_DIV, 0, 1234) === '不朽 1234',
    rankName(MASTER_DIV, 0, 1234))

  // every star in every division must land on a real rung
  let bogus = 0
  for (let d = 0; d < MASTER_DIV; d++) {
    for (let st = 0; st < starsFor(d); st++) {
      const t = tierOf(d, st)
      if (t < 0 || t >= TIERS_PER_DIV[d]) bogus++
      if (starsOnTier(d, st) >= tierStars(d)) bogus++
    }
  }
  check('每一颗星都落在一个真实的小段上', bogus === 0, `${bogus} 处越界`)
}

// ---- climbing all the way, one win at a time
{
  const g = fresh()
  let wins = 0
  while (g.ladder.div < MASTER_DIV && wins < 200) { recordLadder(g, true); wins++ }
  check('一路赢能打到大师', g.ladder.div === MASTER_DIV, `用了 ${wins} 胜`)
  check('进大师之后星星清零', g.ladder.stars === 0)
  check('进大师之后开始有分数', g.ladder.points === 0)
}

// ---- and past it, where the ladder stops ending
{
  const g = fresh()
  g.ladder.div = MASTER_DIV
  g.ladder.points = 0
  g.ladder.streak = 0

  const before = g.ladder.points
  const out = recordLadder(g, true, 89)
  check('大师赢一场加分', (g.ladder.points ?? 0) > before,
    `+${out.pointsDelta}（对手 89 分）`)
  check('结果里带着分数和称号', out.points != null && !!out.title, `${out.title} ${out.points}`)
  check('打强队给得更多', masterPoints(true, 89, 0) > masterPoints(true, 82, 0),
    `${masterPoints(true, 89, 0)} vs ${masterPoints(true, 82, 0)}`)
  check('连胜再多给一点', masterPoints(true, 89, 3) > masterPoints(true, 89, 1))

  g.ladder.points = 5
  recordLadder(g, false, 85)
  check('输了扣分但不会扣成负数', g.ladder.points === 0, `${g.ladder.points}`)
  check('输了也不会掉出大师', g.ladder.div === MASTER_DIV)
  // break-even is loss/(win+loss): +20/−15 pays from a 42.9% win rate up
  const breakEven = MASTER_LOSS / (MASTER_WIN + MASTER_LOSS)
  check('保本胜率低于五成——榜单不该把人打下去', breakEven < 0.5,
    `赢 +${MASTER_WIN} 输 −${MASTER_LOSS}，保本 ${(breakEven * 100).toFixed(1)}%`)
}

// ---- titles, and the pack that comes with a new one
{
  check('0 分是大师', masterTitle(0) === '大师')
  check('1000 分是不朽', masterTitle(1000) === '不朽')
  check('2500 分是辐能', masterTitle(2500) === '辐能')

  const g = fresh()
  g.ladder.div = MASTER_DIV
  g.ladder.best = MASTER_DIV
  g.ladder.points = 990
  g.ladder.bestPoints = 990
  const packsBefore = g.packs.ten ?? 0
  const out = recordLadder(g, true, 89)
  check('第一次上不朽送一个十连包', (g.packs.ten ?? 0) === packsBefore + 1,
    `${out.title} ${out.points}`)
  // and not again for the same title
  g.ladder.points = 1100
  const out2 = recordLadder(g, true, 89)
  check('同一个称号不会反复送包', (g.packs.ten ?? 0) === packsBefore + 1, out2.title ?? '')
}

// ---- the opposition has to keep up, since the world tops out at 89
{
  check('0 分不加强', oppBumpFor(0) === 0)
  check('分数越高对手越强', oppBumpFor(1000) > oppBumpFor(250))
  check('加强有上限', oppBumpFor(99_999) === 10, `${oppBumpFor(99_999)}`)
  check('最强的队加满之后到 99', 89 + oppBumpFor(99_999) === 99)
}

// ---- an account that was already 大师 when this shipped
{
  const g = fresh()
  g.ladder.div = MASTER_DIV
  g.ladder.stars = 8            // what the old ladder left there
  delete (g.ladder as { points?: number }).points
  const out = recordLadder(g, true, 85)
  check('老的大师存档直接从 0 分开始记', out.points === masterPoints(true, 85, 1),
    `${out.points} 分`)
  check('不会因为缺字段崩掉', Number.isFinite(g.ladder.points ?? NaN))
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
