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
  /** the starting price */
  ask: number
  seller: string
  mine: boolean
  /** bids still standing — one, on an auction */
  offers: number
  /** the standing top bid */
  best: number | null
  /** I have a bid standing on it (on an auction: I am leading) */
  bid: boolean
  /** when the auction closes, ms since the epoch; null for a listing from before the auctions */
  ends: number | null
  /** the price that ends it at once, if the seller set one */
  buyout: number | null
  /** everyone who has bid on it at all, beaten ones included */
  bids: number
  /** the least the next bid may be */
  min: number
  /** how many hours the seller put it up for */
  hours?: number
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
  /** the auction's close, or null for an old-style listing */
  ends?: number | null
  buyout?: number | null
}

/**
 * `gate` is null once the account can trade: TRADE_PULLS pulls, and TRADE_DAYS
 * days since it was made. `wait` is the seconds left on the second, measured
 * on the server's clock.
 */
export interface Gate { need: number; have: number; days?: number; wait?: number }

/** 2 天 5 小时 · 5 小时 · 12 分钟 */
export function waitText(sec: number): string {
  const m = Math.ceil(sec / 60)
  if (m < 60) return `${Math.max(1, m)} 分钟`
  const h = Math.ceil(sec / 3600)
  if (h < 24) return `${h} 小时`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} 天 ${h % 24} 小时` : `${d} 天`
}

/**
 * Why an account cannot trade yet, in one line. The market and the swap
 * screen both say it, and a refused request carries the same four numbers.
 */
export function gateText(reply: object): string {
  const g = reply as { need?: unknown; have?: unknown; days?: unknown; wait?: unknown }
  const need = Number(g.need) || 0
  const pulls = Math.max(0, need - (Number(g.have) || 0))
  const days = Number(g.days) || 3
  const wait = Math.max(0, Number(g.wait) || 0)
  if (pulls && wait) return `新账号要建满 ${days} 天、开够 ${need} 抽才能交易：还差 ${pulls} 抽，还要等 ${waitText(wait)}。`
  if (wait) return `新账号要建满 ${days} 天才能交易，还要等 ${waitText(wait)}。`
  return `开够 ${need} 抽才能交易，还差 ${pulls} 抽。`
}

/** How many of other people's listings one page of the shelf holds — mirrored
 *  from the server, which is what actually decides it. */
export const SHELF_PAGE = 60
/** The orders the shelf can be read in — mirrored from the server. */
export const SHELF_SORTS = ['ends', 'new', 'price', 'price_desc'] as const
export type ShelfSort = (typeof SHELF_SORTS)[number]

/**
 * What to ask the shelf for. Everything here is applied by the SERVER, before
 * the page is cut: filtering a page that has already arrived is filtering
 * whatever that page happened to hold, which on a market of fourteen hundred
 * cards is a twelfth of it.
 */
export interface ShelfQuery {
  sort?: ShelfSort
  /** where the last page stopped; leave it out for the first */
  cursor?: string
  rarity?: string
  region?: string
  role?: string
  club?: string
  q?: string
  priceMin?: number
  priceMax?: number
  /** leave out the cards you already hold at that level or higher */
  unowned?: boolean
}

export interface ShelfPage {
  ok: boolean
  /** one page of other people's listings */
  listings: Listing[]
  /** all of your own, on the first page only — they are outside the paging */
  own: Listing[]
  /** hand it back to get the next page; null at the end of the shelf */
  next: string | null
  sort: ShelfSort
  gate: Gate | null
  haggle: number
  /** first page only: how many listings are open in all */
  total?: number
  /** first page only: every card with something of it on the market, and how
   *  many — what the filter menus are built from, so they cascade over the
   *  whole market rather than over the page you happen to be looking at */
  pool?: [string, number][]
  hours?: number; step?: number; snipe?: number; buyoutMin?: number; now?: number; page?: number
}

export const browseMarket = (q: ShelfQuery = {}) => post<ShelfPage>('browse', { ...q })

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
export const listCardOnMarket = (cardId: string, ask: number, level: number, rarity: string, buyout: number | null = null, hours = AUCTION_HOURS) =>
  post<WithState>('list', { cardId, ask, level, rarity, buyout, hours })

/** How many listings one seller may have open at once — mirrored from the server. */
export const MAX_LISTINGS = 3
/** The auction, mirrored from the server: a day on the clock, five percent a step,
 *  ten minutes' grace at the end, and a buy-now price at least a fifth over the start. */
export const AUCTION_HOURS = 24
/** the seller picks how long it runs, from these */
export const AUCTION_HOURS_CHOICES = [2, 4, 6, 8, 12, 24]
export const BID_STEP = 0.05
export const SNIPE_MINUTES = 10
export const BUYOUT_MIN = 1.2
/** The least the next bid may be — the start until somebody bids, a step over the top after. */
export const minBidOf = (ask: number, top: number | null): number =>
  (top == null ? ask : Math.max(ask, Math.ceil(top * (1 + BID_STEP))))

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
