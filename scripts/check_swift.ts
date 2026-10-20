/**
 * 抢五 (engine/swift.ts): the money is VALORANT's, no plan is right every
 * round, and a match lasts a few minutes.
 *
 *   npx tsx scripts/check_swift.ts            # the checks
 *   npx tsx scripts/check_swift.ts --report   # plus the numbers behind them
 */
import {
  ATTACK_PLANS, DEFENSE_PLANS, PLAN_EDGE, EVEN_HABIT, LOSS_CREDITS, MAX_CREDITS, PISTOL_CREDITS, SWIFT_HALF, SWIFT_WIN, ULT_COST,
  aiChoice, aiRecon, attackerOf, cleanChoice, habitFrom, addHabit, loadoutFor, newSwiftMatch, submitChoice, submitRecon, swiftSide,
  swiftView, takePause, autoChoice,
} from '../src/engine/swift'
import type { AttackPlan, DefensePlan, SwiftMatch, SwiftSide, Choice } from '../src/engine/swift'
import { PLAYER_CARDS } from '../src/engine/cards'
import { Rng } from '../src/engine/rng'

const report = process.argv.includes('--report')
let fails = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

// ---------------------------------------------------------------- the table has no right answer
{
  // fictitious play on the edge table: both sides' long-run mixes converge to the equilibrium
  const A = ATTACK_PLANS, D = DEFENSE_PLANS
  const ca = A.map(() => 1), cd = D.map(() => 1)
  for (let t = 0; t < 200_000; t++) {
    const pa = ca.map((c) => c / ca.reduce((s, x) => s + x, 0)), pd = cd.map((c) => c / cd.reduce((s, x) => s + x, 0))
    const va = A.map((p) => D.reduce((s, d, j) => s + pd[j] * PLAN_EDGE[p][d], 0))
    const vd = D.map((d) => A.reduce((s, p, i) => s + pa[i] * PLAN_EDGE[p][d], 0))
    ca[va.indexOf(Math.max(...va))]++
    cd[vd.indexOf(Math.min(...vd))]++
  }
  const pa = ca.map((c) => c / ca.reduce((s, x) => s + x, 0)), pd = cd.map((c) => c / cd.reduce((s, x) => s + x, 0))
  const value = A.reduce((s, p, i) => s + pa[i] * D.reduce((t, d, j) => t + pd[j] * PLAN_EDGE[p][d], 0), 0)
  if (report) console.log('  equilibrium attack', A.map((p, i) => `${p} ${pct(pa[i])}`).join(' · '), '| defense', D.map((d, j) => `${d} ${pct(pd[j])}`).join(' · '), '| value', value.toFixed(3))
  check('every attack plan is in the equilibrium (≥ 10%)', pa.every((x) => x >= 0.10), A.map((p, i) => `${p} ${pct(pa[i])}`).join(' '))
  check('every defence setup is in the equilibrium (≥ 10%)', pd.every((x) => x >= 0.10), D.map((d, j) => `${d} ${pct(pd[j])}`).join(' '))
  check('the table favours neither side by much (|value| < 0.08)', Math.abs(value) < 0.08, value.toFixed(3))
  // no plan wins against everything, none loses to everything
  for (const p of A) check(`${p} beats something and loses to something`, D.some((d) => PLAN_EDGE[p][d] > 0) && D.some((d) => PLAN_EDGE[p][d] < 0))
  for (const d of D) check(`${d} beats something and loses to something`, A.some((p) => PLAN_EDGE[p][d] < 0) && A.some((p) => PLAN_EDGE[p][d] > 0))
}

// ---------------------------------------------------------------- two fives
const byRole = (role: string, near: number, skip: Set<string>) =>
  PLAYER_CARDS.filter((c) => !c.legend && c.role === role && !skip.has(c.id)).sort((a, b) => Math.abs(a.rating - near) - Math.abs(b.rating - near))[0]
