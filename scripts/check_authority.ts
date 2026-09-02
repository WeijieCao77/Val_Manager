/**
 * The server is the only thing that can change a collection.
 *
 *   npx tsx scripts/check_authority.ts
 *
 * This is the anti-cheat, so it is tested as a threat model rather than as a
 * feature: every way a client used to be able to write value into its own
 * account is tried here against the real API — the same makeCardApi and
 * makeMarketApi the deployed process runs, behind an in-process Postgres —
 * and the assertion each time is that the stored account did not move.
 *
 *   - an account created with a pre-filled state starts from the starter set
 *   - a save carrying coins, cards, pulls, a seed or a full 体力 meter changes
 *     none of them; only the name and the five go in, and a five naming a card
 *     the account does not own loses that seat
 *   - a pack costs what it costs and cannot be bought without the coins; the
 *     十连包 cannot be bought at all; what comes out is in the account before
 *     the reply
 *   - the check-in pays once a day
 *   - the ladder is played with the five the server holds, costs 体力 the
 *     server keeps, and stops when it runs out — whatever the client says its
 *     meter reads
 *   - the trading post takes the card out of the SERVER's copy when it lists
 *     and the coins out of it when it bids, refuses both when they are not
 *     there, and settles through mail the server applies
 *   - an account written by last week's client still loads and still plays
 */
process.env.ENGINE_FROM_SOURCE = '1'
import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { STARTER_COINS, STAMINA_MAX, STAMINA_COST } from '../src/engine/gacha'
import { CHALLENGE_COST } from '../src/engine/challenge'
import { cardById, isPlayerCard, personOf } from '../src/engine/cards'
import type { GachaState } from '../src/engine/gacha'

const { CARD_SCHEMA, makeCardApi, normalizeId } = await import('../cards-api.js')
const { makeMarketApi, TRADE_PULLS } = await import('../market-api.js')
const { displayName } = await import('../names.js')
const engine = await import('../src/engine/server.ts')

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex')
const db = new PGlite()
const sql = Object.assign(
  async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.reduce((q, part, i) => q + part + (i < vals.length ? `$${i + 1}` : ''), '')
    const r = await db.query(text, vals as never[])
    return Object.assign(r.rows as never[], { count: r.affectedRows ?? 0 })
  },
  { unsafe: async (q: string) => (await db.exec(q), []), json: (v: unknown) => JSON.stringify(v) },
)
await db.exec(CARD_SCHEMA)

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

interface Res { code: number; body: Record<string, unknown> }
const json = (res: Res, code: number, body: Record<string, unknown>) => { res.code = code; res.body = body }
const readBody = (req: { body: string }) => Promise.resolve(req.body)
const cards = makeCardApi(sql, { rateLimited: () => false, readBody, json } as never)
const market = makeMarketApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited: () => false, engine,
} as never)

async function call(path: string, body: unknown): Promise<Res> {
  const res: Res = { code: 0, body: {} }
  const api = path.startsWith('/api/market/') ? market : cards
  await api.route({ body: JSON.stringify(body), method: 'POST' } as never, res as never, path, 't')
  return res
}
const load = async (id: string) => (await call('/api/card/load', { id })).body as { ok: boolean; state: GachaState; rev: number }
const act = async (id: string, action: string, args: Record<string, unknown> = {}, client: Record<string, unknown> = {}) =>
  (await call('/api/card/act', { id, action, args, client })).body as {
    ok: boolean; why?: string; result?: Record<string, unknown>; state?: GachaState; rev?: number
  }
const stored = async (id: string): Promise<GachaState> => {
  const r = await sql`select state from card_accounts where id_hash = ${hashOf(id)}` as unknown as { state: GachaState }[]
  return r[0].state
}

const A = 'VM-AAAA-AAAA-AAAA-AAAA-AAAA'
const B = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB'

