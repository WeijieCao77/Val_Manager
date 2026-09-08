/**
 * 一键分解: what the button promises is what the account does. (2026-09-08)
 *
 *   npx tsx scripts/check_salvage_bulk.ts
 *
 * A sweep names a pile — these rarities, or these cards — and never a count.
 * How many spares are in the pile is read off the collection the SERVER
 * holds, which is what stops a request from writing its own payout, and what
 * makes the number on the button and the number in the account the same
 * number: both come out of salvagePlan.
 *
 * The rules being checked:
 *   - a rarity sweep takes every spare of that rarity and touches no other
 *   - the card itself never leaves the collection, and its level never moves
 *   - 「留够升级用的」 leaves exactly what the next upgrade wants, and the
 *     upgrade still goes through afterwards
 *   - a彩卡 is never swept up by rarity; named card by card it still goes
 *   - a request that names nothing is refused rather than sweeping everything
 *   - the count, the coins and the rarity in the request are ignored
 */
import { runAction } from '../src/engine/cardActions'
import { newGacha, salvagePlan, upgradeCost, SWEEPABLE } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { ALL_CARDS, DUPES_FOR, SALVAGE } from '../src/engine/cards'
import type { Rarity } from '../src/engine/cards'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const DAY = '2026-09-08'
const env = { now: Date.parse(`${DAY}T12:00:00+08:00`), today: DAY, seed: 7 }
const act = (g: GachaState, args: Record<string, unknown>) => runAction(g, 'salvage_bulk', args, env)
type Got = { coins: number; dupes: number; cards: number }

/** Two cards of each rarity, each holding `dupes` spares, at level 0. */
const some = (rarity: Rarity, n: number) =>
  ALL_CARDS.filter((c) => c.rarity === rarity).slice(0, n)

const fresh = (dupes = 3): GachaState => {
  const g = newGacha('audit-salvage', '审计', DAY)
  g.cards = {}
  g.coins = 0
  for (const r of ['bronze', 'silver', 'gold', 'mythic'] as Rarity[]) {
    for (const c of some(r, 2)) g.cards[c.id] = { id: c.id, level: 0, dupes, seen: dupes + 1, got: DAY }
  }
  return g
}
const dupesOf = (g: GachaState, rarity: Rarity) =>
  Object.values(g.cards)
    .filter((o) => ALL_CARDS.find((c) => c.id === o.id)?.rarity === rarity)
    .reduce((n, o) => n + o.dupes, 0)

// ---- a rarity sweep takes its own pile and nothing else --------------------
{
  const g = fresh()
  const before = { silver: dupesOf(g, 'silver'), gold: dupesOf(g, 'gold') }
  const owned = Object.keys(g.cards).length
  const r = act(g, { rarities: ['bronze'] })
  const got = (r as { result: Got }).result
  check('铜卡一键分解', r.ok && got.dupes === 6 && got.cards === 2, JSON.stringify(got))
  check('付的是分解价', got.coins === SALVAGE.bronze * 6 && g.coins === SALVAGE.bronze * 6, `${g.coins}`)
  check('铜卡重复清空', dupesOf(g, 'bronze') === 0)
  check('别的稀有度一张没动', dupesOf(g, 'silver') === before.silver && dupesOf(g, 'gold') === before.gold)
  check('卡本身还在收藏里', Object.keys(g.cards).length === owned, `${Object.keys(g.cards).length}/${owned}`)
  check('等级没动', Object.values(g.cards).every((o) => o.level === 0))
  check('再扫一次没得扫', !act(g, { rarities: ['bronze'] }).ok)
}

// ---- several piles at once ------------------------------------------------
{
  const g = fresh()
  const r = act(g, { rarities: ['bronze', 'silver', 'gold'] })
  const got = (r as { result: Got }).result
  check('三档一起扫', r.ok && got.dupes === 18 && got.cards === 6, JSON.stringify(got))
  check('金额是三档之和',
    got.coins === (SALVAGE.bronze + SALVAGE.silver + SALVAGE.gold) * 6, `${got.coins}`)
  check('彩卡的重复原封不动', dupesOf(g, 'mythic') === 6)
}

