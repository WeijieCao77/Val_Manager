/**
 * Which 全服杯 format, and which 组队杯 rules, are fairest — measured, not argued.
 *
 *   npx tsx scripts/measure_cup_formats.ts [cups=4000]
 *
 * Everything here runs on two things read off the live cups of 2026-09-19 (four
 * cups, 320–368 entrants, 1,300+ real ties, /api/card/opencup/schedule):
 *
 *   FIELD   the paper scores people actually enter with — median 96, p10 89,
 *           p90 101, best 106, a thin tail down to the 60s;
 *   ODDS    how often the higher score won a BO3 / BO5 at each gap.
 *
 * A tie is a coin weighted by ODDS, so a thousand cups cost a second and the
 * answer does not depend on the match engine's noise. What is compared:
 *
 *   solo   today's Swiss → knockout, against random groups of 64 / 32 with a
 *          double-elimination last eight, and against groups seeded by score
 *   team   threes or fives; thrown together at random or dealt out by score
 *          (snake); duels paired at random or strongest-against-strongest
 */
import { Rng } from '../src/engine/rng'

const CUPS = Number(process.argv[2] ?? 4000)
const rng = new Rng(20260919)
const rnd = () => rng.next()

// score → how many of 1,385 real entrants had it, in bands of four (2026-09-19)
const FIELD_BANDS: [number, number][] = [[64, 3], [68, 5], [72, 7], [76, 4], [80, 16], [84, 40], [88, 203], [92, 356], [96, 471], [100, 226], [104, 54]]
const FIELD_TOTAL = FIELD_BANDS.reduce((n, [, c]) => n + c, 0)
function drawScore(): number {
  let k = rnd() * FIELD_TOTAL
  for (const [lo, c] of FIELD_BANDS) { if (k < c) return Math.min(106, lo + Math.floor(rnd() * 4)); k -= c }
  return 96
}
// P(the higher score wins) by gap, smoothed from the real ties (index = gap, last = 12+)
const ODDS3 = [0.5, 0.51, 0.54, 0.59, 0.66, 0.69, 0.73, 0.76, 0.79, 0.83, 0.89, 0.92, 0.95]
const ODDS5 = [0.5, 0.52, 0.55, 0.6, 0.65, 0.7, 0.77, 0.82, 0.85, 0.88, 0.91, 0.95, 0.98]
function aWins(a: number, b: number, bo: 3 | 5): boolean {
  const t = bo === 3 ? ODDS3 : ODDS5
  const p = t[Math.min(12, Math.abs(a - b))]
  return rnd() < (a >= b ? p : 1 - p)
}
const shuffle = <T,>(xs: T[]): T[] => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]] } return xs }

// ---------------------------------------------------------------- what is handed out
type Prize = { ten: number; elite: number; scout: number; coins: number }
const none = (): Prize => ({ ten: 0, elite: 0, scout: 0, coins: 0 })
/** one number for a purse, in draws: 十连 = 10, 选拔 = 5, 试训 = 3 (the packs' own card counts), 1 draw ≈ 100 coins */
const PULLS = (p: Prize) => p.ten * 10 + p.elite * 5 + p.scout * 3 + p.coins / 100

interface Player { score: number; prize: Prize; placed: boolean; played: number }
const BUCKETS = ['后 25%', '25–50%', '50–75%', '75–90%', '前 10%'] as const
function bucketOf(rank: number, n: number): number { const q = rank / n; return q < 0.25 ? 0 : q < 0.5 ? 1 : q < 0.75 ? 2 : q < 0.9 ? 3 : 4 }

