/**
 * 双败, as a state machine: every way through a bracket, by hand.
 *
 *   npx tsx scripts/check_cup_double.ts
 *
 * The first loss drops the five into the 败者组 and costs nothing else; a win
 * there rejoins the next round; losing the final is 败者组决赛 and then the
 * final again; the second loss, anywhere, ends it and pays by rounds
 * advanced. A bracket drawn before 双败 stays single elimination.
 */
import {
  newGacha, enterCup, recordCup, cupOpponent, cupBo, cupExitPrize, cupTitlePrize, cupEaseFor, cupFloor, repairCup,
  STAMINA_MAX, STAMINA_COST, CUP_EASE_MAX, CUP_SHARPEN_MAX,
} from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const now = Date.parse('2026-09-17T12:00:00Z')
const fresh = (seed: number, rating = 85): GachaState => {
  const g = newGacha('VM-CVPD-CVPD-CVPD-CVPD-CVPD', '双败', '2026-09-17')
  g.seed = seed
  g.daily.stamina = STAMINA_MAX
  g.daily.staminaAt = now
  enterCup(g, rating, now)
  return g
}
const play = (g: GachaState, win: boolean) => {
  const opponent = cupOpponent(g)!
  return recordCup(g, { opponent, win, mapsWon: win ? 2 : 0, mapsLost: win ? 0 : 2 })
}

{
  const g = fresh(1)
  const cup = g.cup!
  const rounds = cup.path.length
  check('新报名的是双败，只扣一次门票', cup.double === true && g.daily.stamina === STAMINA_MAX - STAMINA_COST.cup)
  const coins = g.coins
  let out = play(g, false)
  check('第一次输：掉进败者组，没出局，也没有结算', out.dropped === true && !out.done && cup.dropped === true && !!cup.lower && g.coins === coins)
  check('败者组对手不在签表里，BO3', !cup.path.includes(cup.lower!) && CUP_TEAMS.some((t) => t.id === cup.lower) && cupBo(cup) === 3 && cupOpponent(g) === cup.lower)
  const lowerClub = cup.lower!
  out = play(g, true)
  check('败者组赢了：回到下一轮，体力没再扣', !out.done && cup.round === 1 && !cup.lower && cupOpponent(g) === cup.path[1] && g.daily.stamina === STAMINA_MAX - STAMINA_COST.cup)
  check('败者组那场记在第一轮名下', cup.legs.length === 2 && cup.legs[1].lower === true && cup.legs[1].round === 0 && cup.legs[1].opponent === lowerClub)
  out = play(g, false)
  check('第二次输：出局，按晋级轮数给钱', out.done && !out.won && cup.done && out.coins === cupExitPrize(1) && g.coins === coins + cupExitPrize(1), JSON.stringify(out))
  check('出局后没有对手了', cupOpponent(g) === null)
  void rounds
}
{
  // both losses at the first hurdle: the ticket bought two matches and the smallest purse
  const g = fresh(2)
  play(g, false)
  const out = play(g, false)
  check('首轮和败者组都输：两场，最低奖金', out.done && out.coins === cupExitPrize(0) && g.cup!.legs.length === 2)
}
{
  // all the way, never losing
  const g = fresh(3)
  const rounds = g.cup!.path.length
  let out = play(g, true)
  while (!out.done) out = play(g, true)
  check('一场不输：打满轮数就夺冠', out.won && g.cup!.legs.length === rounds && out.coins === cupTitlePrize(rounds))
}
{
  // lose the final with the life in hand
  const g = fresh(4)
  const cup = g.cup!
  const last = cup.path.length - 1
  for (let i = 0; i < last; i++) play(g, true)
  check('决赛是 BO5', cupBo(cup) === 5 && cup.round === last)
  let out = play(g, false)
  check('决赛输了还有命：打败者组决赛（BO3）', out.dropped === true && !cup.done && !!cup.lower && cupBo(cup) === 3)
  out = play(g, true)
  check('败者组决赛赢了：重打决赛，还是原来的对手，BO5', !out.done && cup.round === last && !cup.lower && cupOpponent(g) === cup.path[last] && cupBo(cup) === 5)
  out = play(g, true)
  check('重赛赢了就是冠军，奖金不打折', out.won && out.coins === cupTitlePrize(cup.path.length) && cup.legs.length === cup.path.length + 2)
}
{
  const g = fresh(5)
  const cup = g.cup!
  const last = cup.path.length - 1
  for (let i = 0; i < last; i++) play(g, true)
  play(g, false)
  const out = play(g, false)
  check('败者组决赛也输了：止步决赛，按晋级轮数给钱', out.done && !out.won && out.coins === cupExitPrize(last))
}
{
  // a life already spent does not come back in the final
  const g = fresh(6)
  const cup = g.cup!
  play(g, false); play(g, true)
  while (cup.round < cup.path.length - 1) play(g, true)
  const out = play(g, false)
  check('用过一次机会之后，决赛输了直接出局', out.done && !out.won && !out.dropped)
}
{
  // legs never exceed rounds + 2, whatever happens
  let worst = 0, stuck = 0
  for (let seed = 10; seed < 400; seed++) {
    const g = fresh(seed, 60 + (seed % 45))
    let n = 0
    let x = seed
    while (!g.cup!.done && n < 20) { x = (x * 1103515245 + 12345) >>> 0; play(g, (x >>> 16) % 100 < 55); n++ }
    if (!g.cup!.done) stuck++
    worst = Math.max(worst, n - g.cup!.path.length)
    const ids = [...g.cup!.path, ...g.cup!.legs.filter((l) => l.lower).map((l) => l.opponent)]
    if (new Set(ids).size !== ids.length) stuck++
  }
  check('随便怎么输赢，一届最多比轮数多两场，败者组对手不重复', stuck === 0 && worst <= 2, `多 ${worst} 场`)
}
{
  // a bracket drawn before 双败: no flag, one loss, out
  const g = fresh(7)
  delete g.cup!.double
  const out = play(g, false)
  check('改版前报名的旧杯赛还是单败，输一场就结算', out.done && !out.dropped && out.coins === cupExitPrize(0))
}
{
  const lowest = Math.min(...CUP_TEAMS.map((t) => t.rating)), highest = Math.max(...CUP_TEAMS.map((t) => t.rating))
  check('让分：只给低分阵容，有上限', cupEaseFor(lowest) > 0 && cupEaseFor(40) === CUP_EASE_MAX && cupEaseFor(Math.ceil(cupFloor()) + 9) === 0 && cupEaseFor(85) === 0)
  check('加强：只给超过最强俱乐部的阵容，有上限', cupEaseFor(highest - 3) === 0 && cupEaseFor(highest - 2) === -1 && cupEaseFor(highest + 2) === -CUP_SHARPEN_MAX, `${cupEaseFor(highest + 2)}`)
  check('加强不超过上限', cupEaseFor(130) === -CUP_SHARPEN_MAX)
  // a 败者组 club that has since left the world is replaced, like a club in the path
  const g = fresh(8)
  play(g, false)
  g.cup!.lower = 'club-that-left'
  repairCup(g)
  check('败者组对手的俱乐部不在了：换成最接近的一支', !!g.cup!.lower && CUP_TEAMS.some((t) => t.id === g.cup!.lower) && !g.cup!.path.includes(g.cup!.lower!))
}
console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