// ---- creating an account with the answer filled in --------------------
console.log('建号：')
{
  const r = await call('/api/card/claim', {
    id: A, name: '甲',
    state: { coins: 1_000_000, pulls: 999, cards: { 'p:P1': { id: 'p:P1', level: 5, dupes: 9, seen: 9, got: '2026-01-01' } }, packs: { ten: 50 } },
  })
  const s = r.body.state as GachaState
  check('账号由服务器建，客户端带来的金币不算', r.body.ok === true && s.coins === STARTER_COINS, `coins ${s?.coins}`)
  check('带来的卡也不算', Object.keys(s.cards).length === 0)
  check('带来的十连包也不算', !s.packs.ten && s.packs.scout === 3 && s.packs.elite === 1 && s.packs.coach === 1)
  check('抽数从零起', s.pulls === 0)
  check('账号里没有存 id', !('id' in ((await stored(A)) as object)))
}

// ---- a save that says it is rich -------------------------------------
console.log('\n存档：')
{
  const before = await load(A)
  const seedBefore = before.state.seed
  const r = await call('/api/card/save', {
    id: A, baseRev: before.rev, name: '甲改名',
    state: {
      ...before.state, coins: 999_999, pulls: 500, seed: 1,
      cards: { 'p:P1': { id: 'p:P1', level: 5, dupes: 9, seen: 9, got: '2026-01-01' } },
      packs: { ten: 50 }, daily: { ...before.state.daily, stamina: 99 },
      ladder: { ...before.state.ladder, div: 5, points: 9999, wins: 900, losses: 0 },
      squad: { slots: ['p:P1', null, null, null, null], coach: null },
    },
  })
  const s = await stored(A)
  check('存档被接受了（改名生效）', r.body.ok === true && s.name === '甲改名', `code ${r.code}`)
  check('金币没变', s.coins === STARTER_COINS, `${s.coins}`)
  check('抽数没变', s.pulls === 0)
  check('卡没变', Object.keys(s.cards).length === 0)
  check('十连包没变', !s.packs.ten)
  check('体力没变', s.daily.stamina === STAMINA_MAX, `${s.daily.stamina}`)
  check('段位没变', s.ladder.div === 0 && (s.ladder.points ?? 0) === 0 && s.ladder.wins === 0)
  check('种子没变', s.seed === seedBefore && s.seed !== 1)
  check('卡组里写了没有的卡，那个位置被清空', s.squad.slots.every((x) => x === null))
  check('没有被标记——它根本没写进去', (await sql`select suspect from card_accounts where id_hash = ${hashOf(A)}` as unknown as { suspect: boolean }[])[0].suspect === false)
}

// ---- opening packs ---------------------------------------------------
console.log('\n开包：')
{
  let r = await act(A, 'open', { kind: 'scout', payWith: 'pack' })
  const pulled = (r.result?.pulled ?? []) as { cardId: string; dupe: boolean }[]
  check('用送的试训包开一张', r.ok && pulled.length === 1, r.why)
  const s = await stored(A)
  check('卡在服务器的账号里', !!s.cards[pulled[0]?.cardId], pulled[0]?.cardId)
  check('试训包少了一个', s.packs.scout === 2)
  check('抽数 +1', s.pulls === 1)
  r = await act(A, 'open', { kind: 'ten', payWith: 'coins' })
  check('十连包买不到', !r.ok, r.why)
  r = await act(A, 'open', { kind: 'elite', payWith: 'coins' })
  check('花 2400 买一个选拔包', r.ok && (await stored(A)).coins === STARTER_COINS - 2400)
  r = await act(A, 'open', { kind: 'elite', payWith: 'coins' })
  check('剩 600 买不起第二个', !r.ok && (await stored(A)).coins === STARTER_COINS - 2400, r.why)
  r = await act(A, 'open', { kind: 'scout', payWith: 'pack' }, { coins: 1_000_000, seed: 7, packs: { scout: 99 } })
  check('随请求带来的金币和包不算', r.ok && (await stored(A)).packs.scout === 1 && (await stored(A)).coins === STARTER_COINS - 2400)
  r = await act(A, 'open', { kind: 'nope', payWith: 'pack' })
  check('不存在的包', !r.ok)
  r = await act(A, 'dance', {})
  check('不存在的操作', !r.ok && r.why === '没有这个操作')
}

