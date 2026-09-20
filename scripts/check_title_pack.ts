/**
 * A 大师 title pays its 十连包 once — the first time it is reached.
 *
 *   npx tsx scripts/check_title_pack.ts
 *
 * 2026-09-19, from the group: 「天梯赢一把就给一个十连包，今天已经开了 12 个」.
 * The title pack compared the title the account holds NOW with the title of
 * its best score EVER. An account that had reached 不朽 (1,000) and slipped
 * back under it holds 「大师」 against a best of 「不朽」 — different — so every
 * win down there, the score having gone up, paid a 十连包. In the code since
 * 2026-08-31; it needed people to reach 不朽 and fall back for anyone to meet it.
 */
import { MASTER_DIV, MASTER_TITLES, newGacha, recordLadder } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const at = (points: number, bestPoints: number): GachaState => {
  const g = newGacha('VM-TEST', '头衔', '2026-09-19')
  g.ladder = { ...g.ladder, div: MASTER_DIV, best: MASTER_DIV, stars: 0, points, bestPoints }
  return g
}
const immortal = MASTER_TITLES.find((t) => t.name === '不朽')!.at
const radiant = MASTER_TITLES.find((t) => t.name === '辐能')!.at

// the report: been to 不朽, back under it, twelve wins in a day
{
  const g = at(immortal - 400, immortal + 60)
  let packs = 0
  for (let i = 0; i < 12; i++) { const out = recordLadder(g, true, 86); if (out.pack === 'ten') packs++ }
  check('到过不朽、掉回大师的账号连赢 12 场：一个十连包都不发', packs === 0 && (g.packs.ten ?? 0) === 0, `${packs} 个`)
}
// climbing back over a line already crossed pays nothing; the line above it still does
{
  const g = at(immortal - 30, immortal + 60)
  const back = recordLadder(g, true, 95)
  check('重新回到不朽：不再发', g.ladder.points! >= immortal && back.pack !== 'ten' && !back.promoted, `${g.ladder.points} 分`)
}
{
  const g = at(immortal - 30, immortal - 30)
  const first = recordLadder(g, true, 95)
  check('第一次到不朽：发一个，算一次晋级', g.ladder.points! >= immortal && first.pack === 'ten' && first.promoted === true && g.packs.ten === 1)
  const next = recordLadder(g, true, 95)
  check('到了之后再赢：不发', next.pack !== 'ten' && g.packs.ten === 1)
}
{
  const g = at(radiant - 30, radiant - 30)
  check('第一次到辐能：发一个', recordLadder(g, true, 95).pack === 'ten' && g.packs.ten === 1)
  g.ladder.points = radiant - 300
  let packs = 0
  for (let i = 0; i < 8; i++) if (recordLadder(g, true, 86).pack === 'ten') packs++
  check('从辐能掉下来再往回赢：不发', packs === 0 && g.packs.ten === 1, `${packs} 个`)
}
// a loss never pays, whatever the titles say
{
  const g = at(immortal - 400, immortal + 60)
  check('输了不发', recordLadder(g, false, 86).pack === undefined && (g.packs.ten ?? 0) === 0)
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