/** single elimination among `ids` until `stop` are left; returns [survivors, eliminated by round] */
function knockout(ids: number[], P: Player[], stop: number, bo: 3 | 5, winCoins: number): { left: number[]; out: number[][] } {
  let alive = shuffle(ids.slice())
  const out: number[][] = []
  while (alive.length > stop) {
    // all byes in the first round: play down to the power of two below
    let p2 = 1; while (p2 * 2 <= alive.length) p2 *= 2
    const ties = alive.length === p2 ? alive.length / 2 : alive.length - p2
    const next: number[] = alive.slice(ties * 2), gone: number[] = []
    for (let i = 0; i < ties; i++) {
      const a = alive[2 * i], b = alive[2 * i + 1]
      P[a].played++; P[b].played++
      const w = aWins(P[a].score, P[b].score, bo) ? a : b
      P[w].prize.coins += winCoins
      next.push(w); gone.push(w === a ? b : a)
    }
    out.push(gone); alive = shuffle(next)
  }
  return { left: alive, out }
}
/** double elimination among eight: returns places [1st, 2nd, 3rd, 4th, 5-6, 5-6, 7-8, 7-8] */
function doubleEight(ids: number[], P: Player[], winCoins: number): number[] {
  const play = (a: number, b: number, bo: 3 | 5 = 3) => { P[a].played++; P[b].played++; const w = aWins(P[a].score, P[b].score, bo) ? a : b; P[w].prize.coins += winCoins; return [w, w === a ? b : a] }
  const s = shuffle(ids.slice())
  const q = [play(s[0], s[1]), play(s[2], s[3]), play(s[4], s[5]), play(s[6], s[7])]
  const l1 = [play(q[0][1], q[1][1]), play(q[2][1], q[3][1])]            // 7–8 out
  const u2 = [play(q[0][0], q[1][0]), play(q[2][0], q[3][0])]
  const l2 = [play(l1[0][0], u2[1][1]), play(l1[1][0], u2[0][1])]        // 5–6 out
  const l3 = play(l2[0][0], l2[1][0])                                    // 4th out
  const uf = play(u2[0][0], u2[1][0])
  const lf = play(l3[0], uf[1])                                          // 3rd out
  const gf = play(uf[0], lf[0], 5)
  return [gf[0], gf[1], lf[1], l3[1], l2[0][1], l2[1][1], l1[0][1], l1[1][1]]
}

// ---------------------------------------------------------------- solo formats
type Solo = (P: Player[]) => { rounds: number }
const give = (p: Player, add: Partial<Prize>) => { for (const k of Object.keys(add) as (keyof Prize)[]) p.prize[k] += add[k]!; p.placed = true }

/** today: Swiss to two wins / two losses (BO3, 20 a win), then a BO5 knockout (40 a win); places 1, 2, 3–4 paid */
const today: Solo = (P) => {
  const st = P.map(() => ({ w: 0, l: 0 }))
  let rounds = 0
  for (let r = 0; r < 3; r++) {
    rounds++
    for (const rec of [0, 1, 2].flatMap((w) => [0, 1].map((l) => [w, l]))) {
      const pool = shuffle(P.map((_, i) => i).filter((i) => st[i].w === rec[0] && st[i].l === rec[1] && st[i].w < 2 && st[i].l < 2))
      for (let i = 0; i + 1 < pool.length; i += 2) {
        const a = pool[i], b = pool[i + 1]; P[a].played++; P[b].played++
        const w = aWins(P[a].score, P[b].score, 3) ? a : b
        st[w].w++; st[w === a ? b : a].l++; P[w].prize.coins += 20
      }
      if (pool.length % 2) st[pool[pool.length - 1]].w++
    }
  }
  const through = P.map((_, i) => i).filter((i) => st[i].w >= 2)
  const { left, out } = knockout(through, P, 1, 5, 40)
  rounds += out.length
  const n = P.length
  const big = n >= 32
  give(P[left[0]], big ? { ten: 1, coins: 1000 } : { coins: 600, elite: 1 })
  if (out.length >= 1) for (const i of out[out.length - 1]) give(P[i], big ? { elite: 1, coins: 400 } : { coins: 300, scout: 1 })
  if (out.length >= 2) for (const i of out[out.length - 2]) give(P[i], big ? { scout: 1, coins: 150 } : { coins: 100 })
  return { rounds }
}

/**
 * Groups of `size`: knocked down to eight (BO3), then the eight play double elimination.
 * The player's table: champion as now, runner-up two 选拔, third and fourth one 选拔, fifth to eighth one 试训.
 */