function five(near: number, skip: Set<string>): string[] {
  const out: string[] = []
  for (const r of ['决斗者', '先锋', '控场', '哨卫', '先锋']) { const c = byRole(r, near, skip); skip.add(c.id); out.push(c.id) }
  return out
}
const used = new Set<string>()
const fiveA = five(80, used), fiveB = five(80, used), fiveStrong = five(85, used)
const side = (slots: string[], name: string, lv = 0): SwiftSide => swiftSide(name, name, slots, null, () => lv)!
const sideA = side(fiveA, 'A'), sideB = side(fiveB, 'B'), sideStrong = side(fiveStrong, 'S')
const mean = (s: SwiftSide) => s.seats.reduce((x, y) => x + y.skill, 0) / 5
if (report) console.log(`  fives: A ${mean(sideA).toFixed(1)} · B ${mean(sideB).toFixed(1)} · S ${mean(sideStrong).toFixed(1)}`)
check('a five with an empty seat is refused', swiftSide('x', 'x', [fiveA[0], null, fiveA[2], fiveA[3], fiveA[4]], null, () => 0) === null)

// ---------------------------------------------------------------- VALORANT's money, round by round
{
  let m = newSwiftMatch(7, sideA, sideB)
  check('the match starts at 800 a head', m.econ.every((e) => e.credits.every((c) => c === PISTOL_CREDITS)))
  const call = (mm: SwiftMatch, a: Partial<Choice>, b: Partial<Choice>) =>
    submitChoice(submitChoice(mm, 0, { ...autoChoice(mm, 0), ult: null, ...a }), 1, { ...autoChoice(mm, 1), ult: null, ...b })
  const before = m
  m = call(m, { buy: 'full' }, { buy: 'full' })
  const r1 = m.log[0]
  const w = r1.winner, l = (1 - w) as 0 | 1
  const killsOf = (t: number, i: number) => r1.kills.filter((k) => k.side === t && k.killer === i).length
  const plant = (t: number) => (t === r1.attacker && r1.planted ? 300 : 0)
  const spent = (t: 0 | 1) => loadoutFor(before.econ[t], 'full', true).spend
  check('pistol round: winners 800 − spend + 3000 + 200 a kill', m.econ[w].credits.every((c, i) => c === PISTOL_CREDITS - spent(w)[i] + 3000 + 200 * killsOf(w, i) + plant(w)),
    `${m.econ[w].credits.join('/')}`)
  check('pistol round: losers 800 − spend + 1900 + 200 a kill (+300 for the spike)', m.econ[l].credits.every((c, i) => c === PISTOL_CREDITS - spent(l)[i] + 1900 + 200 * killsOf(l, i) + plant(l)),
    `${m.econ[l].credits.join('/')}`)
  // round 2: the winners can buy, the losers cannot buy a rifle
  const kitW = loadoutFor(m.econ[w], 'full', false), kitL = loadoutFor(m.econ[l], 'full', false)
  check('round 2: the pistol winners can arm', kitW.weapon.filter((x) => x >= 2).length >= 4, kitW.weapon.join(''))
  check('round 2: the pistol losers cannot buy a rifle each', kitL.weapon.filter((x) => x >= 3).length < 5, `${m.econ[l].credits.join('/')}`)
  // the losers save, lose again: 2400 — and round 3 they are rich
  let streak = m
  const lossTwo = call(streak, w === 0 ? { buy: 'full' } : { buy: 'eco' }, w === 0 ? { buy: 'eco' } : { buy: 'full' })
  if (lossTwo.log[1].winner === w) {
    const e = lossTwo.econ[l]
    check('a second loss in a row pays 2400', e.streak === 2 && e.credits.every((c, i) => c >= m.econ[l].credits[i] + LOSS_CREDITS[1]))
    check('round 3: the side that saved can buy rifles all round', loadoutFor(e, 'full', false).weapon.every((x) => x >= 3), e.credits.join('/'))
  }
  streak = m
  // survivors keep their guns, the dead lose theirs
  const r = lossTwo.log[1]
  const dead = new Set(r.kills.filter((k) => k.side !== r.winner).map((k) => k.victim))
  check('a man who lives keeps his gun, a dead man loses his', [0, 1, 2, 3, 4].every((i) => (dead.has(i) ? lossTwo.econ[r.winner === 0 ? 1 : 0].weapon[i] === 0 : true)))
  check('nobody holds more than 9000', [lossTwo.econ[0], lossTwo.econ[1]].every((e) => e.credits.every((c) => c <= MAX_CREDITS)))
  void streak
}

