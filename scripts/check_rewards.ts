/**
 * What the ladder and the cup hand back in packs, and the meter they draw on.
 *
 *   npx tsx scripts/check_rewards.ts
 *
 * 2026-09-10: the cap went to 30, the ladder pays a 试训包 every fifth win and
 * a 选拔包 every twentieth, a cup run of two rounds pays a 试训包, the title
 * pays by the bracket's depth, and a 彩卡 brings 2 默契 rather than 4.
 */
import {
  newGacha, recordLadder, enterCup, recordCup, cupExitPacks, cupTitlePacks,
  STAMINA_MAX, STAMINA_COST, LADDER_WIN_PACK_EVERY, LADDER_WIN_PACK_BIG_EVERY,
} from '../src/engine/gacha'
import type { GachaState, PackKind } from '../src/engine/gacha'
import { chemistry, LEGEND_CARDS, BASE_PLAYER_CARDS } from '../src/engine/cards'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const fresh = (): GachaState => newGacha('VM-TEST', '审计', '2026-09-01')
const packsOf = (g: GachaState) => ({ ...g.packs })
const delta = (a: Partial<Record<PackKind, number>>, b: Partial<Record<PackKind, number>>): Partial<Record<PackKind, number>> => {
  const out: Partial<Record<PackKind, number>> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<PackKind>) {
    const d = (b[k] ?? 0) - (a[k] ?? 0)
    if (d) out[k] = d
  }
  return out
}

// ---- the meter
check('体力上限 30', STAMINA_MAX === 30)
check('满体力打 15 场天梯或 6 场杯赛', Math.floor(STAMINA_MAX / STAMINA_COST.ladder) === 15 && Math.floor(STAMINA_MAX / STAMINA_COST.cup) === 6)

// ---- the ladder: packs by win count, promotion packs on top
{
  const g = fresh()
  const got: Record<number, PackKind | undefined> = {}
  const promo: number[] = []
  for (let w = 1; w <= 40; w++) {
    const before = packsOf(g)
    const out = recordLadder(g, true, 80)
    got[w] = out.milestone
    if (out.pack) promo.push(w)
    const d = delta(before, packsOf(g))
    const expect: Partial<Record<PackKind, number>> = {}
    if (out.milestone) expect[out.milestone] = (expect[out.milestone] ?? 0) + 1
    if (out.pack) expect[out.pack] = (expect[out.pack] ?? 0) + 1
    if (JSON.stringify(d) !== JSON.stringify(expect)) check(`第 ${w} 胜发的包和说的一样`, false, `${JSON.stringify(d)} vs ${JSON.stringify(expect)}`)
    if (out.milestone && out.milestoneWins !== w) check(`第 ${w} 胜的里程碑写的是第几胜`, false, String(out.milestoneWins))
  }
  const fifths = Object.entries(got).filter(([, p]) => p).map(([w]) => Number(w))
  check('每 5 胜一个包，40 胜里 8 次', fifths.join(',') === [5, 10, 15, 20, 25, 30, 35, 40].join(','), fifths.join(','))
  check('第 5 胜是试训包，第 20 胜是选拔包', got[5] === 'scout' && got[20] === 'elite' && got[40] === 'elite' && got[15] === 'scout')
  check('升段的包照发、另算', promo.length >= 3, `升段 ${promo.length} 次`)
  check('输了不算', (() => { const b = packsOf(g); const o = recordLadder(g, false, 80); return !o.milestone && JSON.stringify(delta(b, packsOf(g))) === '{}' })())
  check('常量就是 5 和 20', LADDER_WIN_PACK_EVERY === 5 && LADDER_WIN_PACK_BIG_EVERY === 20)
}

// ---- the cup: packs by depth
{
  check('赢 0、1 轮出局没有包；赢 2 轮起一个试训包', JSON.stringify(cupExitPacks(0)) === '{}' && JSON.stringify(cupExitPacks(1)) === '{}'
    && cupExitPacks(2).scout === 1 && cupExitPacks(4).scout === 1)
  check('冠军：3 轮选拔包，4 轮选拔包+试训包，5 轮十连包',
    JSON.stringify(cupTitlePacks(3)) === '{"elite":1}' && JSON.stringify(cupTitlePacks(4)) === '{"elite":1,"scout":1}' && JSON.stringify(cupTitlePacks(5)) === '{"ten":1}')
  // play one to the end and one out after two wins, whatever bracket is drawn
  const run = (wins: number) => {
    const g = fresh()
    g.daily.stamina = STAMINA_MAX
    const cup = enterCup(g, 88, 1)
    const before = packsOf(g)
    let out = recordCup(g, { opponent: cup.path[0], win: true, mapsWon: 2, mapsLost: 0 })
    for (let i = 1; i < cup.path.length && !out.done; i++) {
      out = recordCup(g, { opponent: cup.path[i], win: i < wins, mapsWon: i < wins ? 2 : 0, mapsLost: i < wins ? 0 : 2 })
    }
    return { rounds: cup.path.length, out, given: delta(before, packsOf(g)) }
  }
  const early = run(2)
  check('两轮之后出局：一个试训包，结果里也写着', !early.out.won && early.given.scout === 1 && early.out.packs?.scout === 1 && early.out.pack === 'scout', JSON.stringify(early))
  const title = run(99)
  check('夺冠发的包按轮数', title.out.won && JSON.stringify(title.given) === JSON.stringify(cupTitlePacks(title.rounds)) && JSON.stringify(title.out.packs) === JSON.stringify(cupTitlePacks(title.rounds)), JSON.stringify(title))
  const one = run(1)
  check('只赢一轮：没有包', JSON.stringify(one.given) === '{}' && !one.out.pack, JSON.stringify(one))
}

// ---- a legend brings two
{
  const legends = LEGEND_CARDS.slice(0, 5)
  const chem5 = chemistry({ slots: legends.map((c) => c.id), coach: null, levels: {} } as never)
  const strangers = BASE_PLAYER_CARDS.filter((c) => c.region === 'Americas').slice(0, 1)
  const one = chemistry({ slots: [legends[0].id, null, null, null, null], coach: null, levels: {} } as never)
  const none = chemistry({ slots: [strangers[0].id, null, null, null, null], coach: null, levels: {} } as never)
  // one legend alone: exactly the legend's own standing, 2 of 41
  check('一张彩卡单独站着：默契 2/41 ≈ 5', one.score === Math.round((2 / 41) * 100) && none.score === 0, `${one.score} vs ${none.score}`)
  check('五张彩卡不超过 50', chem5.score <= 50, `${chem5.score}`)
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