const groups = (size: number, seeded: boolean, doubleElim = true): Solo => (P) => {
  const n = P.length
  const g = Math.max(1, Math.round(n / size))
  const order = seeded ? P.map((_, i) => i).sort((a, b) => P[b].score - P[a].score) : shuffle(P.map((_, i) => i))
  // seeded = tiers: the top `size` by score are group one, the next are group two, …
  const per = Math.ceil(n / g)
  let rounds = 0
  for (let k = 0; k < g; k++) {
    const ids = order.slice(k * per, (k + 1) * per)
    if (ids.length < 2) { if (ids.length) give(P[ids[0]], { scout: 1 }); continue }
    const { left, out } = knockout(ids, P, Math.min(8, ids.length), 3, 20)
    let r = out.length
    if (left.length === 8 && doubleElim) {
      const place = doubleEight(left, P, 40)
      r += 6
      give(P[place[0]], { ten: 1, coins: 1000 }); give(P[place[1]], { elite: 2 })
      give(P[place[2]], { elite: 1 }); give(P[place[3]], { elite: 1 })
      for (const i of place.slice(4)) give(P[i], { scout: 1 })
    } else {
      const ko = knockout(left, P, 1, 3, 40)
      r += ko.out.length
      give(P[ko.left[0]], { ten: 1, coins: 1000 })
      const rev = ko.out.slice().reverse()
      for (const i of rev[0] ?? []) give(P[i], { elite: 2 })
      for (const i of rev[1] ?? []) give(P[i], { elite: 1 })
      for (const i of rev[2] ?? []) give(P[i], { scout: 1 })
    }
    rounds = Math.max(rounds, r)
  }
  return { rounds }
}

/** F: random groups, and inside each the Swiss stage people already have (two wins through, two losses out), then down to eight, then double elimination */
const groupsSwiss = (size: number): Solo => (P) => {
  const n = P.length, g = Math.max(1, Math.round(n / size)), per = Math.ceil(n / g)
  const order = shuffle(P.map((_, i) => i))
  let rounds = 0
  for (let k = 0; k < g; k++) {
    const ids = order.slice(k * per, (k + 1) * per)
    const st = new Map(ids.map((i) => [i, { w: 0, l: 0 }]))
    for (let r = 0; r < 3; r++) {
      for (const rec of [0, 1, 2].flatMap((w) => [0, 1].map((l) => [w, l]))) {
        const pool = shuffle(ids.filter((i) => st.get(i)!.w === rec[0] && st.get(i)!.l === rec[1] && st.get(i)!.w < 2 && st.get(i)!.l < 2))
        for (let i = 0; i + 1 < pool.length; i += 2) {
          const a = pool[i], b = pool[i + 1]; P[a].played++; P[b].played++
          const w = aWins(P[a].score, P[b].score, 3) ? a : b
          st.get(w)!.w++; st.get(w === a ? b : a)!.l++; P[w].prize.coins += 20
        }
        if (pool.length % 2) st.get(pool[pool.length - 1])!.w++
      }
    }
    const through = ids.filter((i) => st.get(i)!.w >= 2)
    const { left, out } = knockout(through, P, Math.min(8, through.length), 3, 20)
    let r = 3 + out.length
    if (left.length === 8) {
      const place = doubleEight(left, P, 40); r += 6
      give(P[place[0]], { ten: 1, coins: 1000 }); give(P[place[1]], { elite: 2 })
      give(P[place[2]], { elite: 1 }); give(P[place[3]], { elite: 1 })
      for (const i of place.slice(4)) give(P[i], { scout: 1 })
    }
    rounds = Math.max(rounds, r)
  }
  return { rounds }
}

function runSolo(name: string, format: Solo, n = 340) {
  const placed = BUCKETS.map(() => 0), pulls = BUCKETS.map(() => 0), seen = BUCKETS.map(() => 0), games = BUCKETS.map(() => 0)
  let minted = none(), rounds = 0, champTop10 = 0
  for (let c = 0; c < CUPS; c++) {
    const P: Player[] = Array.from({ length: n }, () => ({ score: drawScore(), prize: none(), placed: false, played: 0 }))
    const r = format(P); rounds = Math.max(rounds, r.rounds)
    const order = P.map((_, i) => i).sort((a, b) => P[a].score - P[b].score)
    order.forEach((i, rank) => {
      const b = bucketOf(rank, n); seen[b]++; games[b] += P[i].played
      if (P[i].placed) placed[b]++
      pulls[b] += PULLS(P[i].prize)
      for (const k of Object.keys(minted) as (keyof Prize)[]) minted[k] += P[i].prize[k]
      if (P[i].prize.ten && rank >= n * 0.9) champTop10++
    })
  }
  const tens = minted.ten / CUPS
  console.log(`\n${name}  （${n} 人，最多 ${rounds} 轮）`)
  console.log(`  每届发出：十连 ${tens.toFixed(1)} · 选拔 ${(minted.elite / CUPS).toFixed(1)} · 试训 ${(minted.scout / CUPS).toFixed(1)} · 金币 ${Math.round(minted.coins / CUPS)} ＝ ${(PULLS(minted) / CUPS).toFixed(0)} 抽/届，人均 ${(PULLS(minted) / CUPS / n).toFixed(2)} 抽`)
  console.log(`  冠军来自前 10% 的比例 ${(champTop10 / Math.max(1, minted.ten) * 100).toFixed(0)}%`)
  console.log('  阵容分位      ' + BUCKETS.map((b) => b.padStart(8)).join(''))
  console.log('  拿到名次奖    ' + placed.map((x, i) => `${(x / seen[i] * 100).toFixed(1)}%`.padStart(9)).join(''))
  console.log('  每届期望(抽)  ' + pulls.map((x, i) => (x / seen[i]).toFixed(2).padStart(9)).join(''))
  console.log('  平均打几场    ' + games.map((x, i) => (x / seen[i]).toFixed(1).padStart(9)).join(''))
}