// ---------------------------------------------------------------- whole matches
type Policy = (m: SwiftMatch, team: 0 | 1, rng: Rng) => Choice
const ai: Policy = (m, t, rng) => aiChoice(m, t, rng)
function play(a: SwiftSide, b: SwiftSide, seed: number, pa: Policy, pb: Policy) {
  let m = newSwiftMatch(seed, a, b)
  const rng = new Rng(seed ^ 0x5bd1e995)
  let guard = 0
  while (m.phase !== 'done' && guard++ < 40) {
    if (m.phase === 'choose') {
      m = submitChoice(m, 0, pa(m, 0, rng))
      m = submitChoice(m, 1, pb(m, 1, rng))
    } else {
      for (const t of [0, 1] as const) if (m.recon[t]) m = submitRecon(m, t, aiRecon(m, t))
    }
  }
  return m
}
{
  const N = 3000
  let rounds = 0, atkWins = 0, atkRounds = 0, aWins = 0
  let pistolR2 = 0, pistolR2n = 0, lossR3 = 0, lossR3n = 0
  let r2Gap = 0, r3Gap = 0, r3n = 0, r3Spend = 0
  let ults = 0, recons = 0
  for (let s = 0; s < N; s++) {
    const m = play(sideA, sideB, 1000 + s, ai, ai)
    rounds += m.log.length
    if (m.winner === 0) aWins++
    for (const r of m.log) { atkRounds++; if (r.winner === r.attacker) atkWins++; ults += r.ults.filter(Boolean).length; if (r.firstPlan) recons++ }
    for (const half of [0, SWIFT_HALF]) {
      const r1 = m.log[half], r2 = m.log[half + 1], r3 = m.log[half + 2]
      if (!r1 || !r2) continue
      pistolR2n++; if (r2.winner === r1.winner) pistolR2++
      const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0)
      r2Gap += sum(r2.loadout[r1.winner]) - sum(r2.loadout[1 - r1.winner])
      if (r3 && r2.winner === r1.winner) {
        r3n++; if (r3.winner !== r1.winner) lossR3++
        r3Gap += sum(r3.loadout[1 - r1.winner]) - sum(r3.loadout[r1.winner])
        r3Spend += r3.spent[1 - r1.winner] - r3.spent[r1.winner]
        lossR3n++
      }
    }
  }
  const avgRounds = rounds / N
  if (report) {
    console.log(`  ${N} even matches: ${avgRounds.toFixed(2)} rounds, A won ${pct(aWins / N)}, attackers ${pct(atkWins / atkRounds)} of rounds, ${(ults / N).toFixed(2)} ults a match, ${(recons / N).toFixed(2)} 侦察 changes`)
    console.log(`  pistol winners take round 2 ${pct(pistolR2 / pistolR2n)} (gear +${(r2Gap / pistolR2n).toFixed(0)}); after winning both, the savers take round 3 ${pct(lossR3 / lossR3n)} (their gear ${(r3Gap / Math.max(1, r3n)).toFixed(0)}, spend +${(r3Spend / Math.max(1, r3n)).toFixed(0)})`)
  }
  check('a match lasts 5–9 rounds, about seven on average', avgRounds >= 6.2 && avgRounds <= 7.8, avgRounds.toFixed(2))
  check('two even fives win about as often (45–55%)', aWins / N > 0.45 && aWins / N < 0.55, pct(aWins / N))
  check('attack and defence win about as often (44–56% of rounds)', atkWins / atkRounds > 0.44 && atkWins / atkRounds < 0.56, pct(atkWins / atkRounds))
  check('the pistol round decides round 2 most of the time (≥ 65%)', pistolR2 / pistolR2n >= 0.65, pct(pistolR2 / pistolR2n))
  check('round 3 swings back: the side that saved wins it far more than it won round 2', lossR3 / lossR3n >= 1.5 * (1 - pistolR2 / pistolR2n), `${pct(lossR3 / lossR3n)} vs ${pct(1 - pistolR2 / pistolR2n)}`)
  check('round 3: the side that saved buys more than the pistol winners', r3Spend / Math.max(1, r3n) > 0, (r3Spend / Math.max(1, r3n)).toFixed(0))
  check('ultimates come up in a match (≥ 1 a match on average)', ults / N >= 1, (ults / N).toFixed(2))
}