// ---- 彩卡 is not swept up ---------------------------------------------------
{
  const g = fresh()
  check('SWEEPABLE 里没有彩卡', !(SWEEPABLE as readonly string[]).includes('mythic'))
  check('按稀有度扫不到彩卡', !act(g, { rarities: ['mythic'] }).ok)
  check('彩卡还在', dupesOf(g, 'mythic') === 6)
  const one = some('mythic', 1)[0]
  const r = act(g, { cardIds: [one.id] })
  const got = (r as { result: Got }).result
  check('点名了就能分解彩卡', r.ok && got.dupes === 3 && got.coins === SALVAGE.mythic * 3, JSON.stringify(got))
  check('没点名的那张彩卡没事', g.cards[some('mythic', 2)[1].id].dupes === 3)
}

// ---- hand-picked cards -----------------------------------------------------
{
  const g = fresh()
  const [a, b] = some('silver', 2)
  const r = act(g, { cardIds: [a.id] })
  check('只分解选中的那张', r.ok && g.cards[a.id].dupes === 0 && g.cards[b.id].dupes === 3)
  check('别的档没被牵连', dupesOf(g, 'bronze') === 6 && dupesOf(g, 'gold') === 6)
  check('不认识的卡号被忽略，不是崩', !act(g, { cardIds: ['no-such-card'] }).ok)
}

// ---- 留够升级用的 -----------------------------------------------------------
{
  const g = fresh(4)
  const r = act(g, { rarities: ['gold'], keepForUpgrade: true })
  const kept = DUPES_FOR[0]
  const got = (r as { result: Got }).result
  check('给下一级留了份',
    r.ok && Object.values(g.cards).filter((o) => ALL_CARDS.find((c) => c.id === o.id)?.rarity === 'gold')
      .every((o) => o.dupes === kept), `每张留 ${kept}`)
  check('卖掉的是剩下的', got.dupes === (4 - kept) * 2)
  const card = some('gold', 1)[0]
  g.coins = 999_999
  check('留下来的正好够升一级', upgradeCost(g, card.id).can)
  check('升级真的成了', runAction(g, 'upgrade', { cardId: card.id }, env).ok && g.cards[card.id].level === 1)
  // and a card with nothing to spare after the reservation is simply skipped
  const h = fresh(1)
  check('只剩一张备用时，勾了保留就不卖', !act(h, { rarities: ['bronze'], keepForUpgrade: true }).ok)
  check('不勾就卖', act(fresh(1), { rarities: ['bronze'] }).ok)
}

// ---- the request cannot write its own payout ------------------------------
{
  const g = fresh()
  const r = act(g, { rarities: ['bronze'], count: 999, coins: 1_000_000, dupes: 999 })
  const got = (r as { result: Got }).result
  check('请求里的张数和金额一概不算数',
    r.ok && got.dupes === 6 && got.coins === SALVAGE.bronze * 6 && g.coins === SALVAGE.bronze * 6,
    JSON.stringify(got))
  check('编出来的稀有度不认', !act(fresh(), { rarities: ['legendary', 'ultra'] }).ok)
  check('什么都没选就什么都不做', !act(fresh(), {}).ok && !act(fresh(), { rarities: [], cardIds: [] }).ok)
  const g2 = fresh()
  act(g2, {})
  check('空请求没有偷偷清空收藏', dupesOf(g2, 'bronze') === 6 && g2.coins === 0)
}

// ---- the button's number is the account's number --------------------------
{
  const g = fresh(5)
  for (const rarity of SWEEPABLE) {
    const plan = salvagePlan(g, { rarities: [rarity], keepForUpgrade: true })
    const shown = { dupes: plan.reduce((n, l) => n + l.count, 0), coins: plan.reduce((n, l) => n + l.coins, 0) }
    const coins0 = g.coins
    const got = (act(g, { rarities: [rarity], keepForUpgrade: true }) as { result: Got }).result
    check(`${rarity}：按钮上写的就是到手的`,
      got.dupes === shown.dupes && got.coins === shown.coins && g.coins - coins0 === shown.coins,
      `${JSON.stringify(shown)} vs ${JSON.stringify(got)}`)
  }
}

// ---- a five on the table keeps its cards ----------------------------------
{
  const g = fresh()
  const seated = some('gold', 1)[0]
  g.squad.slots[0] = seated.id
  act(g, { rarities: SWEEPABLE })
  check('上阵的卡还在，位置也还在',
    !!g.cards[seated.id] && g.squad.slots[0] === seated.id && g.cards[seated.id].dupes === 0)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