// ---------------------------------------------------------------- team cup
interface TeamRules { size: 3 | 5; deal: 'random' | 'snake' | 'dealt'; pair: 'random' | 'ranked'; label: string }
function runTeams(rule: TeamRules, n = 340) {
  const size = rule.size
  const placed = BUCKETS.map(() => 0), seen = BUCKETS.map(() => 0), pulls = BUCKETS.map(() => 0)
  let close = 0, duels = 0, decided = 0, ties = 0, rounds = 0
  const titleByStrength = [0, 0, 0, 0]   // champion team's pre-cup strength quartile among teams
  let spread = 0
  for (let c = 0; c < CUPS; c++) {
    const P: Player[] = Array.from({ length: n }, () => ({ score: drawScore(), prize: none(), placed: false, played: 0 }))
    const T = Math.floor(n / size)
    const teams: number[][] = Array.from({ length: T }, () => [])
    const ids = rule.deal === 'random' ? shuffle(P.map((_, i) => i)) : P.map((_, i) => i).sort((a, b) => P[b].score - P[a].score)
    if (rule.deal === 'random') ids.forEach((id, k) => teams[k % T].push(id))
    else if (rule.deal === 'snake') ids.forEach((id, k) => { const lap = Math.floor(k / T), pos = k % T; teams[lap % 2 === 0 ? pos : T - 1 - pos].push(id) })
    else {
      // dealt: tier by tier (the top T by score, the next T, …), each tier's strongest to the team that is
      // weakest so far — every team gets exactly one from every tier, and the totals come out level
      const sum = teams.map(() => 0)
      for (let lap = 0; lap * T < ids.length; lap++) {
        const tier = ids.slice(lap * T, (lap + 1) * T)
        const order = teams.map((_, t) => t).sort((x, y) => sum[x] - sum[y] || rnd() - 0.5)
        tier.forEach((id, k) => { teams[order[k]].push(id); sum[order[k]] += P[id].score })
      }
    }
    const strength = teams.map((t) => t.reduce((s, i) => s + P[i].score, 0) / t.length)
    const sorted = strength.slice().sort((a, b) => a - b)
    spread += sorted[Math.floor(T * 0.9)] - sorted[Math.floor(T * 0.1)]
    const quart = (t: number) => Math.min(3, Math.floor(sorted.indexOf(strength[t]) / T * 4))

    let alive = shuffle(teams.map((_, i) => i))
    const outBy: number[][] = []
    while (alive.length > 1) {
      let p2 = 1; while (p2 * 2 <= alive.length) p2 *= 2
      const k = alive.length === p2 ? alive.length / 2 : alive.length - p2
      const next = alive.slice(k * 2), gone: number[] = []
      for (let m = 0; m < k; m++) {
        const A = teams[alive[2 * m]], B = teams[alive[2 * m + 1]]
        // `size` duels; a team with an extra member rotates who sits out
        const pick = (t: number[]) => { const s = shuffle(t.slice()).slice(0, size); return rule.pair === 'ranked' ? s.sort((x, y) => P[y].score - P[x].score) : s }
        const a = pick(A), b = rule.pair === 'ranked' ? pick(B) : shuffle(pick(B))
        let wa = 0
        const bo: 3 | 5 = alive.length <= 2 ? 5 : 3
        for (let d = 0; d < size; d++) {
          const pa = P[a[d]].score, pb = P[b[d]].score
          duels++; if (Math.abs(pa - pb) <= 4) close++
          if (aWins(pa, pb, bo)) wa++
        }
        ties++; if (Math.abs(wa - (size - wa)) === 1) decided++
        const w = wa * 2 > size ? alive[2 * m] : alive[2 * m + 1]
        next.push(w); gone.push(w === alive[2 * m] ? alive[2 * m + 1] : alive[2 * m])
      }
      outBy.push(gone); alive = shuffle(next)
    }
    rounds = Math.max(rounds, outBy.length)
    titleByStrength[quart(alive[0])]++
    const rev = outBy.slice().reverse()
    const pay = (team: number, add: Partial<Prize>) => { for (const i of teams[team]) give(P[i], add) }
    pay(alive[0], { ten: 1, coins: 500 })
    for (const t of rev[0] ?? []) pay(t, { elite: 2 })
    for (const t of rev[1] ?? []) pay(t, { elite: 1 })
    for (const t of rev[2] ?? []) pay(t, { scout: 1 })
    const order = P.map((_, i) => i).sort((x, y) => P[x].score - P[y].score)
    order.forEach((i, rank) => { const bk = bucketOf(rank, n); seen[bk]++; if (P[i].placed) placed[bk]++; pulls[bk] += PULLS(P[i].prize) })
  }
  console.log(`\n${rule.label}  （${n} 人 → ${Math.floor(n / size)} 队，${rounds} 轮）`)
  console.log(`  队伍强弱差（第 90 百分位队 − 第 10 百分位队，均分）：${(spread / CUPS).toFixed(1)} 分`)
  console.log(`  冠军队来自最强 1/4 的队：${(titleByStrength[3] / CUPS * 100).toFixed(0)}%　最弱 1/4：${(titleByStrength[0] / CUPS * 100).toFixed(0)}%　（完全均衡时各 25%）`)
  console.log(`  单挑分差 ≤4 分（有悬念）的比例 ${(close / duels * 100).toFixed(0)}%　一分定胜负的队伍对决 ${(decided / ties * 100).toFixed(0)}%`)
  console.log('  阵容分位      ' + BUCKETS.map((b) => b.padStart(8)).join(''))
  console.log('  拿到名次奖    ' + placed.map((x, i) => `${(x / seen[i] * 100).toFixed(1)}%`.padStart(9)).join(''))
  console.log('  每届期望(抽)  ' + pulls.map((x, i) => (x / seen[i]).toFixed(2).padStart(9)).join(''))
}