// ---- the day ---------------------------------------------------------
console.log('\n签到与任务：')
{
  const c0 = (await stored(A)).coins
  let r = await act(A, 'checkin')
  check('签到 +300 金币 +1 试训包', r.ok && (await stored(A)).coins === c0 + 300 && (await stored(A)).packs.scout === 2)
  r = await act(A, 'checkin')
  check('今天再签一次不给', r.ok && (r.result as { already: boolean }).already === true && (await stored(A)).coins === c0 + 300)
  r = await act(A, 'quest', { key: 'play3' })
  check('没打满的任务领不了', !r.ok)
  r = await act(A, 'series', { region: 'China' })
  check('没到里程碑的系列领不了', !r.ok)
}

// ---- the ladder ------------------------------------------------------
console.log('\n天梯：')
{
  let r = await act(A, 'ladder')
  check('没有五个人不能打', !r.ok && r.why === '先凑齐五个人。', r.why)
  // collect five different people: packs first, then coins, then check-ins
  const five = async (): Promise<string[]> => {
    const s = await stored(A)
    const seen = new Set<string>()
    const ids: string[] = []
    for (const id of Object.keys(s.cards)) {
      const c = cardById(id)
      if (!c || !isPlayerCard(c) || seen.has(personOf(c))) continue
      seen.add(personOf(c)); ids.push(id)
    }
    return ids
  }
  for (let i = 0; i < 20 && (await five()).length < 5; i++) {
    const s = await stored(A)
    const kind = (s.packs.elite ?? 0) > 0 ? 'elite' : (s.packs.scout ?? 0) > 0 ? 'scout' : null
    if (kind) await act(A, 'open', { kind, payWith: 'pack' })
    else if (s.coins >= 750) await act(A, 'open', { kind: 'scout', payWith: 'coins' })
    else {
      // top up the way a test may: straight into the stored row, as an old
      // account that had been given coins would look
      await sql`update card_accounts set state = jsonb_set(state, '{coins}', '5000') where id_hash = ${hashOf(A)}`
    }
  }
  const ids = await five()
  check('凑到了五个不同的人', ids.length >= 5, `${ids.length}`)
  // a five that names one card the account does not hold
  r = await act(A, 'ladder', {}, { squad: { slots: [...ids.slice(0, 4), 'p:P9999'], coach: null } })
  check('卡组里有一张不属于自己的卡就凑不齐', !r.ok, r.why)
  const squad = { slots: ids.slice(0, 5), coach: null }
  let played = 0
  let coinsBefore = (await stored(A)).coins
  for (let i = 0; i < 9; i++) {
    r = await act(A, 'ladder', {}, { squad })
    if (!r.ok) break
    played++
    const res = r.result as { res: { win: boolean; lines: unknown[] }; out: { coins: number } }
    if (i === 0) {
      check('打了一场，服务器给回了记分板', Array.isArray(res.res.lines) && res.res.lines.length === 5)
      const s = await stored(A)
      check('胜负记进了账号', s.ladder.wins + s.ladder.losses === 1)
      check('体力扣了', s.daily.stamina === STAMINA_MAX - STAMINA_COST.ladder, `${s.daily.stamina}`)
      check('金币按结果给了', s.coins === coinsBefore + res.out.coins, `${coinsBefore} → ${s.coins} (+${res.out.coins})`)
      coinsBefore = s.coins
    }
  }
  check(`一管体力打 ${Math.floor(STAMINA_MAX / STAMINA_COST.ladder)} 场就停`, played === Math.floor(STAMINA_MAX / STAMINA_COST.ladder), `${played} 场`)
  check('停下来的原因是体力', !r.ok && /体力/.test(r.why ?? ''), r.why)
  r = await act(A, 'ladder', {}, { squad, daily: { stamina: 15, staminaAt: 0 } })
  check('客户端说自己体力满了也没用', !r.ok && /体力/.test(r.why ?? ''), r.why)
  const s = await stored(A)
  check('战绩就是打了的那几场', s.ladder.wins + s.ladder.losses === played)
}