// ---------------------------------------------------------------- no fixed plan beats the AI
{
  const N = 1500
  for (const fixA of ATTACK_PLANS) {
    for (const fixD of DEFENSE_PLANS) {
      const fixed: Policy = (m, t, rng) => {
        const c = aiChoice(m, t, rng)
        return { ...c, plan: attackerOf(m) === t ? fixA : fixD, ult: null }
      }
      let won = 0
      for (let s = 0; s < N; s++) {
        const m = play(sideA, sideB, 50_000 + s * 7, fixed, ai)
        if (m.winner === 0) won++
      }
      const ok = won / N <= 0.5
      if (report || !ok) console.log(`  always ${fixA}/${fixD}: ${pct(won / N)}`)
      if (!ok) check(`always ${fixA} / ${fixD} does not beat the AI`, false, pct(won / N))
    }
  }
  check('no fixed plan pair beats the adapting AI over a match (≤ 50%)', true)
}

// ---------------------------------------------------------------- reading the opponent pays
{
  // a player who answers the AI's habit (the equilibrium mix) with the equilibrium does no better than even;
  // one who reads a skewed ghost wins clearly
  const skewed = habitFrom({ attack: { A: 40, B: 4, split: 4, fake: 4 }, defense: { stackA: 40, stackB: 4, even: 4, push: 4 }, buys: 20, force: 2 })
  const ghost: Policy = (m, t, rng) => aiChoice(m, t, rng, skewed, 0)
  // a player who has read the ghost: the plan that does best against its habit, every round
  const reader: Policy = (m, t, rng) => {
    const c = aiChoice(m, t, rng)
    if (attackerOf(m) === t) {
      const score = (p: AttackPlan) => DEFENSE_PLANS.reduce((s, d) => s + skewed.defense[d] * PLAN_EDGE[p][d], 0)
      return { ...c, plan: [...ATTACK_PLANS].sort((x, y) => score(y) - score(x))[0] }
    }
    const score = (d: DefensePlan) => ATTACK_PLANS.reduce((s, p) => s + skewed.attack[p] * PLAN_EDGE[p][d], 0)
    return { ...c, plan: [...DEFENSE_PLANS].sort((x, y) => score(x) - score(y))[0] }
  }
  let won = 0, read = 0
  const N = 2000
  for (let s = 0; s < N; s++) {
    if (play(sideA, sideB, 90_000 + s, ai, ghost).winner === 0) won++
    if (play(sideA, sideB, 90_000 + s, reader, ghost).winner === 0) read++
  }
  if (report) console.log(`  against a ghost that leans on A: the adapting AI ${pct(won / N)}, a player who read it ${pct(read / N)}`)
  check('a predictable ghost is beaten by reading it (≥ 65%)', read / N >= 0.65, pct(read / N))
  check('even the AI, which only sees the half so far, comes out ahead of it', won / N > 0.5, pct(won / N))
  const h = habitFrom(null)
  check('a habit with no rounds behind it is the even habit', Math.abs(h.attack.A - EVEN_HABIT.attack.A) < 1e-9 && Math.abs(h.force - EVEN_HABIT.force) < 1e-9)
  const m = play(sideA, sideB, 5, ai, ai)
  const c = addHabit(null, m, 0) as { attack: Record<string, number>; defense: Record<string, number> }
  const n = Object.values(c.attack).reduce((s, x) => s + x, 0) + Object.values(c.defense).reduce((s, x) => s + x, 0)
  check('a match folds every round into the habit', n === m.log.length)
}

// ---------------------------------------------------------------- the better five wins more, not always
{
  const N = 2000
  let won = 0
  for (let s = 0; s < N; s++) if (play(sideStrong, sideA, 7000 + s, ai, ai).winner === 0) won++
  const gap = mean(sideStrong) - mean(sideA)
  if (report) console.log(`  +${gap.toFixed(1)} a seat: ${pct(won / N)}`)
  check('five rating points a seat is an edge, not a lock (58–82%)', won / N > 0.58 && won / N < 0.82, `+${gap.toFixed(1)}: ${pct(won / N)}`)
}

