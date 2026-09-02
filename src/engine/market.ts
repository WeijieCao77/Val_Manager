/**
 * The trading post, from this side of the wire.
 *
 * The accounting rule is the same one the server enforces: you pay in when you
 * act and collect afterwards. Listing takes the card off your side now;
 * offering takes the coins. Everything that comes back — a sale, a refund, a
 * card that did not sell — arrives through the inbox and is applied in one
 * step with the save, because mail is handed over exactly once and a delivery
 * fetched and dropped is a card that exists nowhere.
 */
import { cardById, isPlayerCard } from './cards'
import { rememberedId } from './cardid'
import { MAIL_MAX, PACKS } from './gacha'
import type { GachaState, PackKind } from './gacha'

const api = (p: string) => `/api/market/${p}`

async function post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await fetch(api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rememberedId(), ...body }),
    })
    if (!r.ok) return null
    return await r.json() as T
  } catch {
    return null
  }
}

export interface Listing {
  id: string
  cardId: string
  level: number
  ask: number
  seller: string
  mine: boolean
  offers: number
  best: number | null
  bid: boolean
}

export interface Offer {
  id: string
  listing?: string
  cardId: string
  ask: number
  price: number
  who: string
  madeAt: number
  ignored?: number
}

export interface MailItem {
  kind: string
  cardId: string | null
  level: number
  coins: number
  /** an unopened pack, for a grant from the owner */
  pack: string | null
  count: number
  body: Record<string, unknown>
  at: number
}

/** `gate` is null once the account has played enough to trade — see TRADE_PULLS. */
export interface Gate { need: number; have: number }

export const browseMarket = () =>
  post<{ ok: boolean; listings: Listing[]; haggle: number; gate: Gate | null }>('browse', {})

export const myOffers = () =>
  post<{ ok: boolean; inbound: Offer[]; outbound: Offer[]; days: number }>('offers', {})

export const countMail = () => post<{ ok: boolean; waiting: number }>('mail', {})

/**
 * `rarity` travels with the listing so the server can floor the price at what
 * the game itself would pay for the card — nobody sane sells below salvage, so
 * the floor costs a real seller nothing and closes the alt-account funnel.
 */
export const listCardOnMarket = (cardId: string, ask: number, level: number, rarity: string) =>
  post<Record<string, unknown>>('list', { cardId, ask, level, rarity })

/** The least a card may be listed for — SALVAGE, mirrored from the server. */
export const askFloorOf = (rarity: string): number =>
  ({ mythic: 4000, gold: 700, silver: 200, bronze: 60 } as Record<string, number>)[rarity] ?? 50

export const unlistCard = (listing: string) => post<Record<string, unknown>>('unlist', { listing })
export const bidOn = (listing: string, price: number) =>
  post<Record<string, unknown>>('offer', { listing, price })
export const answerOffer = (offer: string, accept: boolean) =>
  post<Record<string, unknown>>('answer', { offer, accept })

/**
 * Take a card off this side, ready to be listed.
 *
 * A spare goes first and goes out unupgraded — upgrading consumes duplicates,
 * so a duplicate is by definition level 0. Only when there is no spare does the
 * card itself leave, and then it carries whatever it was raised to.
 */
export function escrowCard(g: GachaState, cardId: string): { ok: boolean; level: number } {
  const owned = g.cards[cardId]
  if (!owned) return { ok: false, level: 0 }
  if (owned.dupes > 0) { owned.dupes -= 1; return { ok: true, level: 0 } }
  const level = owned.level
  delete g.cards[cardId]
  // and it cannot still be in the five it was just taken out of
  g.squad = {
    slots: g.squad.slots.map((x) => (x === cardId ? null : x)),
    coach: g.squad.coach === cardId ? null : g.squad.coach,
  }
  return { ok: true, level }
}

/** Put a card back, at the level it went out with. */
export function restoreCard(g: GachaState, cardId: string, level: number): void {
  const had = g.cards[cardId]
  if (had) { had.dupes++; had.seen++; return }
  g.cards[cardId] = {
    id: cardId, level: Math.max(0, level), dupes: 0, seen: 1,
    got: new Date().toISOString().slice(0, 10),
  }
}