// ---- the cup and the puzzle ------------------------------------------
console.log('\n杯赛与挑战：')
{
  // the ladder above ran the meter down to one point; the ticket is five
  let r = await act(A, 'cup_enter')
  check('体力不够买不了门票', !r.ok && /体力/.test(r.why ?? ''), r.why)
  // give the meter back the way time would: an anchor two days ago
  await sql`update card_accounts set state = jsonb_set(state, '{daily,staminaAt}', ${String(Date.now() - 2 * 86_400_000)}::jsonb) where id_hash = ${hashOf(A)}`
  const c0 = (await stored(A)).coins
  r = await act(A, 'cup_enter')
  const cup = (await stored(A)).cup
  check('门票扣 5 点体力，不扣金币', r.ok && (await stored(A)).daily.stamina === STAMINA_MAX - STAMINA_COST.cup && (await stored(A)).coins === c0, r.why)
  check('签表 3～5 轮', !!cup && cup.path.length >= 3 && cup.path.length <= 5, `${cup?.path.length}`)
  r = await act(A, 'cup_clear')
  check('没打完的杯赛不能作废', !r.ok)
  r = await act(A, 'cup_play')
  check('之后每一轮不扣体力', r.ok && (await stored(A)).daily.stamina === STAMINA_MAX - STAMINA_COST.cup, r.why)
  check('一轮记进了对阵表', ((await stored(A)).cup?.legs.length ?? 0) === 1)
  // play it out: nothing is charged, and the purse arrives at the end
  let legs = 1
  while (!(await stored(A)).cup?.done && legs < 6) { r = await act(A, 'cup_play'); if (!r.ok) break; legs++ }
  const done = await stored(A)
  check('打到出局或夺冠为止，体力一直没动', !!done.cup?.done && done.daily.stamina === STAMINA_MAX - STAMINA_COST.cup, `${legs} 轮，体力 ${done.daily.stamina}`)
  check('出局或夺冠都有奖金', done.coins > c0, `${c0} → ${done.coins}`)
  r = await act(A, 'cup_enter')
  check('再报一届又是 5 点体力', r.ok && (await stored(A)).daily.stamina === STAMINA_MAX - 2 * STAMINA_COST.cup, r.why)

  const c1 = (await stored(A)).coins
  r = await act(A, 'challenge', { guessId: 'nope' })
  check('猜一次扣 300 入场', r.ok && (await stored(A)).coins === c1 - CHALLENGE_COST, r.why)
  check('猜错记了一次', (await stored(A)).challenge?.guesses.length === 1)
}

