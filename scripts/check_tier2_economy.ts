/**
 * Does a Challengers club's money make sense? (2026-09-05, from the group)
 *
 *   npx tsx scripts/check_tier2_economy.ts [seasons]
 *
 * The group's second point was about the second division: streaming,
 * business, transfer prices and income all read as VCT numbers to them. This
 * plays a Challengers club as a bystander — no manager actions at all, so
 * the lines are the engine's own — and prints what it earns and spends,
 * what the AI clubs of both tiers do with their budgets, what a player costs
 * against those budgets, and what a stream or a sponsor is worth in each
 * league. It also watches the two things that changed today: club
 * reputation now moves, and AI clubs now spend on treatment and buildings.
 */
import { createNewGame } from '../src/engine/world'
import { squadOf, wageBill } from '../src/engine/roster'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason, compKey } from '../src/engine/season'
import { weeklyUpkeep } from '../src/engine/finance'
import { sponsorWorth, streamOffer } from '../src/engine/commercial'
import { askingPrice } from '../src/engine/transfer'
import { expectedSalary, marketValue } from '../src/engine/player'
import { weeklyStipend } from '../src/engine/leagueShare'
import type { GameState, Player, Team } from '../src/engine/types'

const seasons = Number(process.argv[2] ?? 3)
const money = (n: number) => `$${Math.round(n / 1000)}K`
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }

const me = WORLD_TEAMS.find((t) => t.tag === 'KBG')!
const g: GameState = createNewGame(me.id, '旁观', 20260905)
setupSeason(g)
const mine = g.teams[g.myTeam]
console.log(`旁观 ${mine.name}（${mine.league}，评分 ${mine.rating}，声望 ${mine.reputation}，设施 ${mine.facilities}，起始资金 ${money(g.finances.balance)}）`)
console.log(`薪资 ${money(wageBill(g, g.myTeam))}/年 · 运营 ${money(weeklyUpkeep(g, g.myTeam) * 48)}/年 · 津贴 ${money(weeklyStipend(2) * 48)}/年 · 赞助 ${money(mine.sponsors.reduce((s, x) => s + x.perSeason, 0))}/年（${mine.sponsors.length} 家）\n`)

const aiOf = (tier: 1 | 2) => Object.values(g.teams).filter((t) => t.id !== g.myTeam && t.tier === tier)
const line = (tier: 1 | 2) => {
  const xs = aiOf(tier)
  return `T${tier} AI ${xs.length} 家：资金中位 ${money(median(xs.map((t) => t.budget)))}，赤字 ${xs.filter((t) => t.budget < 0).length} 家，设施中位 ${median(xs.map((t) => t.facilities))}，声望中位 ${Math.round(median(xs.map((t) => t.reputation)))}`
}
console.log(`开局  ${line(1)}`)
console.log(`      ${line(2)}`)

// the clubs to watch: whoever goes up and down in the first winter
let promoted: Team | undefined
let relegated: Team | undefined
const repTrail: Record<string, number[]> = {}
const facStart = Object.fromEntries(Object.values(g.teams).map((t) => [t.id, t.facilities]))
const physioSpend: Record<string, number> = {}

for (let s = 0; s < seasons; s++) {
  const y = g.year
  // the ledger keeps its last 200 lines, so a season is summed as it is
  // written rather than read back at the end
  const seen = new Set<object>()
  const totals: Record<string, number> = {}
  const sumBy = (label: string) => Object.entries(totals).filter(([k]) => k.startsWith(label)).reduce((a, [, v]) => a + v, 0)
  const startBal = g.finances.balance
  const budget0 = Object.fromEntries(Object.values(g.teams).map((t) => [t.id, t.budget]))
  let guard = 0
  while (g.year === y && guard++ < 400) {
    g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0
    if (g.midReview) continuePastFive(g)
    // physio is the only weekly spend that is not payroll, sponsorship,
    // upkeep, prize or a transfer; measure it from the ledger's gaps
    advanceDay(g, { autoResolveDrawDecisions: true })
    for (const e of g.finances.log) {
      if (seen.has(e)) continue
      seen.add(e)
      totals[e.label] = (totals[e.label] ?? 0) + e.amount
    }
  }
  const wages = -sumBy('选手薪资'), upkeep = -sumBy('运营开支'), sponsor = sumBy('赞助收入'), stipend = sumBy('联盟津贴'), prize = sumBy('奖金')
  console.log(`\n${y} 赛季  我方：赞助 ${money(sponsor)} + 津贴 ${money(stipend)} + 奖金 ${money(prize)} − 薪资 ${money(wages)} − 运营 ${money(upkeep)} → 资金 ${money(startBal)} → ${money(g.finances.balance)}（声望 ${Math.round(mine.reputation)}，${mine.league}）`)
  console.log(`      ${line(1)}`)
  console.log(`      ${line(2)}`)
  // who moved leagues this winter
  const chal = g.comps[compKey('challengers2', mine.region)]
  void chal
  for (const t of Object.values(g.teams)) {
    (repTrail[t.id] ??= []).push(Math.round(t.reputation))
    const spent = budget0[t.id] - t.budget
    void spent
  }
  if (!promoted) promoted = Object.values(g.teams).find((t) => t.tier === 1 && WORLD_TEAMS.find((r) => r.id === t.id)?.tier === 2)
  if (!relegated) relegated = Object.values(g.teams).find((t) => t.tier === 2 && WORLD_TEAMS.find((r) => r.id === t.id)?.tier === 1)
}

