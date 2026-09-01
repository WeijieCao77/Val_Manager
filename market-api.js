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
 * What this cannot do is verify that the seller really owned the card. Saves
 * in this game are client-authoritative — that is the design, and an anti-cheat
 * pass on a browser game is theatre — so an edited client can list a card it
 * conjured. The ownership check below reads the seller's SAVED state, which
 * raises the cost from "edit one number" to "edit and save", and no further.
 * Worth saying plainly rather than implying a guarantee that is not there.
 */
import { createHash } from 'node:crypto'

/** How far an offer may sit from the asking price, either way. */
export const HAGGLE = 0.10
/** An offer the seller never answers. */
export const OFFER_DAYS = 3
/** Consecutive ignored offers before the listing gives up. */
export const IGNORE_LIMIT = 3
/** Nobody needs more than this on the shelf at once. */
export const MAX_LISTINGS = 8
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

export function makeMarketApi(sql, { readBody, json, normalizeId, displayName, rateLimited }) {
  const guard = (req, res, bucket, max) => {
    if (rateLimited(bucket, max)) { json(res, 429, { ok: false, why: 'rate' }); return true }
    return false
  }

  const post = (to, kind, extra = {}) => sql`
    insert into card_mail (to_h, kind, card_id, level, coins, body)
    values (${to}, ${kind}, ${extra.cardId ?? null}, ${extra.level ?? 0},
            ${extra.coins ?? 0}, ${sql.json(extra.body ?? {})})`

  /**
   * Settle everything the clock has decided, before anyone reads the market.
   *
   * Lazy rather than a cron: the only moment a stale offer matters is when
   * somebody looks, and doing it here means there is no second process whose
   * failure leaves the market wrong.
   */
  async function sweep() {
    const stale = await sql`
      update card_offers set status = 'expired', settled = now()
      where status = 'open' and made < now() - make_interval(days => ${OFFER_DAYS})
      returning id, listing, buyer_h, price`
    for (const o of stale) {
      // the coins go home
      await post(o.buyer_h, 'offer_expired', {
        coins: o.price, body: { listing: String(o.listing) },
      })
      await sql`update card_listings set ignored = ignored + 1 where id = ${o.listing}`
    }
    const dead = await sql`
      update card_listings set status = 'expired', closed = now()
      where status = 'open' and ignored >= ${IGNORE_LIMIT}
      returning id, seller_h, card_id, level`
    for (const l of dead) {
      // and so does the card
      await post(l.seller_h, 'listing_expired', {
        cardId: l.card_id, level: l.level, body: { listing: String(l.id) },
      })
      await sql`
        update card_offers set status = 'expired', settled = now()
        where listing = ${l.id} and status = 'open'`
    }
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
    const rows = await sql`
      select l.id, l.seller_h, l.card_id, l.level, l.ask, l.created,
             (select count(*)::int from card_offers o
               where o.listing = l.id and o.status = 'open') as offers,
             (select max(o.price)::int from card_offers o
               where o.listing = l.id and o.status = 'open') as best,
             exists (select 1 from card_offers o
               where o.listing = l.id and o.status = 'open' and o.buyer_h = ${mine}) as bid
      from card_listings l
      where l.status = 'open'
      order by l.created desc
      limit 120`
    const names = {}
    for (const r of rows) if (!(r.seller_h in names)) names[r.seller_h] = await nameOf(r.seller_h)
    json(res, 200, {
      ok: true,
      haggle: HAGGLE,
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
    const level = Math.max(0, Math.min(20, Math.round(Number(b?.level) || 0)))
    const rarity = String(b?.rarity ?? '')
    const floor = askFloor(rarity)
    if (!cardId || !Number.isFinite(ask) || ask < floor || ask > MAX_ASK) {
      json(res, 200, { ok: false, bad: true, min: floor, max: MAX_ASK })
      return
    }
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
    const r = await sql`
      insert into card_listings (seller_h, card_id, level, ask)
      values (${me}, ${cardId}, ${level}, ${ask}) returning id`
    json(res, 200, { ok: true, id: String(r[0].id) })
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
    const rows = await sql`
      update card_listings set status = 'pulled', closed = now()
      where id = ${String(b?.listing ?? '')}::bigint and seller_h = ${me} and status = 'open'
      returning id, card_id, level`
    if (!rows.length) { json(res, 200, { ok: false, gone: true }); return }
    const l = rows[0]
    await post(me, 'listing_pulled', { cardId: l.card_id, level: l.level })
    const back = await sql`
      update card_offers set status = 'expired', settled = now()
      where listing = ${l.id} and status = 'open' returning buyer_h, price`
    for (const o of back) await post(o.buyer_h, 'offer_expired', { coins: o.price })
    json(res, 200, { ok: true, refunded: back.length })
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
    const rows = await sql`
      select id, seller_h, card_id, ask from card_listings
      where id = ${String(b?.listing ?? '')}::bigint and status = 'open'`
    if (!rows.length) { json(res, 200, { ok: false, gone: true }); return }
    const l = rows[0]
    if (l.seller_h === me) { json(res, 200, { ok: false, self: true }); return }
    const lo = Math.ceil(l.ask * (1 - HAGGLE))
    const hi = Math.floor(l.ask * (1 + HAGGLE))
    if (!Number.isFinite(price) || price < lo || price > hi) {
      json(res, 200, { ok: false, range: true, lo, hi })
      return
    }
    const mine = await sql`select state->>'coins' as coins from card_accounts where id_hash = ${me}`
    if (Number(mine[0]?.coins ?? 0) < price) { json(res, 200, { ok: false, broke: true }); return }
    const dup = await sql`
      select count(*)::int as n from card_offers
      where listing = ${l.id} and buyer_h = ${me} and status = 'open'`
    if ((dup[0]?.n ?? 0) > 0) { json(res, 200, { ok: false, already: true }); return }
    await sql`insert into card_offers (listing, buyer_h, price) values (${l.id}, ${me}, ${price})`
    await post(l.seller_h, 'offer_made', {
      body: { listing: String(l.id), cardId: l.card_id, price, ask: l.ask, who: await nameOf(me) },
    })
    json(res, 200, { ok: true })
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
    const got = await sql`
      select o.id, o.buyer_h, o.price, l.id as listing, l.seller_h, l.card_id, l.level, l.status
      from card_offers o join card_listings l on l.id = o.listing
      where o.id = ${String(b?.offer ?? '')}::bigint and o.status = 'open'`
    if (!got.length || got[0].seller_h !== me) { json(res, 200, { ok: false, gone: true }); return }
    const o = got[0]
    if (!take) {
      const done = await sql`
        update card_offers set status = 'declined', settled = now()
        where id = ${o.id} and status = 'open' returning id`
      if (!done.length) { json(res, 200, { ok: false, gone: true }); return }
      // a refusal is still an answer, so it does not count against the listing
      await post(o.buyer_h, 'offer_declined', {
        coins: o.price, body: { cardId: o.card_id, price: o.price },
      })
      json(res, 200, { ok: true, declined: true })
      return
    }
    if (o.status !== 'open') { json(res, 200, { ok: false, gone: true }); return }
    const won = await sql`
      update card_offers set status = 'accepted', settled = now()
      where id = ${o.id} and status = 'open' returning id`
    if (!won.length) { json(res, 200, { ok: false, gone: true }); return }
    const closed = await sql`
      update card_listings set status = 'sold', closed = now()
      where id = ${o.listing} and status = 'open' returning id`
    if (!closed.length) {
      // somebody else closed it a moment ago; give the money straight back
      await sql`update card_offers set status = 'expired' where id = ${o.id}`
      await post(o.buyer_h, 'offer_expired', { coins: o.price })
      json(res, 200, { ok: false, gone: true })
      return
    }
    await post(o.buyer_h, 'bought', {
      cardId: o.card_id, level: o.level,
      body: { price: o.price, who: await nameOf(me) },
    })
    await post(me, 'sold', {
      coins: o.price, body: { cardId: o.card_id, price: o.price, who: await nameOf(o.buyer_h) },
    })
    // every other bid on that card goes home
    const rest = await sql`
      update card_offers set status = 'expired', settled = now()
      where listing = ${o.listing} and status = 'open' returning buyer_h, price`
    for (const r of rest) await post(r.buyer_h, 'outbid', { coins: r.price, body: { cardId: o.card_id } })
    json(res, 200, { ok: true, price: o.price })
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
    if (!b?.take) {
      const n = await sql`select count(*)::int as n from card_mail where to_h = ${me} and taken is null`
      json(res, 200, { ok: true, waiting: n[0]?.n ?? 0 })
      return
    }
    const rows = await sql`
      update card_mail set taken = now() where to_h = ${me} and taken is null
      returning kind, card_id, level, coins, body, made`
    json(res, 200, {
      ok: true,
      mail: rows.map((r) => ({
        kind: r.kind, cardId: r.card_id, level: r.level, coins: r.coins,
        body: r.body ?? {}, at: new Date(r.made).getTime(),
      })),
    })
  }

  return {
    async route(req, res, path, bucket) {
      if (path === '/api/market/browse') { await browse(req, res, bucket); return true }
      if (path === '/api/market/list') { await list(req, res, bucket); return true }
      if (path === '/api/market/unlist') { await unlist(req, res, bucket); return true }
      if (path === '/api/market/offer') { await offer(req, res, bucket); return true }
      if (path === '/api/market/offers') { await offers(req, res, bucket); return true }
      if (path === '/api/market/answer') { await answer(req, res, bucket); return true }
      if (path === '/api/market/mail') { await mail(req, res, bucket); return true }
      return false
    },
  }
}