// ---- the trading post -------------------------------------------------
console.log('\n交易区：')
{
  await call('/api/card/claim', { id: B, name: '乙' })
  // both have played enough to trade, the way an old account would
  for (const id of [A, B]) {
    await sql`update card_accounts set state = jsonb_set(state, '{pulls}', ${String(TRADE_PULLS + 5)}::jsonb) where id_hash = ${hashOf(id)}`
  }
  const sa = await stored(A)
  const mine = Object.keys(sa.cards)[0]
  const card = cardById(mine)!
  const before = { ...sa.cards[mine] }
  let r = await call('/api/market/list', { id: A, cardId: 'p:P9999', ask: 5000, level: 0, rarity: 'bronze' })
  check('挂一张没有的卡：拒绝', r.body.notOwned === true, JSON.stringify(r.body))
  r = await call('/api/market/list', { id: A, cardId: mine, ask: 20_000, level: 9, rarity: 'bronze' })
  check('挂自己的卡：成功', r.body.ok === true, JSON.stringify(r.body))
  const after = (await stored(A)).cards[mine]
  check('卡从服务器的账号里拿走了（重复先走，否则整张）',
    before.dupes > 0 ? after.dupes === before.dupes - 1 : after === undefined)
  const listing = (await sql`select level, ask from card_listings where seller_h = ${hashOf(A)}` as unknown as { level: number; ask: number }[])[0]
  check('挂牌的等级是账号里的等级，不是请求里写的 9', listing.level === (before.dupes > 0 ? 0 : before.level), `${listing.level}`)
  check('回复里带着更新后的账号', !!(r.body.state as GachaState)?.cards)
  r = await call('/api/market/list', { id: A, cardId: mine, ask: 1, level: 0, rarity: 'mythic' })
  check('低于分解价挂不了，金属看的是卡表不是请求', r.body.bad === true && Number(r.body.min) === ({ mythic: 4000, gold: 700, silver: 200, bronze: 60 } as Record<string, number>)[card.rarity])

  const shelf = (await call('/api/market/browse', { id: B })).body.listings as { id: string; ask: number }[]
  const l = shelf[0]
  await sql`update card_accounts set state = jsonb_set(state, '{coins}', '100') where id_hash = ${hashOf(B)}`
  r = await call('/api/market/offer', { id: B, listing: l.id, price: l.ask })
  check('钱不够出不了价', r.body.broke === true, JSON.stringify(r.body))
  await sql`update card_accounts set state = jsonb_set(state, '{coins}', '50000') where id_hash = ${hashOf(B)}`
  r = await call('/api/market/offer', { id: B, listing: l.id, price: l.ask })
  check('出价成功，金币从服务器的账号里扣走', r.body.ok === true && (await stored(B)).coins === 50000 - l.ask, `${(await stored(B)).coins}`)
  const offers = (await call('/api/market/offers', { id: A })).body.inbound as { id: string }[]
  r = await call('/api/market/answer', { id: A, offer: offers[0].id, accept: true })
  check('卖家接受', r.body.ok === true)
  const ca = (await stored(A)).coins
  let m = await act(A, 'mail_take')
  check('卖家收信：金币到账', m.ok && (await stored(A)).coins === ca + l.ask, `${ca} → ${(await stored(A)).coins}`)
  check('信箱里记了一条', ((await stored(A)).mail ?? []).length >= 1)
  m = await act(B, 'mail_take')
  check('买家收信：卡到账', m.ok && !!(await stored(B)).cards[mine])
  m = await act(B, 'mail_take')
  check('再收一次什么都没有', m.ok && ((m.result as { mail: unknown[] }).mail.length === 0))
  const mm = await call('/api/market/mail', { id: B, take: true })
  check('旧的取信接口不再发货', mm.body.moved === true)
}

// ---- an account written by last week's client -----------------------
console.log('\n旧存档：')
{
  const C = 'VM-CCCC-CCCC-CCCC-CCCC-CCCC'
  const old = {
    version: 1, id: C, name: '丙', createdAt: '2026-08-20', coins: 4200,
    cards: { 'p:P5': { id: 'p:P5', level: 1, dupes: 2, seen: 4, got: '2026-08-20' } },
    packs: { scout: 1 }, squad: { slots: ['p:P5', null, null, null, null], coach: null },
    pity: 3, pulls: 12, ladder: { div: 1, stars: 2, best: 1, wins: 5, losses: 3, streak: 1 },
    cup: null, daily: { claimed: '2026-08-30', streak: 2, questDay: null, picked: [], progress: {}, taken: [] },
    log: [], seed: 12345,
  }
  await sql`insert into card_accounts (id_hash, name, state, rev, created) values (${hashOf(C)}, '丙', ${sql.json(old)}, 3, now() - interval '10 days')`
  const r = await load(C)
  check('能读', r.ok === true && r.state.coins === 4200)
  check('读出来是补齐的形状', !!r.state.challenge && Array.isArray(r.state.friends) && r.state.daily.stamina === STAMINA_MAX)
  check('存进去时 id 没有留在行里', !('id' in ((await stored(C)) as object)))
  const a = await act(C, 'checkin')
  check('还能签到', a.ok && (await stored(C)).coins === 4500, a.why)
  const s = await stored(C)
  check('旧账号的卡和抽数原样保留', s.pulls === 12 && s.cards['p:P5']?.dupes === 2)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