console.log(`==== 个人全服杯：${CUPS} 届模拟 ====`)
runSolo('A. 现行：瑞士轮 → BO5 淘汰，只奖冠亚四强', today)
runSolo('B. 随机分 64 人一组：淘汰到八强 → 八强双败（玩家建议的奖励表）', groups(64, false))
runSolo('C. 随机分 32 人一组：同上', groups(32, false))
runSolo('D. 按阵容分从高到低分 64 人一组（同档对同档）：同上', groups(64, true))
runSolo('E. 随机 64 人一组，八强仍单败（看双败改变了什么）', groups(64, false, false))

runSolo('F. 随机 64 人一组，组内先打瑞士轮（两胜晋级、两败淘汰）→ 淘汰到八强 → 八强双败', groupsSwiss(64))
console.log(`\n==== 组队杯：${CUPS} 届模拟 ====`)
for (const size of [3, 5] as const) {
  runTeams({ size, deal: 'random', pair: 'random', label: `${size} 人队 · 随机组队 · 随机单挑（玩家原案）` })
  runTeams({ size, deal: 'random', pair: 'ranked', label: `${size} 人队 · 随机组队 · 强对强、弱对弱` })
  runTeams({ size, deal: 'snake', pair: 'ranked', label: `${size} 人队 · 蛇形组队 · 强对强、弱对弱` })
  runTeams({ size, deal: 'dealt', pair: 'random', label: `${size} 人队 · 按档发牌组队（每队每档一人，弱队先挑强的）· 随机单挑` })
  runTeams({ size, deal: 'dealt', pair: 'ranked', label: `${size} 人队 · 按档发牌组队 · 强对强、弱对弱` })
}
