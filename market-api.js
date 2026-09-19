/**
 * The trading post.
 *
 * The rule that makes it safe is that both sides pay in when they act and
 * collect afterwards. Listing escrows the CARD; bidding escrows the COINS.
 * Whatever happens next — sold, outbid, unsold, withdrawn — every escrow
 * ends up as a row in card_mail for somebody to collect. Neither side can be
 * left holding nothing because the other one never came back, which is the
 * failure mode a market between asynchronous players actually has.
 *
 * Since 2026-09-07 a listing is an AUCTION: a starting price, a day on the
 * clock, and the top bid wins when the clock runs out — the seller has no
 * say in who. The make-an-offer market it replaces let the seller pick any
 * bid, and the group used that in two ways: a card listed cheap that its
 * seller never sold, with a dozen people's coins locked on it for three
 * days; and a card sold to a friend under a higher bid, which is the gift
 * funnel with extra steps. Under the hammer neither works — a cheap start
 * just sells cheap, and the only way to get the card to a friend is for the
 * friend to outbid everyone. A bid must climb at least five percent over the
 * last, the bidder it beats gets the coins back at once, a bid in the last
 * ten minutes pushes the end back ten minutes, and a bid is binding: neither
 * side can take it back. An optional buy-now price ends the auction on the
 * spot for anyone who pays it.
 *
 * The clock is checked lazily rather than by a job: an auction past its end
 * is settled the moment anyone looks at the market, so the state a player
 * sees is always already correct. Listings from before the change have no
 * `ends` and run out on the old rules — offers within ten percent, the
 * seller answering, three days before an unanswered offer goes home.
 *
 * The collection is the server's now — see engine/actions.ts — so the seller
 * really does own the card: it is taken out of the server's copy of the
 * account at the moment it is listed, and a bid takes the coins out of the
 * bidder's at the moment it is made. A client that says otherwise is not
 * consulted.
 */
import { createHash, randomInt } from 'node:crypto'
import { isVerified } from './phone-api.js'
import { requestAction } from './cards-api.js'
import { makeMarketGuard, PROTECT_SEC } from './market-guard.js'

/** How long a listing takes bids before the top one wins — the seller's choice, within these. */
export const AUCTION_HOURS = 24
export const AUCTION_MIN_HOURS = 2
export const AUCTION_MAX_HOURS = 24
/** the choices the listing form offers; any whole number of hours in range is accepted */
export const AUCTION_HOURS_CHOICES = [2, 4, 6, 8, 12, 24]
/** The least a bid must climb over the one it beats. */
export const BID_STEP = 0.05
/** A bid this close to the end pushes the end back by this much. */
export const SNIPE_MINUTES = 10
/** …but the stretching stops once the auction has run this much past its day: a card cannot be bid on forever. */
export const SNIPE_CAP_MINUTES = 60
/** A buy-now price, if the seller sets one, is at least this much of the start. */
export const BUYOUT_MIN = 1.2
/**
 * 上架保护期: for this long after a card goes up, 一口价 does not buy it — it
 * enters a draw, coins in escrow, and when the time is up one entry is picked
 * at random and the rest go home. A script that sees a listing in its first
 * second gains nothing over a person who sees it in its fortieth. After the
 * minute, with nobody entered, 一口价 buys at once as it always did.
 */
export { PROTECT_SEC }
/** The least the next bid may be: the start until somebody bids, a step over the top after. */
export const minBid = (ask, top) => (top == null ? ask : Math.max(ask, Math.ceil(top * (1 + BID_STEP))))

/** (old listings only) How far an offer may sit from the asking price, either way. */
export const HAGGLE = 0.10
/** (old listings only) An offer the seller never answers. */
export const OFFER_DAYS = 3
/**
 * How many of other people's listings one page of the shelf holds.
 *
 * It used to be one window of 400 and no way past it, ordered by the auction
 * closing soonest. With 1,428 cards on the market that window covered the next
 * FIVE HOURS: a card listed for a day was invisible to every buyer for its
 * first nineteen, and 「我挂的卡别人看不见」 was simply true. Worse, the window
 * moved, so two people looking an hour apart saw two different markets and
 * neither could be told they were looking at a twelfth of it.
 *
 * So the shelf is paged instead — a page at a time, forward from a cursor, in
 * whatever order and through whatever filter the player picked. Nothing is out
 * of reach any more; it is only further down.
 */
export const PAGE = 60
export const PAGE_MAX = 80
/**
 * The orders the shelf can be read in. `ends` is the auction closing soonest
 * and is the default; `new` is the one that guarantees a card just listed is
 * on somebody's first screen, which is the whole reason it exists.
 */
export const SORTS = ['ends', 'new', 'price', 'price_desc']
/** (old listings only) Consecutive ignored offers before the listing gives up. */
export const IGNORE_LIMIT = 3
/**
 * How many listings one seller may have open at once.
 *
 * Three, by the owner's rule of 2026-09-05: a shelf is for the card you
 * want gone, not a shop window. A sale or a withdrawal frees the seat and
 * the next card can go up; it is counted at the moment of listing, so what
 * was already up when the cap came down stays up — the count only refuses
 * a NEW listing while three or more are open.
 */
export const MAX_LISTINGS = 3

/**
 * How much of the game an account has to have played before it can trade.
 *
 * The floor on the asking price stopped cards being handed between accounts
 * for nothing, but not the rest of it: an alt could still sell commons at
 * salvage, which is several times cheaper than pulling them. What kills that
 * economy is making the alt itself expensive.
 *
 * Measured, not guessed. A brand-new account is worth exactly ten pulls: the
 * starter packs are seven, and the 3000 opening coins buy one more 选拔包. From
 * there a check-in is a 试训包 a day plus 300 coins, with a 选拔包 every third
 * day and a 十连包 on the seventh — about thirty-five by the end of week one for
 * somebody who only signs in, sooner for anybody actually playing the ladder.
 *
 * So fifty is roughly a week of showing up. That is far more effort than the
 * handful of common cards a throwaway could then move, which is the whole
 * point; and it is short enough that a real new player is inside it before he
 * has anything worth selling anyway.
 *
 * Counted in pulls rather than days because pulls is the one number that only
 * ever goes up and that the server already trusts for exactly this reason —
 * see progress.js.
 */
export const TRADE_PULLS = 50

/**
 * And how old it has to be.
 *
 * Fifty pulls is a week of one person's effort, but one person can spend that
 * week on several accounts at once. On 2026-09-10 one account's 彩卡 had come
 * in from other accounts through buy-now listings, each paid back minutes
 * later by selling a 60-coin bronze to the same account for the same money.
 * Age is the one requirement that cannot be played faster: three days is three
 * days however many accounts share them, so an account made tonight is no use
 * for trading tonight. Measured on the database clock, not the client's.
 *
 * `TRADE_DAYS=0` in the environment turns it off, for a local server on an
 * in-process PGlite: its accounts cannot be backdated from outside, and a
 * browser walkthrough of the market would otherwise wait three real days.
 */
const tradeDaysEnv = Number(process.env.TRADE_DAYS)
export const TRADE_DAYS = process.env.TRADE_DAYS && Number.isFinite(tradeDaysEnv) && tradeDaysEnv >= 0 ? tradeDaysEnv : 3
export const MAX_ASK = 500_000

/**
 * The least a card may be listed for: what the game itself would pay you.
 *
 * A flat floor of 50 made the market a better alt-account funnel than the
 * gifting it replaced — list a card for 50, buy it from your own throwaway
 * account, done. Anchoring the floor to SALVAGE closes that without costing a
 * real seller anything, because nobody sane sells below salvage: you would
 * simply salvage it and take the same coins with no waiting.
 *
 * The rarity is declared by the client, and that is worth stating rather than
 * dressing up: the server has no card table to check it against. What the floor
 * stops is the ordinary funnel — somebody making throwaway accounts with the
 * real game and moving cards out of them — which is the thing that was actually
 * happening. Someone editing the request to under-declare a rarity is already
 * someone who can fabricate the card outright, which the module header says is
 * possible and is not made worse by this.
 */
export const SALVAGE_FLOOR = { mythic: 4000, gold: 700, silver: 200, bronze: 60 }
export const MIN_ASK = 50

export const askFloor = (rarity) => Math.max(MIN_ASK, SALVAGE_FLOOR[rarity] ?? MIN_ASK)

const hash = (id) => createHash('sha256').update(String(id)).digest('hex')