console.log('\n升降级的声望轨迹（开局 → 每个冬天之后）：')
for (const t of [promoted, relegated]) {
  if (!t) continue
  const raw = WORLD_TEAMS.find((r) => r.id === t.id)!
  console.log(`  ${t.tag.padEnd(5)} ${raw.tier === 2 ? '升入 VCT' : '降入次级'}：${raw.reputation} → ${repTrail[t.id].join(' → ')}（评分 ${t.rating}）`)
}
const moved = Object.values(g.teams).map((t) => t.facilities - facStart[t.id])
console.log(`\nAI 设施：${seasons} 个冬天里升级过的俱乐部 ${moved.filter((d) => d > 0).length}/${moved.length}，最多 +${Math.max(...moved)}，T1 中位 +${median(aiOf(1).map((t) => t.facilities - facStart[t.id]))}，T2 中位 +${median(aiOf(2).map((t) => t.facilities - facStart[t.id]))}`)
const physioed = Object.keys(g.physioOn ?? {}).length
console.log(`AI 理疗：本赛季有过理疗记录的选手 ${physioed} 人（含我方 0）`)
void physioSpend

// ---- the price ladder against the budgets
console.log('\n买人价格（23 岁、潜力 +3、状态 70）对比资金：')
const t2Budget = median(aiOf(2).map((t) => t.budget))
const t1Budget = median(aiOf(1).map((t) => t.budget))
for (const ovr of [65, 70, 75, 80, 85, 90]) {
  const p = { ...squadOf(g, g.myTeam)[0], overall: ovr, potential: ovr + 3, age: 23, form: 70, contractYears: 2, listed: false, teamId: 'x', ambition: 60 } as Player
  console.log(`  ${ovr}：身价 ${money(marketValue(p))}，要价 ${money(askingPrice(p))}，年薪 T1 ${money(expectedSalary(p, 1))} / T2 ${money(expectedSalary(p, 2))}` +
    ` —— 占 T2 资金中位 ${(askingPrice(p) / t2Budget * 100).toFixed(0)}%，T1 ${(askingPrice(p) / t1Budget * 100).toFixed(0)}%`)
}

// ---- what a stream and a sponsor are worth in each league
console.log('\n直播与赞助按联赛：')
for (const tier of [2, 1] as const) {
  const club = tier === 2 ? mine : aiOf(1)[0]
  const rep = Math.round(club.reputation)
  const fake: Team = { ...club, tier, reputation: club.reputation }
  console.log(`  T${tier}（声望 ${rep}）：一份赞助 ${money(sponsorWorth(fake))}/年；津贴 ${money(weeklyStipend(tier) * 48)}/年`)
}
for (const ovr of [65, 72, 80]) {
  const p = squadOf(g, g.myTeam)[0]
  const saved = { overall: p.overall, stream: p.stream }
  p.overall = ovr; p.stream = undefined
  const o = streamOffer(g, p.id)
  console.log(`  我方 ${ovr} 分选手的直播合同：${o ? `${money(o.fee)} / ${o.months} 个月（折合 ${money(o.fee * 12 / o.months)}/年）` : '无人问津'}`)
  p.overall = saved.overall; p.stream = saved.stream
}