const nameOf = (cardId: string): string => {
  const c = cardById(cardId)
  if (!c) return '一张卡'
  return isPlayerCard(c) ? c.ign : c.name
}

/** What one piece of mail says, in the player's words. */
export function mailLine(m: MailItem): string {
  const who = String(m.body?.who ?? '')
  switch (m.kind) {
    case 'sold': return `${nameOf(String(m.body?.cardId ?? ''))} 卖给了 ${who}，到账 ${m.coins} 金币`
    case 'bought': return `买到 ${nameOf(m.cardId ?? '')}，花了 ${m.body?.price} 金币`
    case 'outbid': return `${nameOf(String(m.body?.cardId ?? ''))} 被别人买走了，你的 ${m.coins} 金币退回`
    case 'offer_declined': return `对方拒绝了你的报价，${m.coins} 金币退回`
    case 'offer_expired': return `报价过期或挂牌撤回，${m.coins} 金币退回`
    case 'offer_made': return `${who} 对你的 ${nameOf(String(m.body?.cardId ?? ''))} 出价 ${m.body?.price}（挂 ${m.body?.ask}）`
    case 'listing_pulled': return `${nameOf(m.cardId ?? '')} 已撤回`
    case 'listing_expired': return `${nameOf(m.cardId ?? '')} 连续三次没回复报价，已自动下架并退回`
    case 'grant': {
      const bits = []
      if (m.pack) bits.push(`${PACKS[m.pack as PackKind]?.name ?? m.pack} ×${m.count}`)
      if (m.coins) bits.push(`${m.coins} 金币`)
      if (m.cardId) bits.push(nameOf(m.cardId))
      const note = String(m.body?.note ?? '')
      return `收到官方发放：${bits.join('，')}${note ? `（${note}）` : ''}`
    }
    default: return '有一条新消息'
  }
}

/**
 * Collect everything waiting and apply it.
 *
 * Fetch and apply are one call on purpose: the server marks mail taken in the
 * same statement that hands it over, so anything read here and not written to
 * the save is gone for good.
 */
export async function collectMail(g: GachaState): Promise<MailItem[]> {
  const r = await post<{ ok: boolean; mail: MailItem[] }>('mail', { take: true })
  if (!r?.ok || !r.mail?.length) return []
  applyMail(g, r.mail)
  return r.mail
}

/**
 * Apply what the server handed over, and keep a readable copy of it.
 *
 * Split from the fetch so it can be exercised without a server. The copy is
 * what the 信箱 button shows: the server has already marked these taken, so
 * the save is the only place they can be read back from.
 */
export function applyMail(g: GachaState, mail: MailItem[]): void {
  const now = Date.now()
  for (const m of mail) {
    if (m.coins) g.coins += m.coins
    if (m.cardId) restoreCard(g, m.cardId, m.level)
    if (m.pack && m.pack in PACKS) {
      const k = m.pack as PackKind
      g.packs[k] = (g.packs[k] ?? 0) + Math.max(1, m.count)
    }
    const note = m.kind === 'grant' ? String(m.body?.note ?? '') : ''
    // the note gets its own line in the box, so the headline goes without it
    const text = mailLine(note ? { ...m, body: { ...m.body, note: '' } } : m)
    g.mail = [
      { at: m.at || now, kind: m.kind, text, ...(note ? { note } : {}), seen: false },
      ...(g.mail ?? []),
    ].slice(0, MAIL_MAX)
  }
}

/** How many deliveries the player has not looked at yet. */
export const unreadMail = (g: GachaState): number => (g.mail ?? []).filter((m) => !m.seen).length

/** The player opened the box: everything in it has been looked at. */
export function markMailSeen(g: GachaState): boolean {
  let changed = false
  for (const m of g.mail ?? []) {
    if (!m.seen) { m.seen = true; changed = true }
  }
  return changed
}