export function makeMarketApi(sql, {
  readBody, json, normalizeId, displayName, rateLimited, engine, token, tokenFrom, tokenOk,
  /** false in the checks, which call settleDue() themselves so nothing moves behind their back */
  timer = true,
  /** the background connection budget (server.js): the settler's transactions run here, not on the players' pool */
  bg = null,
  /**
   * The switch back: MARKET_SUMMARY=0 keeps the shelf on the old aggregate
   * query whatever the summaries say. They are still maintained, so turning
   * it on again needs no backfill.
   */
  useSummary = process.env.MARKET_SUMMARY !== '0',
}) {
  /** The account as it is written: never with the id in it. */
  const stored = (state) => { const { id, ...rest } = state; void id; return rest }
  const guard = (req, res, bucket, max) => {
    if (rateLimited(bucket, max)) { json(res, 429, { ok: false, why: 'rate' }); return true }
    return false
  }

  const post = (to, kind, extra = {}, db = sql) => db`
    insert into card_mail (to_h, kind, card_id, level, coins, pack, count, body)
    values (${to}, ${kind}, ${extra.cardId ?? null}, ${extra.level ?? 0},
            ${extra.coins ?? 0}, ${extra.pack ?? null}, ${extra.count ?? 1},
            ${db.json(extra.body ?? {})})`

  /**
   * Everything that moves a card or a coin runs inside one of these. A
   * listing is "the card leaves the account" AND "the listing exists"; a bid
   * is "the coins leave" AND "the offer exists"; a sale is a status change
   * AND two pieces of mail. Done as separate statements, a crash or a
   * database error between them left an account short with nothing owed to
   * it. Inside a transaction the whole step happens or none of it does.
   * (The PGlite shim carries the same `begin`; without one at all, plain.)
   */
  const tx = (fn) => (sql.begin ? sql.begin(fn) : fn(sql))
  const work = bg ?? sql
  /** scripts on the shelf: who is suspended from trading, and who is about to be (market-guard.js) */
  const guard2 = makeMarketGuard(sql, { bg, displayName: (name, h) => displayName(name, h) })
  const bgTx = (fn) => (work.begin ? work.begin(fn) : fn(work))

  /**
   * A write the client named (requestId) happens once — the same table and the
   * same rule as /api/card/act: the request is claimed inside the transaction
   * that moves the card or the coins, and its answer is stored there, so a
   * retry after a lost reply reads the answer instead of bidding twice. The
   * account is never stored with it; a replay carries the account as it is now.
   */
  let requestsSeen = false
  const requestIdOf = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : null)
  /** Named writes fail closed until the deduplication table is ready. */
  async function requestsReady() {
    if (requestsSeen) return true
    try { requestsSeen = !!(await sql`select to_regclass('public.card_requests') as t`)[0]?.t } catch { /* not yet */ }
    return requestsSeen
  }
  async function claimRequest(db, me, requestId, action) {
    if (!requestId) return null
    const claimed = await db`
      insert into card_requests (id_hash, request_id, action) values (${me}, ${requestId}, ${action})
      on conflict (id_hash, request_id) do nothing returning 1 as ok`
    if (claimed.length) return null
    const prior = await db`select action, reply from card_requests where id_hash = ${me} and request_id = ${requestId}`
    const cur = await db`select state, rev from card_accounts where id_hash = ${me}`
    if (prior[0]?.action !== action) return { ok: false, replayed: true, clash: true }
    return { replayed: true, ...(prior[0]?.reply ?? { ok: false, why: '原请求结果暂时无法确认，请刷新账号核对。' }), state: cur[0]?.state, rev: cur[0]?.rev }
  }
  async function rememberRequest(db, me, requestId, out) {
    if (!requestId) return
    const { state, rev, ...kept } = out ?? {}
    void state; void rev
    await db`update card_requests set reply = ${db.json(kept)} where id_hash = ${me} and request_id = ${requestId}`
  }
  /**
   * The answer to a request already finished, read before any of the checks
   * that would now answer differently (a bid that landed makes its own retry
   * 「你已是最高价」). Only a shortcut: the claim inside the transaction is what
   * makes two copies in flight at once safe.
   */
  async function finished(me, requestId, action) {
    if (!requestId) return null
    const prior = await sql`select action, reply from card_requests where id_hash = ${me} and request_id = ${requestId}`
    if (!prior.length || prior[0].reply == null) return null
    if (prior[0].action !== action) return { ok: false, clash: true }
    const cur = await sql`select state, rev from card_accounts where id_hash = ${me}`
    return { ...prior[0].reply, replayed: true, state: cur[0]?.state, rev: cur[0]?.rev }
  }

  /** Run a write's transaction body once per requestId. `busy` is not an answer and is not remembered. */
  const once = (me, requestId, action, body) => tx(async (db) => {
    const prior = await claimRequest(db, me, requestId, action)
    if (prior) return prior
    const out = await body(db)
    if (out?.busy) {
      if (requestId) await db`delete from card_requests where id_hash = ${me} and request_id = ${requestId}`
      return out
    }
    await rememberRequest(db, me, requestId, out)
    return out
  })

  /** A listing, offer or swap id off the wire: digits, or nothing. Anything
   *  else went straight into a `::bigint` cast and answered 500. */
  const rowId = (v) => (/^\d{1,18}$/.test(String(v ?? '')) ? String(v) : null)

  /**
   * Settling what the clock has decided — off the request path.
   *
   * It was lazy: arriving at the market settled every auction that had ended,
   * in one transaction, a listing at a time, and the shelf waited for it. With
   * a backlog that is the whole cost of the backlog on whoever opens the page
   * next (measured 2026-09-18 on the in-process database: 1,000 ended auctions
   * put 8,007 statements and 1.4 s in front of one shelf read), and on the
   * shared pool behind them. 2026-09-17 made that one sweep instead of one per
   * visitor; this takes it out of the visit altogether:
   *
   *  - Reading the shelf, or your bids, runs no settlement and opens no
   *    transaction. An auction past its end is simply not shown (`ends >
   *    now()` in the read), and cannot be bid on (the bid checks the clock
   *    under the listing's row lock, as it always did).
   *  - A timer settles ended auctions in batches of SETTLE_BATCH, each batch
   *    one short transaction and about ten statements however many rows are
   *    in it, for at most SETTLE_BUDGET_MS a tick. Rows are claimed with FOR
   *    UPDATE SKIP LOCKED, so two processes (a deploy overlaps containers)
   *    take different rows and neither waits; nothing is remembered in the
   *    process, so a restart just carries on from the table. A batch that
   *    fails is retried a listing at a time, so one bad row cannot hold the
   *    others back, and whatever is left is tried again next tick.
   *  - A request that needs ONE listing settled (relisting when your three
   *    slots are taken by auctions that have ended) settles its own, not
   *    the market's.
   *
   * The sale itself is unchanged: offer accepted, listing sold, card to the
   * buyer's mail, coins to the seller's, beaten bids home — all in the
   * transaction that holds the listing's lock, or none of it.
   */
  const SETTLE_BATCH = 50
  const SETTLE_BUDGET_MS = 1500
  const SETTLE_EVERY_MS = 5000
  const CHORES_EVERY_MS = 60_000
  /** `ends` is over and nobody has closed it yet — hidden from every read, claimed by the settler. */
  const mailRows = (db, rows) => (rows.length ? db`
    insert into card_mail (to_h, kind, card_id, level, coins, pack, count, body)
    select x.to_h, x.kind, x.card_id, coalesce(x.level, 0), coalesce(x.coins, 0), null, 1, coalesce(x.body, '{}'::jsonb)
      from jsonb_to_recordset(${db.json(rows)}::jsonb)
        as x(to_h text, kind text, card_id text, level int, coins int, body jsonb)` : null)

  /**
   * Bring one listing's summary columns level with its offers — called in the
   * transaction that just changed them (a bid, a withdrawal, a refusal), under
   * the lock that transaction already holds. Recomputed from the ledger rather
   * than adjusted, so it cannot drift by construction; a closed listing is
   * left alone, nobody reads its summary.
   */
  const refreshSummary = (db, listingId) => db`
    update card_listings l set
      top_bid = o.best, top_buyer_h = o.top_buyer, open_n = o.open_n, bid_n = o.all_n,
      cur_price = coalesce(o.best, l.ask)
    from (
      select (max(f.price) filter (where f.status = 'open'))::int as best,
             (array_agg(f.buyer_h order by f.price desc, f.made asc, f.id asc) filter (where f.status = 'open'))[1] as top_buyer,
             (count(*) filter (where f.status = 'open'))::int as open_n,
             (count(*) filter (where f.status in ('open', 'outbid', 'accepted')))::int as all_n
        from card_offers f where f.listing = ${listingId}::bigint
    ) o
    where l.id = ${listingId}::bigint and l.status = 'open'`

  /**
   * Backfill, then check, then switch.
   *
   * `summaryLive` is what the shelf reads to decide which query to run. It
   * turns true only when no open listing is missing its summary AND the
   * summaries agree with the ledger; a mismatch found later repairs the row,
   * is logged, and — if there were many — turns it back off until the next
   * clean pass. So a bug in the bookkeeping shows up as a slower shelf and a
   * line in the log, never as a wrong price.
   */
  let summaryLive = false
  async function repairSummary(listingId) {
    return bgTx(async (db) => {
      await db`select id from card_listings where id = ${listingId}::bigint for update`
      await refreshSummary(db, listingId)
    })
  }
  async function backfillSummary(limit = 50) {
    const todo = await work`
      select id from card_listings where status = 'open' and cur_price is null order by id limit ${limit}`
    for (const l of todo) await repairSummary(String(l.id))
    return todo.length
  }
  async function verifySummary() {
    const missing = await work`select count(*)::int as n from card_listings where status = 'open' and cur_price is null`
    if (missing[0].n > 0) { summaryLive = false; return { missing: missing[0].n, wrong: 0 } }
    const wrong = await work`
      select l.id from card_listings l
      left join lateral (
        select (max(f.price) filter (where f.status = 'open'))::int as best,
               (array_agg(f.buyer_h order by f.price desc, f.made asc, f.id asc) filter (where f.status = 'open'))[1] as top_buyer,
               (count(*) filter (where f.status = 'open'))::int as open_n,
               (count(*) filter (where f.status in ('open', 'outbid', 'accepted')))::int as all_n
          from card_offers f where f.listing = l.id
      ) o on true
      where l.status = 'open'
        and (l.cur_price is distinct from coalesce(o.best, l.ask) or l.top_bid is distinct from o.best
          or l.top_buyer_h is distinct from o.top_buyer
          or coalesce(l.open_n, 0) <> coalesce(o.open_n, 0) or coalesce(l.bid_n, 0) <> coalesce(o.all_n, 0))
      limit 200`
    for (const l of wrong) await repairSummary(String(l.id))
    if (wrong.length) console.warn(`market: ${wrong.length} listing summaries disagreed with the offers and were rebuilt`)
    summaryLive = wrong.length < 20
    return { missing: 0, wrong: wrong.length }
  }
  let summaryAt = 0
  async function summaryChores(force = false) {
    if (!force && summaryLive && Date.now() - summaryAt < 60 * 60 * 1000) return
    if (!force && !summaryLive && Date.now() - summaryAt < 15_000) return
    summaryAt = Date.now()
    await backfillSummary()
    await verifySummary()
  }

  /**
   * One batch: claim up to `limit` ended auctions, close them all, post all the mail.
   * `seller` narrows it to one account's listings. Returns how many were closed.
   */
  async function settleBatch(limit = SETTLE_BATCH, seller = null, only = null, run = bgTx) {
    return run(async (db) => {
      const ended = await db`
        select id, seller_h, card_id, level from card_listings
        where status = 'open' and ends is not null and ends <= now()
          and (${seller}::text is null or seller_h = ${seller}::text)
          and (${only}::bigint is null or id = ${only}::bigint)
        order by ends, id
        limit ${limit}
        for update skip locked`
      if (!ended.length) return 0
      const ids = ended.map((l) => String(l.id))
      const tops = await db`
        select distinct on (listing) id, listing, buyer_h, price from card_offers
        where listing = any(${ids}::bigint[]) and status = 'open'
        order by listing, price desc, made asc, id asc`
      const topOf = new Map(tops.map((o) => [String(o.listing), o]))
      const soldIds = ids.filter((id) => topOf.has(id))
      const unsoldIds = ids.filter((id) => !topOf.has(id))
      const mail = []
      if (soldIds.length) {
        await db`update card_offers set status = 'accepted', settled = now()
                  where id = any(${tops.map((o) => String(o.id))}::bigint[]) and status = 'open'`
        await db`update card_listings set status = 'sold', closed = now()
                  where id = any(${soldIds}::bigint[]) and status = 'open'`
        // every other bid still open on a sold listing goes home
        const rest = await db`
          update card_offers set status = 'expired', settled = now()
          where listing = any(${soldIds}::bigint[]) and status = 'open'
          returning listing, buyer_h, price`
        const names = await namesOf(ended.filter((l) => topOf.has(String(l.id)))
          .flatMap((l) => [l.seller_h, topOf.get(String(l.id)).buyer_h]), db)
        for (const l of ended) {
          const o = topOf.get(String(l.id))
          if (!o) continue
          mail.push({ to_h: o.buyer_h, kind: 'bought', card_id: l.card_id, level: l.level, coins: 0,
            body: { price: o.price, who: names[l.seller_h] } })
          mail.push({ to_h: l.seller_h, kind: 'sold', card_id: null, level: 0, coins: o.price,
            body: { cardId: l.card_id, price: o.price, who: names[o.buyer_h] } })
        }
        const cardOf = new Map(ended.map((l) => [String(l.id), l.card_id]))
        for (const r of rest) {
          mail.push({ to_h: r.buyer_h, kind: 'outbid', card_id: null, level: 0, coins: r.price,
            body: { cardId: cardOf.get(String(r.listing)) } })
        }
      }
      if (unsoldIds.length) {
        await db`update card_listings set status = 'expired', closed = now()
                  where id = any(${unsoldIds}::bigint[]) and status = 'open'`
        for (const l of ended) {
          if (topOf.has(String(l.id))) continue
          mail.push({ to_h: l.seller_h, kind: 'unsold', card_id: l.card_id, level: l.level, coins: 0,
            body: { listing: String(l.id) } })
        }
      }
      await mailRows(db, mail)
      return ended.length
    }).then((n) => { if (n) menuCache.clear(); return n })
  }

  /** The old make-an-offer listings' clock: bounded, and only ever a handful of rows since 2026-09-07. */
  async function legacyChores() {
    await bgTx(async (db) => {
      const stale = await db`
        update card_offers o set status = 'expired', settled = now()
        from card_listings l
        where o.listing = l.id and l.ends is null
          and o.status = 'open' and o.made < now() - make_interval(days => ${OFFER_DAYS})
          and o.id in (select o2.id from card_offers o2 join card_listings l2 on l2.id = o2.listing
                        where l2.ends is null and o2.status = 'open'
                          and o2.made < now() - make_interval(days => ${OFFER_DAYS})
                        order by o2.id limit 200)
        returning o.id, o.listing, o.buyer_h, o.price`
      const mail = []
      for (const o of stale) {
        // the coins go home
        mail.push({ to_h: o.buyer_h, kind: 'offer_expired', card_id: null, level: 0, coins: o.price, body: { listing: String(o.listing) } })
        await db`update card_listings set ignored = ignored + 1 where id = ${o.listing}`
        await refreshSummary(db, String(o.listing))
      }
      const dead = await db`
        update card_listings set status = 'expired', closed = now()
        where status = 'open' and ignored >= ${IGNORE_LIMIT}
        returning id, seller_h, card_id, level`
      for (const l of dead) {
        // and so does the card
        mail.push({ to_h: l.seller_h, kind: 'listing_expired', card_id: l.card_id, level: l.level, coins: 0, body: { listing: String(l.id) } })
        // and so do the bids still sitting on it. A listing can die with a
        // fresh offer on it — somebody bid after the third ignored one was
        // made and before it was swept — and this used to mark that offer
        // expired without the mail, which is how 「出价的金币被卡了」 happened:
        // the card was gone from the shelf and the coins were gone with it.
        const back = await db`
          update card_offers set status = 'expired', settled = now()
          where listing = ${l.id} and status = 'open' returning buyer_h, price`
        for (const o of back) {
          mail.push({ to_h: o.buyer_h, kind: 'offer_expired', card_id: null, level: 0, coins: o.price, body: { listing: String(l.id) } })
        }
      }
      await mailRows(db, mail)
    })
  }

  /**
   * One tick of the settler: batches until the table is clear or the budget
   * is spent. One at a time in this process; other processes take other rows.
   */
  /**
   * The draw on one listing, inside the caller's transaction (which holds the
   * listing's row lock): one of the entries at the buy-now price, at random,
   * and settle() sends everybody else's coins home. Returns the winner's hash, or null if nothing sold.
   */
  async function drawOne(db, l) {
    const entries = await db`
      select id, buyer_h, price from card_offers
      where listing = ${l.id} and status = 'open' and price >= ${l.buyout}
      order by id`
    if (!entries.length) {
      await db`update card_listings set draw_at = null where id = ${l.id}`
      return null
    }
    const winner = entries[randomInt(entries.length)]
    return (await settle(db, l, winner, { draw: entries.length })) ? winner.buyer_h : null
  }
  /** Every draw whose minute is up, a bounded batch at a time, each in its own transaction. */
  async function drawDue(limit = SETTLE_BATCH) {
    const due = await work`
      select id from card_listings where status = 'open' and draw_at is not null and draw_at <= now()
      order by draw_at, id limit ${limit}`
    let n = 0
    for (const d of due) {
      try {
        const sold = await bgTx(async (db) => {
          const rows = await db`
            select id, seller_h, card_id, level, buyout from card_listings
            where id = ${d.id} and status = 'open' and draw_at is not null and draw_at <= now()
            for update skip locked`
          return rows.length ? drawOne(db, rows[0]) : null
        })
        // a card won in a draw is a card bought: the script guard looks at the winner like at any buyer
        if (sold) { n++; guard2.checkSoon(sold) }
      } catch (err) {
        settleStats.failed++
        console.warn(`market: draw on listing ${d.id} failed —`, err.message)
      }
    }
    if (n) menuCache.clear()
    return n
  }

  let settling = null
  let choresAt = 0
  const settleStats = { ticks: 0, settled: 0, failed: 0, lastMs: 0, backlog: null }
  function settleDue({ budgetMs = SETTLE_BUDGET_MS, batch = SETTLE_BATCH, chores = false } = {}) {
    settling ??= (async () => {
      const t0 = Date.now()
      let total = 0
      try {
        total += await drawDue().catch((err) => { console.warn('market: draws failed —', err.message); return 0 })
        for (;;) {
          let n
          try {
            n = await settleBatch(batch)
          } catch (err) {
            // One row that cannot be settled must not stop the rest: take the
            // same rows one at a time, each in its own transaction, and leave
            // the one that throws for the next tick (and for the log).
            console.warn('market: settle batch failed, retrying one by one —', err.message)
            n = 0
            const due = await work`
              select id from card_listings
              where status = 'open' and ends is not null and ends <= now()
              order by ends, id limit ${batch}`
            for (const l of due) {
              if (Date.now() - t0 >= budgetMs) break
              try { n += await settleBatch(1, null, String(l.id)) } catch (e) {
                settleStats.failed++
                console.warn(`market: listing ${l.id} would not settle —`, e.message)
              }
            }
            total += n
            break
          }
          total += n
          if (n < batch || Date.now() - t0 >= budgetMs) break
        }
        if (chores || Date.now() - choresAt >= CHORES_EVERY_MS) {
          choresAt = Date.now()
          await legacyChores().catch((err) => console.warn('market: legacy chores failed —', err.message))
        }
        if (chores || Date.now() - t0 < budgetMs) {
          await summaryChores(chores).catch((err) => console.warn('market: summary chores failed —', err.message))
        }
      } finally {
        settleStats.ticks++
        settleStats.settled += total
        settleStats.lastMs = Date.now() - t0
        if (settleStats.lastMs > 2000) console.warn(`market: settling ${total} took ${settleStats.lastMs} ms`)
        settling = null
      }
      return total
    })()
    return settling
  }
  if (timer && sql) {
    setInterval(() => { settleDue().catch((err) => console.warn('market: settle failed —', err.message)) }, SETTLE_EVERY_MS).unref?.()
  }

  /**
   * Take every listing from before the auctions off the shelf at once: the
   * card goes home to its seller, every offer standing on it goes home to
   * its bidder. The owner's call on 2026-09-07, rather than letting 1,263
   * old-rule listings run out over three days beside the new ones.
   */
  async function retireLegacy() {
    // In batches, each its own transaction, and never waiting on a row
    // somebody else holds: the first run took every old listing in one
    // transaction, met a player's sweep coming the other way, and Postgres
    // killed it for deadlock — 1,287 rows rolled back and nothing retired.
    // A batch that still deadlocks is simply tried again.
    let listings = 0
    let offers = 0
    let stalls = 0
    for (;;) {
      let took = 0
      try {
        took = await tx(async (db) => {
          const rows = await db`
            select id, seller_h, card_id, level from card_listings
            where status = 'open' and ends is null
            order by id limit 50 for update skip locked`
          for (const l of rows) {
            const closed = await db`
              update card_listings set status = 'pulled', closed = now()
              where id = ${l.id} and status = 'open' returning id`
            if (!closed.length) continue
            listings++
            await post(l.seller_h, 'listing_retired', {
              cardId: l.card_id, level: l.level, body: { listing: String(l.id) },
            }, db)
            const back = await db`
              update card_offers set status = 'expired', settled = now()
              where listing = ${l.id} and status = 'open' returning buyer_h, price`
            for (const o of back) {
              await post(o.buyer_h, 'offer_expired', { coins: o.price, body: { listing: String(l.id) } }, db)
              offers++
            }
          }
          return rows.length
        })
      } catch (err) {
        if (err?.code === '40P01' && stalls++ < 20) continue   // deadlock: try the batch again
        throw err
      }
      if (!took) break
    }
    return { ok: true, listings, offers, retried: stalls }
  }

  /**
   * Has this account played enough to trade?
   *
   * Read from the saved state, which is the same place the ownership and coin
   * checks read from. Browsing is deliberately not gated — a new player should
   * be able to see what a card goes for long before he can buy one.
   */
  async function tooNew(h) {
    const r = await sql`
      select state->>'pulls' as pulls,
             ceil(extract(epoch from (created + make_interval(days => ${TRADE_DAYS}) - now())))::int as wait
      from card_accounts where id_hash = ${h}`
    const pulls = Number(r[0]?.pulls ?? 0)
    // seconds until it is old enough; an account that is not there never is
    const wait = r.length ? Math.max(0, Number(r[0].wait) || 0) : TRADE_DAYS * 86_400
    return pulls >= TRADE_PULLS && wait === 0
      ? null
      : { need: TRADE_PULLS, have: Math.max(0, Math.floor(pulls)), days: TRADE_DAYS, wait }
  }

  const nameOf = async (h, db = sql) => {
    const r = await db`select name from card_accounts where id_hash = ${h}`
    const shown = displayName(r[0]?.name, h)
    return `${shown.name} #${shown.tag}`
  }

  /**
   * The same, for a whole page of listings, in one query rather than one per
   * seller. A shelf of sixty is sixty different sellers as often as not, and
   * the shelf is read several times now that it pages — `= any($1)` with a
   * plain array, NOT sql(list): a nested tagged template is not something the
   * PGlite shim the checks run against can compose.
   */
  const namesOf = async (hashes, db = sql) => {
    const want = [...new Set(hashes)]
    const out = {}
    if (!want.length) return out
    const rows = await db`select id_hash, name from card_accounts where id_hash = any(${want})`
    const known = new Map(rows.map((r) => [r.id_hash, r.name]))
    for (const h of want) {
      const shown = displayName(known.get(h), h)
      out[h] = `${shown.name} #${shown.tag}`
    }
    return out
  }

  /** Until when a listing is in its 保护期, as milliseconds; null when it has no buy-now or the minute is over. */
  const protectEnd = (l) => {
    if (l.buyout == null || !l.created) return null
    const end = new Date(l.created).getTime() + PROTECT_SEC * 1000
    return end > Date.now() ? end : null
  }

  /** When an auction closes, as milliseconds; null for an old-style listing. */
  const endsAt = (l) => (l.ends ? new Date(l.ends).getTime() : null)

  /**
   * Hand the card to a bid and the coins to the seller — the one place they
   * change hands. Inside the caller's transaction; false if somebody else
   * closed the listing first, in which case the bid's coins go straight home.
   */
  async function settle(db, l, o, { draw = 0 } = {}) {
    const won = await db`
      update card_offers set status = 'accepted', settled = now()
      where id = ${o.id} and status = 'open' returning id`
    if (!won.length) return false
    const closed = await db`
      update card_listings set status = 'sold', closed = now()
      where id = ${l.id} and status = 'open' returning id`
    if (!closed.length) {
      await db`update card_offers set status = 'expired', settled = now() where id = ${o.id}`
      await post(o.buyer_h, 'offer_expired', { coins: o.price, body: { listing: String(l.id) } }, db)
      return false
    }
    const [sellerName, buyerName] = [await nameOf(l.seller_h, db), await nameOf(o.buyer_h, db)]
    await post(o.buyer_h, 'bought', {
      cardId: l.card_id, level: l.level, body: draw ? { price: o.price, who: sellerName, draw } : { price: o.price, who: sellerName },
    }, db)
    await post(l.seller_h, 'sold', {
      coins: o.price, body: { cardId: l.card_id, price: o.price, who: buyerName },
    }, db)
    // every other bid still open on it goes home (an old-style listing can
    // hold several; an auction settles the beaten one the moment it is beaten)
    const rest = await db`
      update card_offers set status = 'expired', settled = now()
      where listing = ${l.id} and status = 'open' returning buyer_h, price`
    // after a draw the others are told it was a draw they lost, not that they were slow
    for (const r of rest) await post(r.buyer_h, 'outbid', { coins: r.price, body: draw ? { cardId: l.card_id, draw } : { cardId: l.card_id } }, db)
    return true
  }

  /**
   * Where a page of the shelf stopped, so the next one starts strictly after
   * it: the sort key of the last row and that row's id.
   *
   * A keyset and not an offset. Auctions close while somebody is scrolling, so
   * `offset 60` shows the same card twice and skips another every time a row
   * ahead of it disappears; a cursor pinned to the last row read cannot.
   */
  const cursorOf = (sort, row, v = 1) => Buffer
    .from(JSON.stringify(v === 1 ? [sort, Number(row.sortkey), String(row.id)] : [sort, row.sortkey, String(row.id), v]))
    .toString('base64url')

  /**
   * …and back, refusing anything that is not one of ours. A bad cursor reads
   * as the first page — and so does one minted by the other shelf query (`v`):
   * the two order ties differently, and a place in one is not a place in the other.
   */
  const readCursor = (sort, raw, v = 1) => {
    if (typeof raw !== 'string' || !raw || raw.length > 400) return null
    try {
      const [s2, key, id, v2 = 1] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
      // a cursor from a different order describes a place that does not exist
      // in this one; start over rather than page through nonsense
      if (s2 !== sort || v2 !== v || !/^\d{1,19}$/.test(String(id))) return null
      if (v === 1) return Number.isFinite(key) ? { key: Number(key), id: String(id) } : null
      if (typeof key === 'number' ? !Number.isFinite(key) : !(typeof key === 'string' && key.length <= 40 && /^[0-9T:.+\- LZ]+$/.test(key))) return null
      return { key, id: String(id) }
    } catch { return null }
  }

  /** A whole number in range, or null for "no limit given". */
  const money = (v) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_ASK) : null
  }

  /**
   * The cards this account already has, and at what level.
   *
   * For 「只看非重复」: a listing of a card you hold at the same level or higher
   * is a duplicate whatever else it is, but one ABOVE your level is an upgrade
   * and belongs on the shelf. That distinction needs the level, so the two
   * arrays travel to the query together and are matched there.
   */
  async function heldBy(h) {
    const r = await sql`select state->'cards' as cards from card_accounts where id_hash = ${h}`
    const cards = r[0]?.cards
    const ids = []
    const levels = []
    if (cards && typeof cards === 'object') {
      for (const [id, own] of Object.entries(cards)) {
        ids.push(id)
        levels.push(Math.max(0, Math.round(Number(own?.level ?? 0)) || 0))
      }
    }
    return { ids, levels }
  }

  /**
   * One page of the shelf off the listing summaries: no aggregate, and each
   * order walks an index that ends in `id`, from exactly where the cursor
   * stopped. Four statements because four different ORDER BYs cannot share an
   * index through a CASE — which is what the single query did, and why it
   * sorted the whole market to return sixty rows.
   *
   *   ends        (ends, id)           listing_shelf_ends_idx   — then the few listings with no end, by id
   *   new         (created desc, id)   listing_shelf_new_idx
   *   price       (cur_price, id)      listing_shelf_price_idx
   *   price_desc  the same index, backwards: ties run id-descending, which no reader can tell
   *
   * `sortkey` is what the cursor carries: the timestamp as TEXT for the two
   * time orders (microseconds survive; a float of the epoch does not quite).
   */
  async function shelfFast({ sort, limit, cursor, mine, ids, priceMin, priceMax, heldIds, heldLevels }) {
    const cid = cursor ? cursor.id : '0'
    if (sort === 'new') {
      const key = cursor ? String(cursor.key) : null
      return sql`
        select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created, l.ends, l.buyout, l.hours,
               coalesce(l.open_n, 0) as offers, coalesce(l.bid_n, 0) as bids, l.top_bid as best,
               (l.top_buyer_h = ${mine}) is true as bid, l.created::text as sortkey
        from card_listings l
        where l.status = 'open' and (l.ends is null or l.ends > now()) and l.seller_h <> ${mine}
          and (${ids}::text[] is null or l.card_id = any(${ids}::text[]))
          and (${priceMin}::int is null or l.cur_price >= ${priceMin}::int)
          and (${priceMax}::int is null or l.cur_price <= ${priceMax}::int)
          and (${heldIds}::text[] is null or not exists (
                select 1 from unnest(${heldIds}::text[], ${heldLevels}::int[]) as h(cid, lvl)
                where h.cid = l.card_id and l.level <= h.lvl))
          and (${key}::timestamptz is null or l.created < ${key}::timestamptz
               or (l.created = ${key}::timestamptz and l.id > ${cid}::bigint))
        order by l.created desc, l.id asc
        limit ${limit}`
    }
    if (sort === 'price' || sort === 'price_desc') {
      const key = cursor ? Number(cursor.key) : null
      const up = sort === 'price'
      return up ? sql`
        select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created, l.ends, l.buyout, l.hours,
               coalesce(l.open_n, 0) as offers, coalesce(l.bid_n, 0) as bids, l.top_bid as best,
               (l.top_buyer_h = ${mine}) is true as bid, l.cur_price as sortkey
        from card_listings l
        where l.status = 'open' and (l.ends is null or l.ends > now()) and l.seller_h <> ${mine}
          and (${ids}::text[] is null or l.card_id = any(${ids}::text[]))
          and (${priceMin}::int is null or l.cur_price >= ${priceMin}::int)
          and (${priceMax}::int is null or l.cur_price <= ${priceMax}::int)
          and (${heldIds}::text[] is null or not exists (
                select 1 from unnest(${heldIds}::text[], ${heldLevels}::int[]) as h(cid, lvl)
                where h.cid = l.card_id and l.level <= h.lvl))
          and (${key}::int is null or (l.cur_price, l.id) > (${key}::int, ${cid}::bigint))
        order by l.cur_price asc, l.id asc
        limit ${limit}` : sql`
        select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created, l.ends, l.buyout, l.hours,
               coalesce(l.open_n, 0) as offers, coalesce(l.bid_n, 0) as bids, l.top_bid as best,
               (l.top_buyer_h = ${mine}) is true as bid, l.cur_price as sortkey
        from card_listings l
        where l.status = 'open' and (l.ends is null or l.ends > now()) and l.seller_h <> ${mine}
          and (${ids}::text[] is null or l.card_id = any(${ids}::text[]))
          and (${priceMin}::int is null or l.cur_price >= ${priceMin}::int)
          and (${priceMax}::int is null or l.cur_price <= ${priceMax}::int)
          and (${heldIds}::text[] is null or not exists (
                select 1 from unnest(${heldIds}::text[], ${heldLevels}::int[]) as h(cid, lvl)
                where h.cid = l.card_id and l.level <= h.lvl))
          and (${key}::int is null or (l.cur_price, l.id) < (${key}::int, ${cid}::bigint))
        order by l.cur_price desc, l.id desc
        limit ${limit}`
    }
    // 'ends': the auctions by their clock, then — only once those run out — the listings that have none
    const inTail = cursor && cursor.key === 'L'
    const key = cursor && !inTail ? String(cursor.key) : null
    const head = inTail ? [] : await sql`
      select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created, l.ends, l.buyout, l.hours,
             coalesce(l.open_n, 0) as offers, coalesce(l.bid_n, 0) as bids, l.top_bid as best,
             (l.top_buyer_h = ${mine}) is true as bid, l.ends::text as sortkey
      from card_listings l
      where l.status = 'open' and l.ends > now() and l.seller_h <> ${mine}
        and (${ids}::text[] is null or l.card_id = any(${ids}::text[]))
        and (${priceMin}::int is null or l.cur_price >= ${priceMin}::int)
        and (${priceMax}::int is null or l.cur_price <= ${priceMax}::int)
        and (${heldIds}::text[] is null or not exists (
              select 1 from unnest(${heldIds}::text[], ${heldLevels}::int[]) as h(cid, lvl)
              where h.cid = l.card_id and l.level <= h.lvl))
        and (${key}::timestamptz is null or (l.ends, l.id) > (${key}::timestamptz, ${cid}::bigint))
      order by l.ends asc, l.id asc
      limit ${limit}`
    if (head.length >= limit) return head
    const tail = await sql`
      select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created, l.ends, l.buyout, l.hours,
             coalesce(l.open_n, 0) as offers, coalesce(l.bid_n, 0) as bids, l.top_bid as best,
             exists (select 1 from card_offers f where f.listing = l.id and f.status = 'open' and f.buyer_h = ${mine}) as bid,
             'L'::text as sortkey
      from card_listings l
      where l.status = 'open' and l.ends is null and l.seller_h <> ${mine}
        and (${ids}::text[] is null or l.card_id = any(${ids}::text[]))
        and (${priceMin}::int is null or l.cur_price >= ${priceMin}::int)
        and (${priceMax}::int is null or l.cur_price <= ${priceMax}::int)
        and (${heldIds}::text[] is null or not exists (
              select 1 from unnest(${heldIds}::text[], ${heldLevels}::int[]) as h(cid, lvl)
              where h.cid = l.card_id and l.level <= h.lvl))
        and l.id > ${inTail ? cid : '0'}::bigint
      order by l.id asc
      limit ${limit - head.length}`
    return [...head, ...tail]
  }

  /**
   * What the filter menus are built from, and the count of the whole market —
   * first page only.
   *
   * The menus have to cascade over the WHOLE market — 「选了 CN 赛区队伍还是
   * 全部」 is the complaint they exist to answer, and a menu built from one
   * page of sixty answers it wrong. It respects the price range and 「只看
   * 非重复」 and not the four card filters, because those are the ones it is
   * feeding: a club menu narrowed by the club you picked has one entry.
   *
   * Everybody who opens the market with the same price range is asking the
   * same question, so the answer is kept ten seconds and asked once however
   * many are waiting for it. What is kept is PUBLIC — every open listing,
   * nobody left out — and only the asker's own listings (at most three, read
   * off an index) are taken out of his copy. 「只看非重复」 depends on one
   * account's collection and is never cached.
   */
  const menuCache = new Map()
  const MENU_TTL = 10_000
  async function shelfMenus({ mine, priceMin, priceMax, heldIds, heldLevels, fast }) {
    if (heldIds) {
      const pool = fast ? await sql`
        select l.card_id, count(*)::int as n from card_listings l
        where l.status = 'open' and (l.ends is null or l.ends > now()) and l.seller_h <> ${mine}
          and (${priceMin}::int is null or l.cur_price >= ${priceMin}::int)
          and (${priceMax}::int is null or l.cur_price <= ${priceMax}::int)
          and not exists (select 1 from unnest(${heldIds}::text[], ${heldLevels}::int[]) as h(cid, lvl)
                           where h.cid = l.card_id and l.level <= h.lvl)
        group by l.card_id` : await poolSlow(mine, priceMin, priceMax, heldIds, heldLevels)
      const total = (await sql`select count(*)::int as n from card_listings where status = 'open' and (ends is null or ends > now())`)[0].n
      return { pool: pool.map((r) => [r.card_id, r.n]), total }
    }
    const key = `${fast ? 'f' : 's'}|${priceMin ?? ''}|${priceMax ?? ''}`
    let hit = menuCache.get(key)
    if (!hit || (Date.now() - hit.at > MENU_TTL && !hit.inflight)) {
      const entry = hit ?? { at: 0, value: null, inflight: null }
      entry.inflight = (async () => {
        try {
          const pool = fast ? await sql`
            select l.card_id, count(*)::int as n from card_listings l
            where l.status = 'open' and (l.ends is null or l.ends > now())
              and (${priceMin}::int is null or l.cur_price >= ${priceMin}::int)
              and (${priceMax}::int is null or l.cur_price <= ${priceMax}::int)
            group by l.card_id` : await poolSlow('', priceMin, priceMax, null, null)
          const total = (await sql`select count(*)::int as n from card_listings where status = 'open' and (ends is null or ends > now())`)[0].n
          entry.value = { pool: new Map(pool.map((r) => [r.card_id, r.n])), total }
          entry.at = Date.now()
        } finally {
          entry.inflight = null
        }
        return entry.value
      })()
      if (menuCache.size > 60) menuCache.clear()
      menuCache.set(key, entry)
      hit = entry
    }
    const value = hit.value && Date.now() - hit.at <= MENU_TTL ? hit.value : await hit.inflight
    const pool = new Map(value.pool)
    if (mine) {
      // the public answer counts everybody's listings; the asker's own come out of HIS copy
      const own = await sql`
        select card_id, count(*)::int as n from card_listings
        where status = 'open' and (ends is null or ends > now()) and seller_h = ${mine}
          and (${priceMin}::int is null or coalesce(cur_price, ask) >= ${priceMin}::int)
          and (${priceMax}::int is null or coalesce(cur_price, ask) <= ${priceMax}::int)
        group by card_id`
      for (const r of own) {
        const left = (pool.get(r.card_id) ?? 0) - r.n
        if (left > 0) pool.set(r.card_id, left); else pool.delete(r.card_id)
      }
    }
    return { pool: [...pool], total: value.total }
  }
  const poolSlow = (mine, priceMin, priceMax, heldIds, heldLevels) => sql`
    select l.card_id, count(*)::int as n
    from card_listings l
    left join lateral (
      select (max(f.price) filter (where f.status = 'open'))::int as best
      from card_offers f where f.listing = l.id
    ) o on true
    where l.status = 'open'
      and (l.ends is null or l.ends > now())
      and l.seller_h <> ${mine}
      and (${priceMin}::int is null or coalesce(o.best, l.ask) >= ${priceMin}::int)
      and (${priceMax}::int is null or coalesce(o.best, l.ask) <= ${priceMax}::int)
      and (${heldIds}::text[] is null or not exists (
            select 1 from unnest(${heldIds}::text[], ${heldLevels}::int[]) as h(cid, lvl)
            where h.cid = l.card_id and l.level <= h.lvl))
    group by l.card_id`

  /**
   * The shelf: one page of other people's listings, plus all of your own.
   *
   * Every filter is applied HERE rather than on the page after it arrives.
   * Filtering a page is filtering whatever that page happened to hold — pick
   * 金卡 and you get the gold cards among sixty, not the gold cards on the
   * market — which is the same mistake as the fixed window it replaced.
   *
   * Metal, region, position, club and the search box are card facts, and the
   * database has no card table: they are turned into the set of card ids that
   * match, by the same predicate the filter bar runs (engine/cardFilter.ts),
   * and the query filters on that. Six hundred cards is a small enough table
   * to walk on every request and a small enough set to hand to Postgres.
   */
  async function browse(req, res, bucket) {
    if (guard(req, res, `mb:${bucket}`, 90)) return
    let mine = ''
    let b = null
    try {
      b = JSON.parse(await readBody(req, 4096))
      const id = normalizeId(b?.id)
      if (id) mine = hash(id)
    } catch { /* browsing without an account is fine */ }

    const sort = SORTS.includes(b?.sort) ? b.sort : 'ends'
    const limit = Math.max(1, Math.min(PAGE_MAX, Math.round(Number(b?.limit)) || PAGE))
    // which shelf query: the indexed one over the listing summaries once they
    // are backfilled and verified (summaryLive), the old aggregate until then
    const fast = summaryLive && useSummary
    const cursor = readCursor(sort, b?.cursor, fast ? 2 : 1)
    // Reading the shelf settles nothing (see settleDue): an auction whose time
    // is up is left out of the read and closed by the settler within seconds.
    const q = typeof b?.q === 'string' ? b.q.slice(0, 60) : ''
    const filter = engine.readFilter(b)
    const priceMin = money(b?.priceMin)
    const priceMax = money(b?.priceMax)
    // the toggle only means anything to somebody with a collection to compare against
    const unowned = !!b?.unowned && !!mine

    // The card ids that pass metal / region / position / club / search — null
    // when none of them is set, which is the common case and skips the filter
    // in the query entirely.
    const narrowed = engine.filterActive(filter) || q.trim() !== ''
    const ids = narrowed
      ? engine.ALL_CARDS.filter((c) => engine.matchesFilter(c, filter) && engine.matchesQuery(c, q)).map((c) => c.id)
      : null
    const held = unowned ? await heldBy(mine) : null
    const heldIds = held ? held.ids : null
    const heldLevels = held ? held.levels : null

    const rows = fast
      ? await shelfFast({ sort, limit, cursor, mine, ids, priceMin, priceMax, heldIds, heldLevels })
      : await sql`
      select * from (
        select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created, l.ends, l.buyout, l.hours,
               coalesce(o.open_n, 0) as offers,
               coalesce(o.all_n, 0) as bids,
               o.best,
               coalesce(o.mine_bid, false) as bid,
               -- one comparable number for whichever order was asked for, so
               -- a single query and a single cursor serve all four. An auction
               -- with no end (a listing from before them) sorts last.
               case ${sort}::text
                 when 'ends' then coalesce(extract(epoch from l.ends)::float8, 1e15)
                 when 'new' then (-extract(epoch from l.created))::float8
                 when 'price' then coalesce(o.best, l.ask)::float8
                 else (-coalesce(o.best, l.ask))::float8
               end as sortkey
        from card_listings l
        left join lateral (
          select (count(*) filter (where f.status = 'open'))::int as open_n,
                 (count(*) filter (where f.status in ('open', 'outbid', 'accepted')))::int as all_n,
                 (max(f.price) filter (where f.status = 'open'))::int as best,
                 bool_or(f.status = 'open' and f.buyer_h = ${mine}) as mine_bid
          from card_offers f where f.listing = l.id
        ) o on true
        where l.status = 'open'
          and (l.ends is null or l.ends > now())
          and l.seller_h <> ${mine}
          and (${ids}::text[] is null or l.card_id = any(${ids}::text[]))
          and (${priceMin}::int is null or coalesce(o.best, l.ask) >= ${priceMin}::int)
          and (${priceMax}::int is null or coalesce(o.best, l.ask) <= ${priceMax}::int)
          and (${heldIds}::text[] is null or not exists (
                select 1 from unnest(${heldIds}::text[], ${heldLevels}::int[]) as h(cid, lvl)
                where h.cid = l.card_id and l.level <= h.lvl))
      ) t
      where ${cursor ? cursor.key : null}::float8 is null
         or (t.sortkey, t.id) > (${cursor ? cursor.key : null}::float8, ${cursor ? cursor.id : '0'}::bigint)
      order by t.sortkey asc, t.id asc
      limit ${limit}`

    // Your own listings are not in that window and never were: all of them
    // come back, on the first page, outside the paging and outside the filter.
    // The shelf used to be one window of the newest 400 and 「我挂的牌」 was
    // read off it, so an older listing vanished from its owner's page as well
    // as every buyer's, with the card still in escrow.
    const own = mine && !cursor ? await sql`
      select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created, l.ends, l.buyout, l.hours,
             (select count(*)::int from card_offers o
               where o.listing = l.id and o.status = 'open') as offers,
             (select count(*)::int from card_offers o
               where o.listing = l.id and o.status in ('open', 'outbid', 'accepted')) as bids,
             (select max(o.price)::int from card_offers o
               where o.listing = l.id and o.status = 'open') as best,
             false as bid
      from card_listings l
      where l.status = 'open' and l.seller_h = ${mine}
      order by l.ends asc nulls last, l.created desc` : []

    /**
     * What the filter menus are built from, on the first page only: every
     * card with something of it on the market, and how many.
     *
     * The menus have to cascade over the WHOLE market — 「选了 CN 赛区队伍还是
     * 全部」 is the complaint they exist to answer, and a menu built from one
     * page of sixty answers it wrong. It respects the price range and 「只看
     * 非重复」 and not the four card filters, because those are the ones it is
     * feeding: a club menu narrowed by the club you picked has one entry.
     */
    const menus = cursor ? null : await shelfMenus({ mine, priceMin, priceMax, heldIds, heldLevels, fast })
    const pool = menus?.pool ?? null
    const total = menus?.total ?? null
    const names = await namesOf([...own, ...rows].map((r) => r.seller_h))
    const shape = (r) => ({
      id: String(r.id), cardId: r.card_id, level: r.level, ask: r.ask,
      seller: names[r.seller_h], mine: r.seller_h === mine,
      offers: r.offers, best: r.best ?? null, bid: r.bid,
      // the auction: when it closes, the buy-now price, how many have bid,
      // and the least the next bid may be. `ends` null is an old listing.
      ends: endsAt(r), buyout: r.buyout ?? null, bids: r.bids ?? r.offers, hours: r.hours ?? AUCTION_HOURS,
      min: r.ends ? minBid(r.ask, r.best ?? null) : r.ask,
      // 上架保护期: until when a buy-now only enters the draw (null once the minute is over, or with no buy-now)
      drawAt: protectEnd(r),
    })
    json(res, 200, {
      ...shelfConstants(),
      ok: true,
      now: Date.now(),
      sort,
      gate: mine ? await tooNew(mine) : { need: TRADE_PULLS, have: 0, days: TRADE_DAYS, wait: TRADE_DAYS * 86_400 },
      ban: mine ? await guard2.banOf(mine) ?? undefined : undefined,
      // a short page is the end of the shelf; a full one may or may not be, and
      // the cursor costs nothing to hand out and try
      next: rows.length === limit ? cursorOf(sort, rows[rows.length - 1], fast ? 2 : 1) : null,
      ...(cursor ? {} : { total, pool }),
      own: own.map(shape),
      listings: rows.map(shape),
    })
  }

  /**
   * The listings somebody is looking at, as they stand now.
   *
   * A shelf scrolled several pages down is not re-read from the top every
   * two minutes — that would throw the reader back to the first page — so it
   * went stale instead: prices and 「你领先」 from when the page was fetched.
   * This refreshes exactly the tiles on screen, by id, in one indexed read. A
   * listing that is not in the answer is no longer open.
   */
  async function peek(req, res, bucket) {
    if (guard(req, res, `mp:${bucket}`, 90)) return
    let b = null
    let mine = ''
    try {
      b = JSON.parse(await readBody(req, 8192))
      const id = normalizeId(b?.id)
      if (id) mine = hash(id)
    } catch { json(res, 400, { ok: false }); return }
    const ids = (Array.isArray(b?.ids) ? b.ids : []).map(rowId).filter(Boolean).slice(0, PAGE_MAX)
    if (!ids.length) { json(res, 200, { ok: true, now: Date.now(), listings: [] }); return }
    json(res, 200, { ok: true, now: Date.now(), ...await liveListings(ids, mine) })
  }

  async function liveListings(ids, mine) {
    const rows = await sql`
      select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created, l.ends, l.buyout, l.hours,
             coalesce(o.open_n, 0) as offers, coalesce(o.all_n, 0) as bids, o.best, coalesce(o.mine_bid, false) as bid
      from card_listings l
      left join lateral (
        select (count(*) filter (where f.status = 'open'))::int as open_n,
               (count(*) filter (where f.status in ('open', 'outbid', 'accepted')))::int as all_n,
               (max(f.price) filter (where f.status = 'open'))::int as best,
               bool_or(f.status = 'open' and f.buyer_h = ${mine}) as mine_bid
        from card_offers f where f.listing = l.id
      ) o on true
      where l.id = any(${ids}::bigint[]) and l.status = 'open' and (l.ends is null or l.ends > now())`
    const names = await namesOf(rows.map((r) => r.seller_h))
    return {
      listings: rows.map((r) => ({
        id: String(r.id), cardId: r.card_id, level: r.level, ask: r.ask,
        seller: names[r.seller_h], mine: r.seller_h === mine,
        offers: r.offers, best: r.best ?? null, bid: r.bid,
        ends: endsAt(r), buyout: r.buyout ?? null, bids: r.bids ?? r.offers, hours: r.hours ?? AUCTION_HOURS,
        min: r.ends ? minBid(r.ask, r.best ?? null) : r.ask,
        // 上架保护期: until when a buy-now only enters the draw (null once the minute is over, or with no buy-now)
        drawAt: protectEnd(r),
      })),
    }
  }

  /** Active auctions I bid on, including refunded/outbid bids. One tile per listing. */
  async function participating(req, res, bucket) {
    if (guard(req, res, `mpart:${bucket}`, 90)) return
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, unverified: true }); return }
    const cursor = b?.cursor == null ? null : rowId(b.cursor)
    if (b?.cursor != null && !cursor) { json(res, 400, { ok: false, bad: true }); return }
    const rows = await sql`
      select l.id from card_listings l
      where l.status = 'open' and l.ends > now() and l.seller_h <> ${me}
        and (${cursor}::bigint is null or l.id < ${cursor}::bigint)
        and exists (select 1 from card_offers o where o.listing = l.id and o.buyer_h = ${me})
      order by l.id desc limit ${PAGE + 1}`
    const page = rows.slice(0, PAGE)
    const data = page.length ? await liveListings(page.map(r => String(r.id)), me) : { listings: [] }
    const byId = new Map(data.listings.map(l => [l.id, l]))
    json(res, 200, { ok: true, now: Date.now(),
      listings: page.flatMap(r => byId.has(String(r.id)) ? [byId.get(String(r.id))] : []),
      next: rows.length > PAGE ? String(page[page.length - 1].id) : null })
  }

  /** Everything about the market that does not change between requests. */
  const shelfConstants = () => ({
    haggle: HAGGLE,
    hours: AUCTION_HOURS, hoursMin: AUCTION_MIN_HOURS, hoursMax: AUCTION_MAX_HOURS, hoursChoices: AUCTION_HOURS_CHOICES,
    step: BID_STEP, snipe: SNIPE_MINUTES, buyoutMin: BUYOUT_MIN, protectSec: PROTECT_SEC,
    page: PAGE,
  })

  /** Put a card up. The card leaves your side now and comes back if it does not sell. */
  async function list(req, res, bucket) {
    if (guard(req, res, `ml:${bucket}`, 30)) return
    let b
    try { b = JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const requestId = requestIdOf(b?.requestId)
    if (b?.requestId != null && !requestId) { json(res, 400, { ok: false, why: '请求号格式无效。' }); return }
    if (requestId && !(await requestsReady())) { json(res, 503, { ok: false, offline: true, why: '服务正在准备，请稍后重试。' }); return }
    const { id: _id, requestId: _requestId, ...intent } = b
    const requestKey = requestAction('market:list', intent)
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const done = await finished(me, requestId, requestKey)
    if (done) { json(res, 200, done); return }
    const cardId = String(b?.cardId ?? '').slice(0, 40)
    const ask = Math.round(Number(b?.ask))
    // The card table is the server's now, so neither the metal nor the level
    // is read off the request: the floor comes from what the card is, and the
    // level from what the account actually holds.
    const card = engine.cardById(cardId)
    if (!card) { json(res, 200, { ok: false, notOwned: true }); return }
    const floor = askFloor(card.rarity)
    if (!cardId || !Number.isFinite(ask) || ask < floor || ask > MAX_ASK) {
      json(res, 200, { ok: false, bad: true, min: floor, max: MAX_ASK })
      return
    }
    // a buy-now price is optional; set, it must be a real step above the start
    const rawBuyout = b?.buyout == null || b?.buyout === '' ? null : Math.round(Number(b.buyout))
    const buyoutFloor = Math.ceil(ask * BUYOUT_MIN)
    if (rawBuyout != null && (!Number.isFinite(rawBuyout) || rawBuyout < buyoutFloor || rawBuyout > MAX_ASK)) {
      json(res, 200, { ok: false, badBuyout: true, min: buyoutFloor, max: MAX_ASK })
      return
    }
    const buyout = rawBuyout
    // how long it runs: the seller's choice, whole hours, within the range;
    // a client from before the choice existed sends nothing and gets a day
    const hours = b?.hours == null || b?.hours === '' ? AUCTION_HOURS : Math.round(Number(b.hours))
    if (!Number.isFinite(hours) || hours < AUCTION_MIN_HOURS || hours > AUCTION_MAX_HOURS) {
      json(res, 200, { ok: false, badHours: true, min: AUCTION_MIN_HOURS, max: AUCTION_MAX_HOURS })
      return
    }
    const barred = await guard2.banOf(me)
    if (barred) { json(res, 200, { ok: false, banned: true, ...barred }); return }
    const young = await tooNew(me)
    if (young) { json(res, 200, { ok: false, newbie: true, ...young }); return }
    const openN = async () => (await sql`
      select count(*)::int as n from card_listings where seller_h = ${me} and status = 'open'`)[0]?.n ?? 0
    // Full — but perhaps only with auctions that have ended and that the
    // settler has not reached yet. Those are this seller's to close now; the
    // rest of the market's backlog is not this request's business.
    if ((await openN()) >= MAX_LISTINGS) {
      await settleBatch(MAX_LISTINGS, me, null, tx)
      if ((await openN()) >= MAX_LISTINGS) { json(res, 200, { ok: false, full: true, max: MAX_LISTINGS }); return }
    }
    // read against the save the server holds, not against what the client says
    const mine = await sql`select state->'cards' as cards from card_accounts where id_hash = ${me}`
    const owned = mine[0]?.cards?.[cardId]
    if (!owned) { json(res, 200, { ok: false, notOwned: true }); return }
    // Open listings already hold their cards in escrow. Counting them
    // against the remaining inventory again refused the third of three
    // owned copies; escrowCard below is the authoritative inventory check.
    // The card leaves the collection HERE, on the server's copy — a duplicate
    // first, at level 0, then the lowest upgraded spare; the card itself
    // otherwise, at the level it holds. The request's `level` is not read: a
    // client sends the card's own level there, and honouring it would send the
    // card out ahead of a duplicate. It used to leave on the client's copy
    // after this reply, which meant a client that skipped that step listed a
    // card it still held.
    const out = await once(me, requestId, requestKey, async (db) => {
      // Serialize new listings for this seller before reading the limit.
      // This only locks the account, never another listing, so a bidder
      // holding listing -> account cannot form the opposite lock order here.
      await db`select id_hash from card_accounts where id_hash = ${me} for update`
      const count = await db`select count(*)::int as n from card_listings where seller_h = ${me} and status = 'open'`
      if ((count[0]?.n ?? 0) >= MAX_LISTINGS) return { full: true }
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await db`select state, rev from card_accounts where id_hash = ${me}`
        if (!row.length) return { notOwned: true }
        const g = engine.migrateGacha(row[0].state, id)
        const esc = engine.escrowCard(g, cardId)
        if (!esc.ok) return { notOwned: true }
        const w = await db`
          update card_accounts set state = ${db.json(stored(g))}, rev = rev + 1, saved = now()
          where id_hash = ${me} and rev = ${row[0].rev} returning rev`
        if (!w.length) continue
        const r = await db`
          insert into card_listings (seller_h, card_id, level, ask, buyout, hours, ends, cur_price, open_n, bid_n)
          values (${me}, ${cardId}, ${esc.level}, ${ask}, ${buyout}, ${hours},
                  now() + make_interval(hours => ${hours}), ${ask}, 0, 0)
          returning id, ends`
        return { ok: true, id: String(r[0].id), ends: endsAt(r[0]), hours, state: stored(g), rev: w[0].rev }
      }
      return { busy: true }
    })
    if (out.clash) { json(res, 200, { ok: false, clash: true }); return }
    if (out.full) { json(res, 200, { ok: false, full: true, max: MAX_LISTINGS }); return }
    if (out.notOwned) { json(res, 200, { ok: false, notOwned: true }); return }
    if (out.busy) { json(res, 409, { ok: false, busy: true }); return }
    if (out.ok) menuCache.clear()
    json(res, 200, out)
  }

  /** Take it back off the shelf. The card comes home through the inbox. */
  async function unlist(req, res, bucket) {
    if (guard(req, res, `mu:${bucket}`, 30)) return
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const lid = rowId(b?.listing)
    if (!lid) { json(res, 400, { ok: false, bad: true }); return }
    const out = await tx(async (db) => {
      // a bid is binding on the seller too: once somebody has put coins on
      // an auction, the card is theirs to win and cannot be taken back
      const bound = await db`
        select count(*)::int as n from card_offers o join card_listings l on l.id = o.listing
        where l.id = ${lid}::bigint and l.seller_h = ${me} and l.status = 'open'
          and l.ends is not null and o.status = 'open'`
      if ((bound[0]?.n ?? 0) > 0) return { bound: true }
      const rows = await db`
        update card_listings set status = 'pulled', closed = now()
        where id = ${lid}::bigint and seller_h = ${me} and status = 'open'
        returning id, card_id, level`
      if (!rows.length) return { gone: true }
      const l = rows[0]
      await post(me, 'listing_pulled', { cardId: l.card_id, level: l.level }, db)
      const back = await db`
        update card_offers set status = 'expired', settled = now()
        where listing = ${l.id} and status = 'open' returning buyer_h, price`
      for (const o of back) await post(o.buyer_h, 'offer_expired', { coins: o.price }, db)
      return { ok: true, refunded: back.length }
    })
    if (out.bound) { json(res, 200, { ok: false, bound: true }); return }
    if (out.ok) menuCache.clear()
    json(res, 200, out.gone ? { ok: false, gone: true } : out)
  }

  /**
   * Bid. The coins leave your side now and come back if it does not go through.
   *
   * On an auction a bid has to clear the last one by a step, beats it on the
   * spot — the coins of the bidder it beats go home in the same transaction —
   * and if it lands in the last minutes it buys everyone a few more. A bid at
   * the buy-now price is a sale. An old-style listing keeps its ±10% offer.
   */
  async function offer(req, res, bucket) {
    if (guard(req, res, `mo:${bucket}`, 40)) return
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const requestId = requestIdOf(b?.requestId)
    if (b?.requestId != null && !requestId) { json(res, 400, { ok: false, why: '请求号格式无效。' }); return }
    if (requestId && !(await requestsReady())) { json(res, 503, { ok: false, offline: true, why: '服务正在准备，请稍后重试。' }); return }
    const { id: _id, requestId: _requestId, ...intent } = b
    const requestKey = requestAction('market:offer', intent)
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const done = await finished(me, requestId, requestKey)
    if (done) { json(res, 200, done); return }
    const price = Math.round(Number(b?.price))
    const lid = rowId(b?.listing)
    if (!lid) { json(res, 400, { ok: false, bad: true }); return }
    const rows = await sql`
      select id, seller_h, card_id, level, ask, ends, buyout, created from card_listings
      where id = ${lid}::bigint and status = 'open'`
    if (!rows.length) { json(res, 200, { ok: false, gone: true }); return }
    const l = rows[0]
    if (l.seller_h === me) { json(res, 200, { ok: false, self: true }); return }
    const auction = !!l.ends
    if (auction && endsAt(l) <= Date.now()) { json(res, 200, { ok: false, gone: true }); return }
    const topRow = await sql`
      select id, buyer_h, price from card_offers
      where listing = ${l.id} and status = 'open'
      order by price desc, made asc, id asc limit 1`
    const top = topRow[0] ?? null
    let bid = price
    if (auction) {
      if (top && top.buyer_h === me) { json(res, 200, { ok: false, leading: true, price: top.price, entered: (l.buyout != null && top.price >= l.buyout) || undefined }); return }
      // with a draw entry standing at the buy-now price, the only way in is the buy-now price
      const min = l.buyout != null ? Math.min(l.buyout, minBid(l.ask, top?.price ?? null)) : minBid(l.ask, top?.price ?? null)
      if (!Number.isFinite(bid) || bid < min) { json(res, 200, { ok: false, low: true, min }); return }
      // at or over the buy-now price is the buy-now price: nobody pays more
      // than the seller asked to end it
      if (l.buyout != null && bid >= l.buyout) bid = l.buyout
      else if (bid > MAX_ASK) { json(res, 200, { ok: false, low: true, min, max: MAX_ASK }); return }
    } else {
      const lo = Math.ceil(l.ask * (1 - HAGGLE))
      const hi = Math.floor(l.ask * (1 + HAGGLE))
      if (!Number.isFinite(bid) || bid < lo || bid > hi) {
        json(res, 200, { ok: false, range: true, lo, hi })
        return
      }
      const dup = await sql`
        select count(*)::int as n from card_offers
        where listing = ${l.id} and buyer_h = ${me} and status = 'open'`
      if ((dup[0]?.n ?? 0) > 0) { json(res, 200, { ok: false, already: true }); return }
    }
    const barred = await guard2.banOf(me)
    if (barred) { json(res, 200, { ok: false, banned: true, ...barred }); return }
    const young = await tooNew(me)
    if (young) { json(res, 200, { ok: false, newbie: true, ...young }); return }
    // the coins leave the server's copy of the account, here, before the
    // offer exists — a bid is never made with money the account does not hold
    const who = await nameOf(me)
    // the winner of a draw this request set off, if it did (kept out of the stored reply: it is somebody else's hash)
    let drew = null
    const out = await once(me, requestId, requestKey, async (db) => {
      // Bids on one listing take turns: the row lock holds a second bid
      // until the first has committed, and the second then reads the top
      // the first just set. Without it two equal first bids both went in
      // and the LATER one stood — first come, first served is the rule.
      const locked = await db`
        select id, status, ends, buyout, draw_at,
               extract(epoch from now() - created)::float8 as age,
               extract(epoch from created + make_interval(secs => ${PROTECT_SEC}))::float8 * 1000 as protect_end
        from card_listings where id = ${l.id} for update`
      if (!locked.length || locked[0].status !== 'open') return { gone: true }
      const buying = auction && l.buyout != null && bid >= l.buyout
      // 上架保护期: in the listing's first minute a buy-now is an entry in a draw
      const entering = buying && Number(locked[0].age) < PROTECT_SEC
      if (buying && !entering && locked[0].draw_at) {
        // The minute is up and the entries are still waiting for the settler:
        // the card is theirs to draw for, not this later buyer's. Draw now.
        drew = await drawOne(db, l)
        return { gone: true }
      }
      if (entering) {
        const mine = await db`
          select 1 from card_offers where listing = ${l.id} and buyer_h = ${me} and status = 'open' and price >= ${l.buyout} limit 1`
        if (mine.length) return { leading: true, price: l.buyout, entered: true }
      }
      if (auction) {
        if (endsAt(locked[0]) <= Date.now()) return { gone: true }
        const cur = await db`
          select buyer_h, price from card_offers
          where listing = ${l.id} and status = 'open'
          order by price desc, made asc, id asc limit 1`
        const curTop = cur[0] ?? null
        if (curTop && curTop.buyer_h === me) return { leading: true, price: curTop.price, entered: l.buyout != null && curTop.price >= l.buyout }
        const floor = minBid(l.ask, curTop?.price ?? null)
        if (bid < floor && !(l.buyout != null && bid >= l.buyout)) return { low: true, min: floor }
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await db`select state, rev from card_accounts where id_hash = ${me}`
        if (!row.length) return { broke: true }
        const g = engine.migrateGacha(row[0].state, id)
        if (g.coins < bid) return { broke: true }
        g.coins -= bid
        const w = await db`
          update card_accounts set state = ${db.json(stored(g))}, rev = rev + 1, saved = now()
          where id_hash = ${me} and rev = ${row[0].rev} returning rev`
        if (!w.length) continue
        const ins = await db`
          insert into card_offers (listing, buyer_h, price) values (${l.id}, ${me}, ${bid}) returning id`
        if (!auction) {
          await post(l.seller_h, 'offer_made', {
            body: { listing: String(l.id), cardId: l.card_id, price: bid, ask: l.ask, who },
          }, db)
          await refreshSummary(db, String(l.id))
          return { ok: true, state: stored(g), rev: w[0].rev }
        }
        // the listing may have been settled or its top bid changed between
        // the read above and now; beat whatever is open and older than us
        const beaten = await db`
          update card_offers set status = 'outbid', settled = now()
          where listing = ${l.id} and status = 'open' and id <> ${ins[0].id}
            -- the other entries in a draw are not beaten by this one: they stand until the draw
            and (${!entering}::boolean or price < ${l.buyout ?? 0})
          returning buyer_h, price`
        for (const o of beaten) {
          await post(o.buyer_h, 'overbid', {
            coins: o.price, body: { listing: String(l.id), cardId: l.card_id, price: o.price, by: bid },
          }, db)
        }
        if (entering) {
          await db`
            update card_listings set draw_at = created + make_interval(secs => ${PROTECT_SEC})
            where id = ${l.id} and draw_at is null`
          await refreshSummary(db, String(l.id))
          return { ok: true, entered: true, price: bid, drawAt: Math.round(Number(locked[0].protect_end)), state: stored(g), rev: w[0].rev }
        }
        if (l.buyout != null && bid >= l.buyout) {
          const sold = await settle(db, l, { id: ins[0].id, buyer_h: me, price: bid })
          return sold ? { ok: true, bought: true, price: bid, state: stored(g), rev: w[0].rev } : { gone: true }
        }
        // a bid in the last minutes gives everyone a few more — up to an hour
        // past the day in all, so two people cannot keep a card on the shelf
        // by trading bids every nine minutes
        const stretched = await db`
          update card_listings set ends = least(
              now() + make_interval(mins => ${SNIPE_MINUTES}),
              created + make_interval(hours => card_listings.hours, mins => ${SNIPE_CAP_MINUTES}))
          where id = ${l.id} and status = 'open'
            and ends < now() + make_interval(mins => ${SNIPE_MINUTES})
            and ends < created + make_interval(hours => card_listings.hours, mins => ${SNIPE_CAP_MINUTES})
          returning ends`
        const ends = stretched.length ? endsAt(stretched[0]) : endsAt(l)
        // the shelf's numbers move with the bid, in the bid's transaction
        await refreshSummary(db, String(l.id))
        // the seller hears about the first bid; the rest is on the shelf
        if (!top) {
          await post(l.seller_h, 'offer_made', {
            body: { listing: String(l.id), cardId: l.card_id, price: bid, ask: l.ask, who },
          }, db)
        }
        return { ok: true, price: bid, ends, state: stored(g), rev: w[0].rev }
      }
      return { busy: true }
    })
    if (out.clash) { json(res, 200, { ok: false, clash: true }); return }
    if (out.broke) { json(res, 200, { ok: false, broke: true }); return }
    if (out.busy) { json(res, 409, { ok: false, busy: true }); return }
    if (out.gone) { json(res, 200, { ok: false, gone: true }); return }
    if (out.low) { json(res, 200, { ok: false, low: true, min: out.min }); return }
    if (out.leading) { json(res, 200, { ok: false, leading: true, price: out.price, entered: out.entered || undefined }); return }
    if (out.ok) menuCache.clear()
    // a card bought outright is the one thing a script does differently from a person: look, after replying
    if (out.ok && (out.bought || out.entered)) guard2.checkSoon(me)
    if (drew) guard2.checkSoon(drew)
    json(res, 200, out)
  }

  /**
   * Take a bid back.
   *
   * The clock returns an unanswered offer after three days, but three days is
   * a long time to have coins locked on a seller who has simply stopped
   * playing — 「如果卖家一直不同意报价钱就卡在那了」. A bid still open is the
   * buyer's to withdraw at any moment. Like every other escrow it goes home
   * through the inbox; and it does not count against the listing, because
   * the seller was not the one who let it lapse.
   */
  async function withdraw(req, res, bucket) {
    if (guard(req, res, `mw:${bucket}`, 30)) return
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const oid = rowId(b?.offer)
    if (!oid) { json(res, 400, { ok: false, bad: true }); return }
    const out = await tx(async (db) => {
      // a bid on an auction is binding: it is the price the card sells for
      // unless somebody beats it, and beating it is the only way out
      const bound = await db`
        select l.ends from card_offers o join card_listings l on l.id = o.listing
        where o.id = ${oid}::bigint and o.buyer_h = ${me} and o.status = 'open'`
      if (bound.length && bound[0].ends) return { binding: true }
      const rows = await db`
        update card_offers set status = 'withdrawn', settled = now()
        where id = ${oid}::bigint and buyer_h = ${me} and status = 'open'
        returning id, listing, price`
      if (!rows.length) return { gone: true }
      const o = rows[0]
      await refreshSummary(db, String(o.listing))
      const l = await db`select card_id from card_listings where id = ${o.listing}`
      await post(me, 'offer_withdrawn', {
        coins: o.price,
        body: { listing: String(o.listing), cardId: l[0]?.card_id ?? null, price: o.price },
      }, db)
      return { ok: true, coins: o.price }
    })
    if (out.binding) { json(res, 200, { ok: false, binding: true }); return }
    json(res, 200, out.gone ? { ok: false, gone: true } : out)
  }

  /** Offers on my listings, and my own bids. */
  async function offers(req, res, bucket) {
    if (guard(req, res, `mq:${bucket}`, 90)) return
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const inbound = await sql`
      select o.id, o.price, o.made, o.buyer_h, l.id as listing, l.card_id, l.ask, l.ignored, l.ends, l.buyout
      from card_offers o join card_listings l on l.id = o.listing
      where l.seller_h = ${me} and o.status = 'open' and l.status = 'open'
      order by o.price desc`
    const outbound = await sql`
      select o.id, o.price, o.made, o.status, l.id as listing, l.card_id, l.ask, l.seller_h, l.status as lstatus, l.ends, l.buyout
      from card_offers o join card_listings l on l.id = o.listing
      where o.buyer_h = ${me} and o.status = 'open'
      order by o.made desc`
    // one query for every name on the page, not one per counterparty
    const names = await namesOf([...inbound.map((r) => r.buyer_h), ...outbound.map((r) => r.seller_h)])
    json(res, 200, {
      ok: true,
      days: OFFER_DAYS,
      inbound: inbound.map((r) => ({
        id: String(r.id), listing: String(r.listing), cardId: r.card_id,
        ask: r.ask, price: r.price, who: names[r.buyer_h],
        madeAt: new Date(r.made).getTime(), ignored: r.ignored,
        ends: endsAt(r), buyout: r.buyout ?? null,
      })),
      outbound: outbound.map((r) => ({
        id: String(r.id), listing: String(r.listing), cardId: r.card_id, ask: r.ask, price: r.price,
        who: names[r.seller_h], madeAt: new Date(r.made).getTime(),
        ends: endsAt(r), buyout: r.buyout ?? null,
      })),
    })
  }

  /**
   * Take an offer, or turn it down.
   *
   * Accepting is the only place a card and coins change hands, and it happens
   * in one statement each: the offer moves to `accepted` only if it is still
   * open, so two tabs cannot sell the same card twice.
   */
  async function answer(req, res, bucket) {
    if (guard(req, res, `ma:${bucket}`, 40)) return
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const take = !!b?.accept
    const oid = rowId(b?.offer)
    if (!oid) { json(res, 400, { ok: false, bad: true }); return }
    const got = await sql`
      select o.id, o.buyer_h, o.price, l.id as listing, l.seller_h, l.card_id, l.level, l.status, l.ends
      from card_offers o join card_listings l on l.id = o.listing
      where o.id = ${oid}::bigint and o.status = 'open'`
    if (!got.length || got[0].seller_h !== me) { json(res, 200, { ok: false, gone: true }); return }
    const o = got[0]
    // an auction settles itself; the seller neither picks nor refuses
    if (o.ends) { json(res, 200, { ok: false, auction: true }); return }
    if (!take) {
      const out = await tx(async (db) => {
        const done = await db`
          update card_offers set status = 'declined', settled = now()
          where id = ${o.id} and status = 'open' returning id`
        if (!done.length) return { gone: true }
        // a refusal is still an answer, so it does not count against the listing
        await post(o.buyer_h, 'offer_declined', {
          coins: o.price, body: { cardId: o.card_id, price: o.price },
        }, db)
        await refreshSummary(db, String(o.listing))
        return { ok: true, declined: true }
      })
      json(res, 200, out.gone ? { ok: false, gone: true } : out)
      return
    }
    if (o.status !== 'open') { json(res, 200, { ok: false, gone: true }); return }
    const [sellerName, buyerName] = [await nameOf(me), await nameOf(o.buyer_h)]
    const out = await tx(async (db) => {
      const won = await db`
        update card_offers set status = 'accepted', settled = now()
        where id = ${o.id} and status = 'open' returning id`
      if (!won.length) return { gone: true }
      const closed = await db`
        update card_listings set status = 'sold', closed = now()
        where id = ${o.listing} and status = 'open' returning id`
      if (!closed.length) {
        // somebody else closed it a moment ago; give the money straight back
        await db`update card_offers set status = 'expired' where id = ${o.id}`
        await post(o.buyer_h, 'offer_expired', { coins: o.price }, db)
        return { gone: true }
      }
      await post(o.buyer_h, 'bought', {
        cardId: o.card_id, level: o.level, body: { price: o.price, who: sellerName },
      }, db)
      await post(me, 'sold', {
        coins: o.price, body: { cardId: o.card_id, price: o.price, who: buyerName },
      }, db)
      // every other bid on that card goes home
      const rest = await db`
        update card_offers set status = 'expired', settled = now()
        where listing = ${o.listing} and status = 'open' returning buyer_h, price`
      for (const r of rest) await post(r.buyer_h, 'outbid', { coins: r.price, body: { cardId: o.card_id } }, db)
      return { ok: true, price: o.price }
    })
    json(res, 200, out.gone ? { ok: false, gone: true } : out)
  }

  /**
   * The inbox: what is waiting, and taking it.
   *
   * Marked taken in the same statement that returns it, so two tabs opening
   * together cannot both be handed the same card — which is why the caller
   * must apply and save what it is given in one step.
   */
  async function mail(req, res, bucket) {
    if (guard(req, res, `mm:${bucket}`, 90)) return
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    // Taking moved to /api/card/act (mail_take): the server applies a
    // delivery to the account itself now, so a client can no longer be handed
    // mail and asked to keep it. This route only counts.
    if (b?.take) { json(res, 200, { ok: false, moved: true }); return }
    const n = await sql`select count(*)::int as n from card_mail where to_h = ${me} and taken is null`
    json(res, 200, { ok: true, waiting: n[0]?.n ?? 0 })
  }

  // ---------------------------------------------------------------- swaps

  /** How long a swap waits for an answer, and how many one account may have out. */
  const SWAP_DAYS = 3
  const MAX_SWAPS = 5

  /** Send both escrowed cards home from a swap that did not happen. */
  async function unwindSwap(row, reason, db = sql) {
    await post(row.from_h, 'swap_back', {
      cardId: row.give_id, level: row.give_level, body: { reason, swap: String(row.id) },
    }, db)
  }

  /** Swaps nobody answered go home with the offers. */
  async function sweepSwaps() {
    await tx(async (db) => {
      const stale = await db`
        update card_swaps set status = 'expired', settled = now()
        where status = 'open' and made < now() - make_interval(days => ${SWAP_DAYS})
        returning id, from_h, give_id, give_level`
      for (const row of stale) await unwindSwap(row, '三天没答复，自动撤回', db)
    })
  }

  /** One account by battle code, or a reason it could not be found. */
  async function byCode(code) {
    const clean = String(code ?? '').toLowerCase().replace(/[^0-9a-f]/g, '')
    if (clean.length !== 8) return { why: 'bad' }
    const rows = await sql`
      select id_hash, name from card_accounts where left(id_hash, 8) = ${clean} limit 2`
    if (!rows.length) return { why: 'missing' }
    if (rows.length > 1) return { why: 'clash' }
    return { row: rows[0] }
  }

  /**
   * Change one account's collection under the revision, retrying if another
   * request wrote in between. `edit` returns false to refuse.
   */
  async function editAccount(h, id, edit, db = sql) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await db`select state, rev from card_accounts where id_hash = ${h}`
      if (!row.length) return { ok: false, why: 'missing' }
      const g = engine.migrateGacha(row[0].state, id ?? 'VM-0000-0000-0000-0000-0000')
      const why = edit(g)
      if (why) return { ok: false, why }
      const w = await db`
        update card_accounts set state = ${db.json(stored(g))}, rev = rev + 1, saved = now()
        where id_hash = ${h} and rev = ${row[0].rev} returning rev`
      if (!w.length) continue
      return { ok: true, state: stored(g), rev: w[0].rev }
    }
    return { ok: false, why: 'busy' }
  }

  /**
   * Offer a friend a swap: my card for one of theirs, of the same metal.
   *
   * Like for like is the whole rule — a silver for a silver — because a swap
   * that crosses metals is a gift with extra steps, and gifting was removed
   * for being an alt-account funnel. My card leaves my account now and waits
   * in escrow; one 体力 is spent now too. Theirs is checked, not taken: it
   * leaves when they accept, and they pay their own point then.
   */
  async function swap(req, res, bucket) {
    if (guard(req, res, `sw:${bucket}`, 30)) return
    await sweepSwaps()
    let b
    try { b = JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const requestId = requestIdOf(b?.requestId)
    if (b?.requestId != null && !requestId) { json(res, 400, { ok: false, why: '请求号格式无效。' }); return }
    if (requestId && !(await requestsReady())) { json(res, 503, { ok: false, offline: true, why: '服务正在准备，请稍后重试。' }); return }
    const { id: _id, requestId: _requestId, ...intent } = b
    const requestKey = requestAction('market:swap', intent)
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const done = await finished(me, requestId, requestKey)
    if (done) { json(res, 200, done); return }
    const giveId = String(b?.giveId ?? '').slice(0, 40)
    const wantId = String(b?.wantId ?? '').slice(0, 40)
    const give = engine.cardById(giveId)
    const want = engine.cardById(wantId)
    if (!give || !want) { json(res, 200, { ok: false, notOwned: true }); return }
    if (give.rarity !== want.rarity) { json(res, 200, { ok: false, rarity: true }); return }
    const them = await byCode(b?.code)
    if (!them.row) { json(res, 200, { ok: false, [them.why]: true }); return }
    if (them.row.id_hash === me) { json(res, 200, { ok: false, self: true }); return }
    const barred = await guard2.banOf(me)
    if (barred) { json(res, 200, { ok: false, banned: true, ...barred }); return }
    const young = await tooNew(me)
    if (young) { json(res, 200, { ok: false, newbie: true, ...young }); return }
    const theirYoung = await tooNew(them.row.id_hash)
    if (theirYoung) { json(res, 200, { ok: false, theyNew: true, need: TRADE_PULLS, days: TRADE_DAYS }); return }
    const open = await sql`select count(*)::int as n from card_swaps where from_h = ${me} and status = 'open'`
    if ((open[0]?.n ?? 0) >= MAX_SWAPS) { json(res, 200, { ok: false, full: true, max: MAX_SWAPS }); return }
    // they have to hold what I am asking for, right now — checked again when they accept
    const theirs = await sql`select state->'cards' as cards from card_accounts where id_hash = ${them.row.id_hash}`
    if (!theirs[0]?.cards?.[wantId]) { json(res, 200, { ok: false, theyLack: true }); return }
    const who = await nameOf(me)
    const out = await once(me, requestId, requestKey, async (db) => {
      // Like listing, accepting five offers simultaneously must not bypass
      // the five-open-swaps limit checked above for the ordinary fast path.
      await db`select id_hash from card_accounts where id_hash = ${me} for update`
      const count = await db`select count(*)::int as n from card_swaps where from_h = ${me} and status = 'open'`
      if ((count[0]?.n ?? 0) >= MAX_SWAPS) return { ok: false, why: 'full' }
      let level = 0
      const r = await editAccount(me, id, (g) => {
        if (!engine.canPlay(g, 'swap', Date.now())) return 'stamina'
        const esc = engine.escrowCard(g, giveId)
        if (!esc.ok) return 'notOwned'
        engine.spendPlay(g, 'swap', Date.now())
        level = esc.level
        return null
      }, db)
      if (!r.ok) return r
      const ins = await db`
        insert into card_swaps (from_h, to_h, give_id, give_level, want_id)
        values (${me}, ${them.row.id_hash}, ${giveId}, ${level}, ${wantId}) returning id`
      await post(them.row.id_hash, 'swap_offer', {
        body: { swap: String(ins[0].id), give: giveId, want: wantId, who },
      }, db)
      return { ok: true, id: String(ins[0].id), state: r.state, rev: r.rev }
    })
    if (out.clash) { json(res, 200, { ok: false, clash: true }); return }
    if (!out.ok) { json(res, 200, { ok: false, [out.why]: true, ...(out.why === 'full' ? { max: MAX_SWAPS } : {}) }); return }
    json(res, 200, out)
  }

  /** Swaps waiting on me, and the ones I have out. */
  async function swaps(req, res, bucket) {
    if (guard(req, res, `sq:${bucket}`, 90)) return
    await sweepSwaps()
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const inbound = await sql`
      select id, from_h, give_id, give_level, want_id, made from card_swaps
      where to_h = ${me} and status = 'open' order by made desc`
    const outbound = await sql`
      select id, to_h, give_id, give_level, want_id, made from card_swaps
      where from_h = ${me} and status = 'open' order by made desc`
    const names = {}
    for (const r of inbound) if (!(r.from_h in names)) names[r.from_h] = await nameOf(r.from_h)
    for (const r of outbound) if (!(r.to_h in names)) names[r.to_h] = await nameOf(r.to_h)
    json(res, 200, {
      ok: true, days: SWAP_DAYS,
      inbound: inbound.map((r) => ({
        id: String(r.id), who: names[r.from_h], give: r.give_id, giveLevel: r.give_level,
        want: r.want_id, madeAt: new Date(r.made).getTime(),
      })),
      outbound: outbound.map((r) => ({
        id: String(r.id), who: names[r.to_h], give: r.give_id, giveLevel: r.give_level,
        want: r.want_id, madeAt: new Date(r.made).getTime(),
      })),
    })
  }

  /**
   * Take a swap, or turn it down.
   *
   * Accepting takes the wanted card out of the answerer's account and a
   * point of 体力 with it, in one write; then both cards go out as mail. If
   * the answerer no longer holds the card — sold it, listed it — the swap
   * is declined for them and the proposer's card goes home.
   */
  async function swapAnswer(req, res, bucket) {
    if (guard(req, res, `sa:${bucket}`, 40)) return
    await sweepSwaps()
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const sid = rowId(b?.swap)
    if (!sid) { json(res, 400, { ok: false, bad: true }); return }
    const got = await sql`
      select id, from_h, to_h, give_id, give_level, want_id from card_swaps
      where id = ${sid}::bigint and status = 'open'`
    if (!got.length || got[0].to_h !== me) { json(res, 200, { ok: false, gone: true }); return }
    const row = got[0]
    if (!b?.accept) {
      const out = await tx(async (db) => {
        const done = await db`
          update card_swaps set status = 'declined', settled = now()
          where id = ${row.id} and status = 'open' returning id`
        if (!done.length) return { gone: true }
        await unwindSwap(row, '对方拒绝了', db)
        return { ok: true, declined: true }
      })
      json(res, 200, out.gone ? { ok: false, gone: true } : out)
      return
    }
    const [theirName, myName] = [await nameOf(row.from_h), await nameOf(me)]
    const out = await tx(async (db) => {
      // The swap row is locked for the whole transaction, so two accepts of
      // the same swap — two tabs, a double tap — queue behind each other and
      // the second one finds it settled. Without this the second request
      // used to see the card already gone from the account, mark the DONE
      // swap declined unconditionally, and mail the proposer's card back on
      // top of the one already delivered: one card in two inboxes.
      const held = await db`
        select id from card_swaps where id = ${row.id} and status = 'open' for update`
      if (!held.length) return { gone: true }
      let level = 0
      const r = await editAccount(me, id, (g) => {
        if (!engine.canPlay(g, 'swap', Date.now())) return 'stamina'
        const esc = engine.escrowCard(g, row.want_id)
        if (!esc.ok) return 'notOwned'
        engine.spendPlay(g, 'swap', Date.now())
        level = esc.level
        return null
      }, db)
      if (!r.ok) {
        if (r.why === 'notOwned') {
          // they no longer hold it: the swap cannot happen, and the proposer
          // should not wait three days to learn that. Conditional on the row
          // still being open, and the card goes home only if this is the
          // request that closed it.
          const closed = await db`
            update card_swaps set status = 'declined', settled = now()
            where id = ${row.id} and status = 'open' returning id`
          if (closed.length) await unwindSwap(row, '对方已经没有这张卡了', db)
        }
        return { ok: false, why: r.why }
      }
      const won = await db`
        update card_swaps set status = 'done', settled = now()
        where id = ${row.id} and status = 'open' returning id`
      if (!won.length) {
        // settled a moment ago from another tab: give the card straight back
        await post(me, 'swap_back', { cardId: row.want_id, level, body: { reason: '这个交换已经结束了' } }, db)
        return { ok: false, gone: true, state: r.state, rev: r.rev }
      }
      await post(me, 'swap_in', { cardId: row.give_id, level: row.give_level, body: { who: theirName } }, db)
      await post(row.from_h, 'swap_in', { cardId: row.want_id, level, body: { who: myName } }, db)
      return { ok: true, state: r.state, rev: r.rev }
    })
    if (!out.ok) { json(res, 200, out.gone ? out : { ok: false, [out.why]: true }); return }
    json(res, 200, out)
  }

  /** Take an offer back before it is answered. The card comes home through the inbox. */
  async function swapCancel(req, res, bucket) {
    if (guard(req, res, `sc:${bucket}`, 30)) return
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    if (!(await isVerified(sql, me))) { json(res, 200, { ok: false, why: '先绑手机号再玩。', unverified: true }); return }
    const sid = rowId(b?.swap)
    if (!sid) { json(res, 400, { ok: false, bad: true }); return }
    const out = await tx(async (db) => {
      const rows = await db`
        update card_swaps set status = 'cancelled', settled = now()
        where id = ${sid}::bigint and from_h = ${me} and status = 'open'
        returning id, from_h, give_id, give_level`
      if (!rows.length) return { gone: true }
      await unwindSwap(rows[0], '你撤回了', db)
      return { ok: true }
    })
    json(res, 200, out.gone ? { ok: false, gone: true } : out)
  }

  return {
    /** one tick of the settler, for the timer's owner and for the checks */
    settleDue,
    /** which shelf query is live, and a way for the checks to look at both */
    summaryLive: () => summaryLive,
    forgetMenus: () => menuCache.clear(),
    /** the script guard, for the checks and the boot scan */
    guard: guard2,
    /** how the settler has been doing, for /api/ready and the logs */
    // No backlog count is queried here: unknown must not look like zero.
    settleStats: () => ({ ...settleStats, summaryLive: summaryLive && useSummary }),
    async route(req, res, path, bucket) {
      if (path === '/api/market/swap') { await swap(req, res, bucket); return true }
      if (path === '/api/market/swaps') { await swaps(req, res, bucket); return true }
      if (path === '/api/market/swap_answer') { await swapAnswer(req, res, bucket); return true }
      if (path === '/api/market/swap_cancel') { await swapCancel(req, res, bucket); return true }
      if (path === '/api/market/browse') { await browse(req, res, bucket); return true }
      if (path === '/api/market/participating') { await participating(req, res, bucket); return true }
      if (path === '/api/market/peek') { await peek(req, res, bucket); return true }
      if (path === '/api/market/list') { await list(req, res, bucket); return true }
      if (path === '/api/market/unlist') { await unlist(req, res, bucket); return true }
      if (path === '/api/market/offer') { await offer(req, res, bucket); return true }
      if (path === '/api/market/offers') { await offers(req, res, bucket); return true }
      if (path === '/api/market/withdraw') { await withdraw(req, res, bucket); return true }
      if (path === '/api/market/answer') { await answer(req, res, bucket); return true }
      if (path === '/api/market/retire_legacy') {
        // the owner's token, or a 404 like every other admin route: an
        // endpoint that admits it exists is one somebody comes back to
        let url
        try { url = new URL(req.url || '/', 'http://x') } catch { url = new URL('http://x/') }
        const given = tokenFrom ? tokenFrom(req, url) : null
        if (!token || !tokenOk || !tokenOk(given, token)) { json(res, 404, { ok: false }); return true }
        json(res, 200, await retireLegacy())
        return true
      }
      if (path === '/api/market/mail') { await mail(req, res, bucket); return true }
      if (path === '/api/market/guard') {
        // the owner's: an empty POST is the report (who is suspended, who is worth a look); { code, action: ban|lift|check, days?, note? } acts
        let url
        try { url = new URL(req.url || '/', 'http://x') } catch { url = new URL('http://x/') }
        const given = tokenFrom ? tokenFrom(req, url) : null
        if (!token || !tokenOk || !tokenOk(given, token)) { json(res, 404, { ok: false }); return true }
        let b = null
        try { b = JSON.parse(await readBody(req, 2048)) } catch { /* no body: the report */ }
        json(res, 200, b?.action === 'weekly' ? await guard2.weekly() : b?.action ? await guard2.manual(b) : { ok: true, ...(await guard2.report()) })
        return true
      }
      return false
    },
  }
}
