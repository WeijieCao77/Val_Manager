/**
 * The trading post, from this side of the wire.
 *
 * The accounting rule is the same one the server enforces: you pay in when you
 * act and collect afterwards. Listing takes the card off your side now;
 * offering takes the coins. Everything that comes back — a sale, a refund, a
 * card that did not sell — arrives through the inbox.
 *
 * None of that is applied here any more. The server takes the card out of the
 * collection when it lists it, takes the coins when it bids, and puts mail
 * into the collection when it is collected — and hands the account back each
 * time. This file only asks.
 */
import { rememberedId } from './cardid'
import type { GachaState } from './gacha'

export { escrowCard, restoreCard, mailLine, applyMail, unreadMail, markMailSeen } from './inbox'
export type { MailItem } from './inbox'

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

/** `gate` is null once the account has played enough to trade — see TRADE_PULLS. */
export interface Gate { need: number; have: number }

export const browseMarket = () =>
  post<{ ok: boolean; listings: Listing[]; haggle: number; gate: Gate | null; total?: number; shelf?: number }>('browse', {})

export const myOffers = () =>
  post<{ ok: boolean; inbound: Offer[]; outbound: Offer[]; days: number }>('offers', {})

export const countMail = () => post<{ ok: boolean; waiting: number }>('mail', {})

/** A market reply that carries the account as the server now holds it. */
export interface WithState { ok: boolean; state?: GachaState; rev?: number; [k: string]: unknown }

/**
 * `rarity` travels with the listing so the server can floor the price at what
 * the game itself would pay for the card — nobody sane sells below salvage, so
 * the floor costs a real seller nothing and closes the alt-account funnel.
 */
export const listCardOnMarket = (cardId: string, ask: number, level: number, rarity: string) =>
  post<WithState>('list', { cardId, ask, level, rarity })

/** The least a card may be listed for — SALVAGE, mirrored from the server. */
export const askFloorOf = (rarity: string): number =>
  ({ mythic: 4000, gold: 700, silver: 200, bronze: 60 } as Record<string, number>)[rarity] ?? 50

export const unlistCard = (listing: string) => post<Record<string, unknown>>('unlist', { listing })

// ---------------------------------------------------------------- swaps

/** A swap on the table: what they give, what they want, who they are. */
export interface SwapRow {
  id: string
  who: string
  give: string
  giveLevel: number
  want: string
  madeAt: number
}

/** Offer a friend my card for one of theirs — same metal, one 体力. */
export const proposeSwap = (code: string, giveId: string, wantId: string) =>
  post<WithState & { id?: string }>('swap', { code, giveId, wantId })

export const mySwaps = () =>
  post<{ ok: boolean; inbound: SwapRow[]; outbound: SwapRow[]; days: number }>('swaps', {})

export const answerSwap = (swap: string, accept: boolean) =>
  post<WithState>('swap_answer', { swap, accept })

export const cancelSwap = (swap: string) => post<Record<string, unknown>>('swap_cancel', { swap })
export const bidOn = (listing: string, price: number) => post<WithState>('offer', { listing, price })
export const answerOffer = (offer: string, accept: boolean) =>
  post<Record<string, unknown>>('answer', { offer, accept })
/** Take my own bid back; the coins come home through the inbox. */
export const withdrawOffer = (offer: string) => post<Record<string, unknown>>('withdraw', { offer })
