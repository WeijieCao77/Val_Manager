/**
 * The trading post.
 *
 * The rule that makes it safe is that both sides pay in when they act and
 * collect afterwards. Listing escrows the CARD; making an offer escrows the
 * COINS. Whatever happens next — sold, declined, expired, withdrawn — every
 * escrow ends up as a row in card_mail for somebody to collect. Neither side
 * can be left holding nothing because the other one never came back, which is
 * the failure mode a market between asynchronous players actually has.
 *
 * The clock does the rest, and it is checked lazily rather than by a job: an
 * offer nobody answers for three days is withdrawn and the coins go home, and
 * a listing whose seller has ignored three offers in a row comes off the shelf
 * and the card goes home. Both are settled the moment anyone looks at the
 * market, so the state a player sees is always already correct.
 *
 * The collection is the server's now — see engine/actions.ts — so the seller
 * really does own the card: it is taken out of the server's copy of the
 * account at the moment it is listed, and a bid takes the coins out of the
 * bidder's at the moment it is made. A client that says otherwise is not
 * consulted.
 */
import { createHash } from 'node:crypto'

/** How far an offer may sit from the asking price, either way. */
export const HAGGLE = 0.10
/** An offer the seller never answers. */
export const OFFER_DAYS = 3
/** How many other people's listings the shelf shows, newest first. */
export const SHELF = 400
/** Consecutive ignored offers before the listing gives up. */
export const IGNORE_LIMIT = 3
/** Nobody needs more than this on the shelf at once. */
export const MAX_LISTINGS = 8

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

