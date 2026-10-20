/** The 抢人大战 page's side of draft-api.js. Nothing drafted reaches the collection. */
import { api } from './account'
import { rememberedId } from './cardid'
import type { DraftAward, DraftBid, DraftStanding } from './draft'
import type { Role } from './types'

export interface DraftSeat { seat: number; name: string; tag: string; budget: number; picks: string[]; bidIn: boolean; me: boolean; host: boolean; place: number | null }
export interface DraftRound { round: number; lot: string[]; bids: (DraftBid & { auto?: boolean })[]; awards: DraftAward[] }
export interface DraftGameRow { a: number; b: number; aWon: boolean; mapsA: number; mapsB: number; maps: { map: string; a: number; b: number }[] }
export interface DraftRoom {
  code: string; status: 'lobby' | 'bidding' | 'playing' | 'showing' | 'done'; round: number; rounds: number; position: Role | '教练' | null
  lot: string[] | null; deadline: number | null; host: boolean
  seats: DraftSeat[]; mySeat: number | null; myBid: DraftBid | null
  history: DraftRound[]; games: DraftGameRow[] | null; table: DraftStanding[] | null
  /** the BO5 final: while it is on screen, only the maps shown so far */
  final: (Partial<DraftGameRow> & { a: number; b: number; maps: { map: string; a: number; b: number }[]; done?: boolean }) | null
  /** when the broadcast shows its next match or map */
  nextAt: number | null
  /** 3rd v 4th, 5th v 6th, as far as the broadcast has shown them */
  placements: (DraftGameRow & { place: number })[] | null
  /** the match on air: its maps play out on screen between from and to (the final: one map at a time, mapsDone already shown) */
  live: { label: string; a: number; b: number; maps: { map: string; a: number; b: number }[]; mapsDone: number; from: number; to: number } | null
  /** the lineups' entrance: when the broadcast began, seconds per seat */
  revealAt: number | null
  introSec: number
  failed: boolean
  /** a finished room: my place and what it paid; unpaid says why not (small, cap, gate) */
  reward: { place: number | null; coins: number; unpaid: 'idle' | 'small' | 'cap' | 'gate' | null } | null
}
export interface DraftState {
  ok: true; now: number; min: number; max: number; budget: number; bidSec: number; positions: (Role | '教练')[]
  prizes: number[]; paidMin: number; paidRooms: number; room?: DraftRoom
}
type Fail = { ok: false; why?: string }

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T | Fail> {
  try {
    const r = await fetch(api(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rememberedId(), ...body }) })
    if (r.status === 429) return { ok: false, why: '点得太快了，等一下再试。' }
    const j = await r.json().catch(() => null)
    return j && typeof j === 'object' ? j as T : { ok: false, why: '服务器没有回应。' }
  } catch { return { ok: false, why: '连不上服务器。' } }
}
export const draftState = () => post<DraftState>('draft')
export const draftCreate = () => post<{ ok: true; code: string }>('draft/create')
export const draftJoin = (code: string) => post<{ ok: true; code: string }>('draft/join', { code })
export const draftLeave = () => post<{ ok: true }>('draft/leave')
export const draftStart = () => post<{ ok: true; room: DraftRoom }>('draft/start')
export const draftBid = (round: number, bid: DraftBid) => post<{ ok: true; room: DraftRoom }>('draft/bid', { round, bid })