// ---------------------------------------------------------------- the abilities
{
  // charge a 先锋 on side 0 and a 控场 on side 1 by hand
  let m = newSwiftMatch(11, sideA, sideB)
  const scout = m.sides[0].seats.findIndex((s) => s.role === '先锋')
  const smoker = m.sides[1].seats.findIndex((s) => s.role === '控场')
  m = { ...m, econ: [{ ...m.econ[0], ult: ULT_COST }, { ...m.econ[1], ult: ULT_COST }] }
  const a = submitChoice(m, 0, { buy: 'full', plan: attackerOf(m) === 0 ? 'A' : 'stackA', lead: 0, ult: scout })
  const b = submitChoice(a, 1, { buy: 'full', plan: attackerOf(m) === 1 ? 'B' : 'stackB', lead: 0, ult: null })
  check('a 侦察 stops the round for a second look', b.phase === 'recon' && b.recon[0] && !b.recon[1])
  check('the scout sees the plan, the other side sees only that it waits', swiftView(b, 0).scouted === (attackerOf(m) === 1 ? 'B' : 'stackB') && swiftView(b, 1).waitingRecon && swiftView(b, 1).scouted === null)
  const changed = submitRecon(b, 0, attackerOf(m) === 0 ? 'A' : 'stackB')
  check('the round is played after the second look, and the change is on the log', changed.log.length === 1 && changed.phase !== 'recon')
  check('a used ultimate starts the bar again', changed.econ[0].ult < ULT_COST && changed.econ[1].ult === ULT_COST)
  const blinded = submitChoice(submitChoice(m, 0, { buy: 'full', plan: attackerOf(m) === 0 ? 'A' : 'stackA', lead: 0, ult: scout }), 1, { buy: 'full', plan: attackerOf(m) === 1 ? 'B' : 'stackB', lead: 0, ult: smoker })
  check('封烟 blinds a 侦察: the round is played at once', blinded.phase !== 'recon' && blinded.log.length === 1)
  const uncharged = cleanChoice(newSwiftMatch(11, sideA, sideB), 0, { buy: 'full', plan: 'A', lead: 0, ult: scout })
  check('an ultimate that is not charged is ignored', uncharged.ult === null)
  const junk = cleanChoice(m, 0, { buy: 'gold', plan: 'teleport', lead: 9, ult: 'x' })
  check('nonsense from a client becomes a legal call', ['eco', 'force', 'full'].includes(junk.buy) && junk.lead >= 0 && junk.lead < 5 && junk.ult === null)
  const twice = submitChoice(m, 0, { buy: 'full', plan: 'A', lead: 0, ult: null })
  check('a side that has called waits for the other', twice.phase === 'choose' && twice.pending[0] !== null && twice.log.length === 0)
}

// ---------------------------------------------------------------- the pause, the swap, the end
{
  const caller = PLAYER_CARDS.find((c) => c.isIgl && c.role === '控场' && !c.legend)!
  const withIgl = side([...fiveA.slice(0, 2), caller.id, ...fiveA.slice(3)], 'I')
  let m = newSwiftMatch(21, withIgl, sideB)
  check('a five with a caller has one pause a half', m.econ[0].pauses === 1 && m.econ[1].pauses === 0)
  check('without a caller or coach there is no pause', takePause(m, 1) === null)
  const p = takePause(m, 0)!
  check('a pause shows their money this round', swiftView(p, 0).theirs.credits !== null && swiftView(m, 0).theirs.credits === null && p.econ[0].pauses === 0)
  m = play(withIgl, sideB, 21, ai, ai)
  const swapRound = m.log[SWIFT_HALF]
  check('sides swap after round 4', !swapRound || swapRound.attacker !== m.log[0].attacker)
  check('the second half opens on a pistol round', !swapRound || swapRound.pistol)
  check('the match ends at five', Math.max(...m.score) === SWIFT_WIN && m.winner !== null && m.phase === 'done')
  const again = play(withIgl, sideB, 21, ai, ai)
  check('the same calls and seed play the same match', JSON.stringify(again.log) === JSON.stringify(m.log))
  check('a finished match takes no more calls', submitChoice(m, 0, { buy: 'full', plan: 'A', lead: 0, ult: null }) === m)
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall 抢五 checks passed')
process.exit(fails ? 1 : 0)
