/**
 * 转会新闻 and the AI market behind it (2026-10-08, engine/transferNews.ts, transfer.ts).
 *
 *   npx tsx scripts/check_transfer_news.ts
 *
 * Three headless seasons, with every new ledger line checked against the game ON THE DAY it is
 * written (by identity: the ledger is trimmed, so an index stops meaning anything once it is
 * full — the first version of this check went blind for its whole third season that way):
 *   - every move it reports really happened (the player's own CV has the club)
 *   - 「传闻成真」 deals had the rumour first, and every rumour gets an ending (deal or 告吹);
 *     none can end 「窗口关闭」: nothing is opened that cannot be worked inside its window
 *   - nobody is sold on within eight months unless he was listed or asked out in between
 *   - the strong clubs buy real players from other clubs; nobody pays far above his own level
 *   - a player who asks out is listed by his AI club, and stays listed while the request stands
 * Then the doors the review found open: a change of job onto a club with an approach running,
 * a target signed by a third club first, a renewal answering a transfer request.
 */
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, moveToClub, setupSeason } from '../src/engine/season'
import { careerDayOf } from '../src/engine/clock'
import { assertCareerSave } from '../src/engine/saveShape'
import { FEED_MAX } from '../src/engine/transferNews'
import { aiTransferTick, asksOut, renewContract } from '../src/engine/transfer'
import { defaultContract } from '../src/engine/types'
import { Rng } from '../src/engine/rng'
import type { TxNews } from '../src/engine/transferNews'
import type { GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const at = (e: { y: number; d: number }) => careerDayOf({ year: e.y, day: e.d })
const renewOwn = (state: GameState) => {
  // the manager renews his own: headless, nobody would, and a squad of four stops the calendar
  for (const id of state.teams[state.myTeam].roster) {
    const p = state.players[id]
    if (p && p.contractYears <= 1) { p.contractYears = 3; p.expiredYear = undefined }
  }
}

const me = WORLD_TEAMS.find((t) => t.tag === 'EDG')!
const state: GameState = createNewGame(me.id, '测试经理', 20261008)
setupSeason(state)
const strong = new Set(Object.values(state.teams).filter((t) => t.id !== state.myTeam).sort((a, b) => b.rating - a.rating).slice(0, 10).map((t) => t.id))

// everything ever written, in order, kept here whatever the ledger trims
const all: TxNews[] = []
const seen = new WeakSet<TxNews>()
const unbacked: string[] = []
const overCeiling: string[] = []
const noRumour: string[] = []
const notListed: string[] = []
const dropped: string[] = []
const unstamped: string[] = []
const carried: string[] = []
// whether each player was on the list at any point since his last paid move
const listedSince = new Map<string, boolean>()
let realSeen = 0
for (let s = 0; s < 3; s++) {
  const y = state.year
  while (state.year === y) {
    renewOwn(state)
    const before = state.day
    advanceDay(state, { autoResolveDrawDecisions: true })
    if (state.day === before && state.year === y) throw new Error(`calendar stuck on ${state.year}/${state.day}`)
    for (const p of Object.values(state.players)) {
      if (p.listed || asksOut(state, p)) listedSince.set(p.id, true)
      // a standing request keeps him on his AI club's list every day of it, New Year included
      if (p.teamId && p.teamId !== state.myTeam && asksOut(state, p) && !p.listed && dropped.length < 20) dropped.push(`${p.ign} ${state.year}/${state.day}`)
    }
    for (const e of state.transferFeed ?? []) {
      if (seen.has(e)) continue
      seen.add(e)
      all.push(e)
      const p = state.players[e.p]
      if ((e.k === 'done' || e.k === 'free') && e.t && p && !(p.clubHist ?? []).some((h) => h.team === e.t)) unbacked.push(`${e.n}->${e.t}`)
      if (e.k === 'done' && e.w?.includes('传闻成真')) {
        realSeen++
        const r = all.find((x) => x.k === 'rumor' && x.c === 3 && x.p === e.p && x.t === e.t && at(e) - at(x) >= 0 && at(e) - at(x) <= 30)
        if (!r) noRumour.push(e.n)
        const rating = state.teams[e.t!]?.rating
        if (rating == null) overCeiling.push(`${e.n}: no club`)
        // the rating after the move, which is higher than the one it was bought on: +3 slack
        else if ((e.o ?? 0) > rating + 8 + 3) overCeiling.push(`${e.n}(${e.o})→${state.teams[e.t!]?.tag}(${rating})`)
      }
      if (e.k === 'wants' && e.f !== state.myTeam && p && !p.listed) notListed.push(`${e.n} 提出离队时没挂牌`)
      // every road into a club stamps the day and leaves the old club's listing and request behind
      if ((e.k === 'done' || e.k === 'free') && p && p.teamId === e.t) {
        if (p.movedOn !== careerDayOf(state) && !(e.y === state.year - 1 && p.movedOn === careerDayOf({ year: e.y, day: e.d }))) unstamped.push(`${e.n}（${e.w ?? e.k}）`)
        if (p.wantsOut && p.wantsOut.f !== p.teamId && asksOut(state, p)) carried.push(`${e.n}（${e.w ?? e.k}）`)
      }
      if (e.k === 'done' && (e.fee ?? 0) > 0) (e as TxNews & { listedBefore?: boolean }).listedBefore = listedSince.get(e.p) ?? false
      if (e.k === 'done' || e.k === 'free') listedSince.set(e.p, false)
    }
  }
}
const feed = state.transferFeed ?? []
const kinds: Record<string, number> = {}
for (const e of all) kinds[e.k] = (kinds[e.k] ?? 0) + 1
console.log('written', all.length, 'kept', feed.length, JSON.stringify(kinds))

check('有官宣、自由签约、离队、挂牌、传闻、意向、告吹', ['done', 'free', 'release', 'listed', 'rumor', 'wants', 'off'].every((k) => (kinds[k] ?? 0) > 0), JSON.stringify(kinds))
check(`留存不超过上限 ${FEED_MAX}`, feed.length <= FEED_MAX, String(feed.length))
// the list's React key (ui/TransferNews.tsx) must be unique, or rows warn and can be mixed up
const keyOf = (e: TxNews) => `${e.y}:${e.d}:${e.p}:${e.k}:${e.t ?? ''}:${e.c ?? ''}`
const keys = new Map<string, number>()
for (const e of all) keys.set(keyOf(e), (keys.get(keyOf(e)) ?? 0) + 1)
const dupKeys = [...keys].filter(([, n]) => n > 1)
check('转会新闻每一行的 key 不重复', dupKeys.length === 0, dupKeys.slice(0, 3).map(([k, n]) => `${k}×${n}`).join(' '))
check('每条官宣/签约，当天选手履历里就有这支队', unbacked.length === 0, unbacked.slice(0, 3).join(' '))
check('「传闻成真」的交易，之前一个月内都有「谈判中」的传闻（三季逐条查）', realSeen > 30 && noRumour.length === 0, `${realSeen} 笔，缺 ${noRumour.length} ${noRumour.slice(0, 3).join(' ')}`)
check('没有球队买比自己评分高出太多的人', overCeiling.length === 0, overCeiling.slice(0, 3).join(' '))

const paid = all.filter((e) => e.k === 'done' && (e.fee ?? 0) > 0)
const real = paid.filter((e) => e.w?.includes('传闻成真'))
check('AI 之间的付费转会都是先传闻后成交', real.length === paid.filter((e) => e.f !== state.myTeam && e.t !== state.myTeam).length, `${real.length}/${paid.length}`)
check('付费转会三季超过 60 笔（原来两季 16 笔）', paid.length > 60, String(paid.length))
const strongBuys = paid.filter((e) => e.t && strong.has(e.t) && (e.o ?? 0) >= 85)
check('强队从别的队买到 85+ 的球员（三季至少 6 笔）', strongBuys.length >= 6,
  strongBuys.slice(0, 6).map((e) => `${state.teams[e.t!]?.tag}←${e.n}(${e.o})`).join(' '))
check('AI 不会通过传闻直接买走我们的人', !real.some((e) => e.f === state.myTeam))
check('绯闻不会把我们写成买家', !all.some((e) => e.k === 'rumor' && e.c === 1 && e.t === state.myTeam))

// every 谈判中 ends, and never by running out of window
const openNow = new Set((state.pursuits ?? []).map((x) => `${x.p}|${x.tm}`))
const endless = all.filter((r) => r.k === 'rumor' && r.c === 3 && !openNow.has(`${r.p}|${r.t}`)
  && !all.some((x) => (x.k === 'done' || x.k === 'off') && x.p === r.p && x.t === r.t && at(x) >= at(r)))
check('每条「谈判中」都有结局（成交或告吹）', endless.length === 0, `${endless.length} 条没结局 ${endless.slice(0, 3).map((e) => e.n).join(' ')}`)
const shut = all.filter((e) => e.k === 'off' && e.w === '转会窗口关闭')
const talks = all.filter((e) => e.k === 'rumor' && e.c === 3).length
check('没有谈判因为「转会窗口关闭」告吹（最后一周不开新谈判）', shut.length === 0, `${shut.length}/${talks}`)
check('谈成的比例过半', real.length / Math.max(1, talks) > 0.5, `${real.length}/${talks}`)

// no merry-go-round: a paid move within eight months of the last one needs a listing or a request
// in between — read off the game's own state each day, not off listings the ledger chose to write
const churn: string[] = []
// against the previous move of ANY kind — a top-up or cover signing is a move too (review)
const byPlayer = new Map<string, TxNews[]>()
for (const e of all) if (e.k === 'done' || e.k === 'free') byPlayer.set(e.p, [...(byPlayer.get(e.p) ?? []), e])
for (const list of byPlayer.values()) {
  for (let i = 1; i < list.length; i++) {
    const b = list[i] as TxNews & { listedBefore?: boolean }
    if (b.k !== 'done' || !(b.fee ?? 0) || !b.w?.includes('传闻成真')) continue
    if (at(b) - at(list[i - 1]) < 240 && !b.listedBefore) churn.push(`${b.n} ${at(b) - at(list[i - 1])} 天（上一次：${list[i - 1].w ?? list[i - 1].k}）`)
  }
}
check('换队八个月内不会被 AI 再买走（除非挂牌或自己想走），补签、紧急补位也算换队', churn.length === 0, churn.slice(0, 4).join('、'))
check('每条签约（转会、自由签约、补满阵容、紧急补位、真实新人）当天都记下换队时间', unstamped.length === 0, unstamped.slice(0, 4).join('、'))
check('换了队，原俱乐部的离队请求不会跟过来', carried.length === 0, carried.slice(0, 4).join('、'))

// asking out
const wants = all.filter((e) => e.k === 'wants')
check('有球员因为战绩差提出离队', wants.length >= 20, String(wants.length))
check('AI 球队的球员提出离队时都在挂牌', notListed.length === 0, notListed.slice(0, 3).join(' '))
check('申请离队的请求还在，他每天都在挂牌（包括跨年进休赛期窗口）', dropped.length === 0, dropped.slice(0, 3).join(' '))
check('离队意向都写着战绩', wants.every((e) => /\d+胜\d+负/.test(e.w ?? '')))

// the save
const copy = JSON.parse(JSON.stringify(state))
let shapeOk = true
try { assertCareerSave(copy) } catch { shapeOk = false }
check('存档能通过形状检查', shapeOk)
const bytes = JSON.stringify(feed).length
check('转会新闻在存档里不超过 65 KB', bytes < 65_000, `${Math.round(bytes / 1024)} KB`)
const moves = feed.filter((e) => e.k === 'done' || e.k === 'free' || e.k === 'release')
const oldestMove = moves[0]
check('满了以后先丢闲话：留下的成交覆盖两个赛季以上', !!oldestMove && careerDayOf(state) - at(oldestMove) > 364 * 2,
  oldestMove ? `最早一条成交 ${oldestMove.y}/${oldestMove.d}` : '没有成交')

// ---- the doors the review found open
// 1. the manager takes over the club that opened an approach: it must not complete with his money
{
  const g = createNewGame(me.id, '测试经理', 7)
  setupSeason(g)
  while (!(g.pursuits ?? []).length) {
    renewOwn(g)
    advanceDay(g, { autoResolveDrawDecisions: true })
    if (g.year > 2027) throw new Error('no approach ever opened')
  }
  const x = g.pursuits![0]
  const target = g.players[x.p]
  moveToClub(g, x.tm)
  check('换帅时，新球队名下的 AI 谈判一起结束', !(g.pursuits ?? []).some((y) => y.tm === g.myTeam))
  for (let i = 0; i < 8; i++) { renewOwn(g); advanceDay(g, { autoResolveDrawDecisions: true }) }
  check('换帅后不会用经理的钱自动买进那名球员', target.teamId !== g.myTeam && !g.finances.log.some((l) => l.label === `签下 ${target.ign}`),
    `${target.ign} 现在在 ${g.teams[target.teamId ?? '']?.tag ?? '自由'}`)
  check('换帅时结束的谈判也有「告吹」', (g.transferFeed ?? []).some((e) => e.k === 'off' && e.p === x.p && e.t === x.tm && /换帅/.test(e.w ?? '')))
}
// 2. a third club signs the target first: the approach ends 「被…抢先」, not a bid on his new club
{
  const h = createNewGame(me.id, '测试经理', 11)
  setupSeason(h)
  h.day = 7
  for (const t of Object.values(h.teams)) if (t.id !== h.myTeam) t.budget = 30_000_000
  for (let s = 0; s < 20 && !(h.pursuits ?? []).length; s++) aiTransferTick(h, new Rng(100 + s))
  const x = h.pursuits?.[0]
  if (!x) check('（前置）开出了一笔谈判', false)
  else {
    const p = h.players[x.p]
    const third = Object.values(h.teams).find((t) => t.id !== x.tm && t.id !== p.teamId && t.id !== h.myTeam && t.roster.length < 7)!
    h.teams[p.teamId!].roster = h.teams[p.teamId!].roster.filter((id) => id !== p.id)
    p.teamId = third.id
    third.roster.push(p.id)
    h.day = 14
    aiTransferTick(h, new Rng(999))
    const ended = (h.transferFeed ?? []).find((e) => e.k === 'off' && e.p === p.id && e.t === x.tm)
    check('谈判对象被第三支队先签走：告吹「被…抢先签下」，不会转去向新东家买', !!ended && /抢先/.test(ended.w ?? '') && p.teamId === third.id,
      ended?.w ?? '没有告吹')
  }
}
// 3. a renewal answers a transfer request
{
  const k = createNewGame(me.id, '测试经理', 13)
  setupSeason(k)
  const p = k.players[k.teams[k.myTeam].roster[0]]
  p.wantsOut = { y: k.year }
  const r = renewContract(k, p.id, { ...defaultContract(p.salary * 3, 3), promisedRole: 'star' })
  check('续约后离队意向清除', r.ok && p.wantsOut === undefined, r.text)
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