export function makeMarketApi(sql, { readBody, json, normalizeId, displayName, rateLimited, engine }) {
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

  /** A listing, offer or swap id off the wire: digits, or nothing. Anything
   *  else went straight into a `::bigint` cast and answered 500. */
  const rowId = (v) => (/^\d{1,18}$/.test(String(v ?? '')) ? String(v) : null)

  /**
   * Settle everything the clock has decided, before anyone reads the market.
   *
   * Lazy rather than a cron: the only moment a stale offer matters is when
   * somebody looks, and doing it here means there is no second process whose
   * failure leaves the market wrong.
   */
  async function sweep() {
    await tx(async (db) => {
      const stale = await db`
        update card_offers set status = 'expired', settled = now()
        where status = 'open' and made < now() - make_interval(days => ${OFFER_DAYS})
        returning id, listing, buyer_h, price`
      for (const o of stale) {
        // the coins go home
        await post(o.buyer_h, 'offer_expired', {
          coins: o.price, body: { listing: String(o.listing) },
        }, db)
        await db`update card_listings set ignored = ignored + 1 where id = ${o.listing}`
      }
      const dead = await db`
        update card_listings set status = 'expired', closed = now()
        where status = 'open' and ignored >= ${IGNORE_LIMIT}
        returning id, seller_h, card_id, level`
      for (const l of dead) {
        // and so does the card
        await post(l.seller_h, 'listing_expired', {
          cardId: l.card_id, level: l.level, body: { listing: String(l.id) },
        }, db)
        // and so do the bids still sitting on it. A listing can die with a
        // fresh offer on it — somebody bid after the third ignored one was
        // made and before it was swept — and this used to mark that offer
        // expired without the mail, which is how 「出价的金币被卡了」 happened:
        // the card was gone from the shelf and the coins were gone with it.
        const back = await db`
          update card_offers set status = 'expired', settled = now()
          where listing = ${l.id} and status = 'open' returning buyer_h, price`
        for (const o of back) {
          await post(o.buyer_h, 'offer_expired', {
            coins: o.price, body: { listing: String(l.id) },
          }, db)
        }
      }
    })
  }

  /**
   * Has this account played enough to trade?
   *
   * Read from the saved state, which is the same place the ownership and coin
   * checks read from. Browsing is deliberately not gated — a new player should
   * be able to see what a card goes for long before he can buy one.
   */
  async function tooNew(h) {
    const r = await sql`select state->>'pulls' as pulls from card_accounts where id_hash = ${h}`
    const pulls = Number(r[0]?.pulls ?? 0)
    return pulls >= TRADE_PULLS ? null : { need: TRADE_PULLS, have: Math.max(0, Math.floor(pulls)) }
  }

  const nameOf = async (h) => {
    const r = await sql`select name from card_accounts where id_hash = ${h}`
    const shown = displayName(r[0]?.name, h)
    return `${shown.name} #${shown.tag}`
  }

  /** The shelf. */
  async function browse(req, res, bucket) {
    if (guard(req, res, `mb:${bucket}`, 90)) return
    await sweep()
    let mine = ''
    try {
      const b = JSON.parse(await readBody(req, 2048))
      const id = normalizeId(b?.id)
      if (id) mine = hash(id)
    } catch { /* browsing without an account is fine */ }
    // Your own listings come first and come ALL of them, outside the window.
    // The shelf used to be "the 120 newest", full stop, and 「我挂的牌」 on
    // the client is read off the same shelf — so once 120 newer listings
    // existed, an older one vanished from its owner's page and from every
    // buyer's, with the card still in escrow: 「挂了一张金卡消失了，也没有
    // 别人报价」. The window is wider too, and the reply says how many are
    // open in total so the page can say so.
    const own = mine ? await sql`
      select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created,
             (select count(*)::int from card_offers o
               where o.listing = l.id and o.status = 'open') as offers,
             (select max(o.price)::int from card_offers o
               where o.listing = l.id and o.status = 'open') as best,
             false as bid
      from card_listings l
      where l.status = 'open' and l.seller_h = ${mine}
      order by l.created desc` : []
    const others = await sql`
      select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created,
             (select count(*)::int from card_offers o
               where o.listing = l.id and o.status = 'open') as offers,
             (select max(o.price)::int from card_offers o
               where o.listing = l.id and o.status = 'open') as best,
             exists (select 1 from card_offers o
               where o.listing = l.id and o.status = 'open' and o.buyer_h = ${mine}) as bid
      from card_listings l
      where l.status = 'open' and l.seller_h <> ${mine}
      order by l.created desc
      limit ${SHELF}`
    const rows = [...own, ...others]
    const total = (await sql`select count(*)::int as n from card_listings where status = 'open'`)[0].n
    const names = {}
    for (const r of rows) if (!(r.seller_h in names)) names[r.seller_h] = await nameOf(r.seller_h)
    const young = mine ? await tooNew(mine) : { need: TRADE_PULLS, have: 0 }
    json(res, 200, {
      ok: true,
      haggle: HAGGLE,
      gate: young,
      total,
      shelf: SHELF,
      listings: rows.map((r) => ({
        id: String(r.id), cardId: r.card_id, level: r.level, ask: r.ask,
        seller: names[r.seller_h], mine: r.seller_h === mine,
        offers: r.offers, best: r.best ?? null, bid: r.bid,
      })),
    })
  }

  /** Put a card up. The card leaves your side now and comes back if it does not sell. */
  async function list(req, res, bucket) {
    if (guard(req, res, `ml:${bucket}`, 30)) return
    await sweep()
    let b
    try { b = JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
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
    const young = await tooNew(me)
    if (young) { json(res, 200, { ok: false, newbie: true, ...young }); return }
    const open = await sql`
      select count(*)::int as n from card_listings where seller_h = ${me} and status = 'open'`
    if ((open[0]?.n ?? 0) >= MAX_LISTINGS) { json(res, 200, { ok: false, full: true, max: MAX_LISTINGS }); return }
    // read against the save the server holds, not against what the client says
    const mine = await sql`select state->'cards' as cards from card_accounts where id_hash = ${me}`
    const owned = mine[0]?.cards?.[cardId]
    if (!owned) { json(res, 200, { ok: false, notOwned: true }); return }
    const already = await sql`
      select count(*)::int as n from card_listings
      where seller_h = ${me} and card_id = ${cardId} and status = 'open'`
    // one listing per card id: two would both escrow "the" card and the second
    // sale would have nothing behind it
    const held = Number(owned.dupes ?? 0) + 1
    if ((already[0]?.n ?? 0) >= held) { json(res, 200, { ok: false, alreadyListed: true }); return }
    // The card leaves the collection HERE, on the server's copy — a spare
    // first, at level 0; the card itself otherwise, at the level it holds.
    // It used to leave on the client's copy after this reply, which meant a
    // client that skipped that step listed a card it still held.
    const out = await tx(async (db) => {
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
          insert into card_listings (seller_h, card_id, level, ask)
          values (${me}, ${cardId}, ${esc.level}, ${ask}) returning id`
        return { ok: true, id: String(r[0].id), state: stored(g), rev: w[0].rev }
      }
      return { busy: true }
    })
    if (out.notOwned) { json(res, 200, { ok: false, notOwned: true }); return }
    if (out.busy) { json(res, 409, { ok: false, busy: true }); return }
    json(res, 200, out)
  }

  /** Take it back off the shelf. The card comes home through the inbox. */
  async function unlist(req, res, bucket) {
    if (guard(req, res, `mu:${bucket}`, 30)) return
    await sweep()
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    const lid = rowId(b?.listing)
    if (!lid) { json(res, 400, { ok: false, bad: true }); return }
    const out = await tx(async (db) => {
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
    json(res, 200, out.gone ? { ok: false, gone: true } : out)
  }

  /** Bid. The coins leave your side now and come back if it does not go through. */
  async function offer(req, res, bucket) {
    if (guard(req, res, `mo:${bucket}`, 40)) return
    await sweep()
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    const price = Math.round(Number(b?.price))
    const lid = rowId(b?.listing)
    if (!lid) { json(res, 400, { ok: false, bad: true }); return }
    const rows = await sql`
      select id, seller_h, card_id, ask from card_listings
      where id = ${lid}::bigint and status = 'open'`
    if (!rows.length) { json(res, 200, { ok: false, gone: true }); return }
    const l = rows[0]
    if (l.seller_h === me) { json(res, 200, { ok: false, self: true }); return }
    const lo = Math.ceil(l.ask * (1 - HAGGLE))
    const hi = Math.floor(l.ask * (1 + HAGGLE))
    if (!Number.isFinite(price) || price < lo || price > hi) {
      json(res, 200, { ok: false, range: true, lo, hi })
      return
    }
    const young = await tooNew(me)
    if (young) { json(res, 200, { ok: false, newbie: true, ...young }); return }
    const dup = await sql`
      select count(*)::int as n from card_offers
      where listing = ${l.id} and buyer_h = ${me} and status = 'open'`
    if ((dup[0]?.n ?? 0) > 0) { json(res, 200, { ok: false, already: true }); return }
    // the coins leave the server's copy of the account, here, before the
    // offer exists — a bid is never made with money the account does not hold
    const who = await nameOf(me)
    const out = await tx(async (db) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await db`select state, rev from card_accounts where id_hash = ${me}`
        if (!row.length) return { broke: true }
        const g = engine.migrateGacha(row[0].state, id)
        if (g.coins < price) return { broke: true }
        g.coins -= price
        const w = await db`
          update card_accounts set state = ${db.json(stored(g))}, rev = rev + 1, saved = now()
          where id_hash = ${me} and rev = ${row[0].rev} returning rev`
        if (!w.length) continue
        await db`insert into card_offers (listing, buyer_h, price) values (${l.id}, ${me}, ${price})`
        await post(l.seller_h, 'offer_made', {
          body: { listing: String(l.id), cardId: l.card_id, price, ask: l.ask, who },
        }, db)
        return { ok: true, state: stored(g), rev: w[0].rev }
      }
      return { busy: true }
    })
    if (out.broke) { json(res, 200, { ok: false, broke: true }); return }
    if (out.busy) { json(res, 409, { ok: false, busy: true }); return }
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
    await sweep()
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    const oid = rowId(b?.offer)
    if (!oid) { json(res, 400, { ok: false, bad: true }); return }
    const out = await tx(async (db) => {
      const rows = await db`
        update card_offers set status = 'withdrawn', settled = now()
        where id = ${oid}::bigint and buyer_h = ${me} and status = 'open'
        returning id, listing, price`
      if (!rows.length) return { gone: true }
      const o = rows[0]
      const l = await db`select card_id from card_listings where id = ${o.listing}`
      await post(me, 'offer_withdrawn', {
        coins: o.price,
        body: { listing: String(o.listing), cardId: l[0]?.card_id ?? null, price: o.price },
      }, db)
      return { ok: true, coins: o.price }
    })
    json(res, 200, out.gone ? { ok: false, gone: true } : out)
  }

  /** Offers on my listings, and my own bids. */
  async function offers(req, res, bucket) {
    if (guard(req, res, `mq:${bucket}`, 90)) return
    await sweep()
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    const inbound = await sql`
      select o.id, o.price, o.made, o.buyer_h, l.id as listing, l.card_id, l.ask, l.ignored
      from card_offers o join card_listings l on l.id = o.listing
      where l.seller_h = ${me} and o.status = 'open' and l.status = 'open'
      order by o.price desc`
    const outbound = await sql`
      select o.id, o.price, o.made, o.status, l.card_id, l.ask, l.seller_h, l.status as lstatus
      from card_offers o join card_listings l on l.id = o.listing
      where o.buyer_h = ${me} and o.status = 'open'
      order by o.made desc`
    const names = {}
    for (const r of inbound) if (!(r.buyer_h in names)) names[r.buyer_h] = await nameOf(r.buyer_h)
    for (const r of outbound) if (!(r.seller_h in names)) names[r.seller_h] = await nameOf(r.seller_h)
    json(res, 200, {
      ok: true,
      days: OFFER_DAYS,
      inbound: inbound.map((r) => ({
        id: String(r.id), listing: String(r.listing), cardId: r.card_id,
        ask: r.ask, price: r.price, who: names[r.buyer_h],
        madeAt: new Date(r.made).getTime(), ignored: r.ignored,
      })),
      outbound: outbound.map((r) => ({
        id: String(r.id), cardId: r.card_id, ask: r.ask, price: r.price,
        who: names[r.seller_h], madeAt: new Date(r.made).getTime(),
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
    await sweep()
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    const take = !!b?.accept
    const oid = rowId(b?.offer)
    if (!oid) { json(res, 400, { ok: false, bad: true }); return }
    const got = await sql`
      select o.id, o.buyer_h, o.price, l.id as listing, l.seller_h, l.card_id, l.level, l.status
      from card_offers o join card_listings l on l.id = o.listing
      where o.id = ${oid}::bigint and o.status = 'open'`
    if (!got.length || got[0].seller_h !== me) { json(res, 200, { ok: false, gone: true }); return }
    const o = got[0]
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
    await sweep()
    let b
    try { b = JSON.parse(await readBody(req, 2048)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
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
    await sweep(); await sweepSwaps()
    let b
    try { b = JSON.parse(await readBody(req, 4096)) } catch { json(res, 400, { ok: false }); return }
    const id = normalizeId(b?.id)
    if (!id) { json(res, 400, { ok: false, bad: true }); return }
    const me = hash(id)
    const giveId = String(b?.giveId ?? '').slice(0, 40)
    const wantId = String(b?.wantId ?? '').slice(0, 40)
    const give = engine.cardById(giveId)
    const want = engine.cardById(wantId)
    if (!give || !want) { json(res, 200, { ok: false, notOwned: true }); return }
    if (give.rarity !== want.rarity) { json(res, 200, { ok: false, rarity: true }); return }
    const them = await byCode(b?.code)
    if (!them.row) { json(res, 200, { ok: false, [them.why]: true }); return }
    if (them.row.id_hash === me) { json(res, 200, { ok: false, self: true }); return }
    const young = await tooNew(me)
    if (young) { json(res, 200, { ok: false, newbie: true, ...young }); return }
    const theirYoung = await tooNew(them.row.id_hash)
    if (theirYoung) { json(res, 200, { ok: false, theyNew: true }); return }
    const open = await sql`select count(*)::int as n from card_swaps where from_h = ${me} and status = 'open'`
    if ((open[0]?.n ?? 0) >= MAX_SWAPS) { json(res, 200, { ok: false, full: true, max: MAX_SWAPS }); return }
    // they have to hold what I am asking for, right now — checked again when they accept
    const theirs = await sql`select state->'cards' as cards from card_accounts where id_hash = ${them.row.id_hash}`
    if (!theirs[0]?.cards?.[wantId]) { json(res, 200, { ok: false, theyLack: true }); return }
    const who = await nameOf(me)
    const out = await tx(async (db) => {
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
    if (!out.ok) { json(res, 200, { ok: false, [out.why]: true }); return }
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
    async route(req, res, path, bucket) {
      if (path === '/api/market/swap') { await swap(req, res, bucket); return true }
      if (path === '/api/market/swaps') { await swaps(req, res, bucket); return true }
      if (path === '/api/market/swap_answer') { await swapAnswer(req, res, bucket); return true }
      if (path === '/api/market/swap_cancel') { await swapCancel(req, res, bucket); return true }
      if (path === '/api/market/browse') { await browse(req, res, bucket); return true }
      if (path === '/api/market/list') { await list(req, res, bucket); return true }
      if (path === '/api/market/unlist') { await unlist(req, res, bucket); return true }
      if (path === '/api/market/offer') { await offer(req, res, bucket); return true }
      if (path === '/api/market/offers') { await offers(req, res, bucket); return true }
      if (path === '/api/market/withdraw') { await withdraw(req, res, bucket); return true }
      if (path === '/api/market/answer') { await answer(req, res, bucket); return true }
      if (path === '/api/market/mail') { await mail(req, res, bucket); return true }
      return false
    },
  }
}
