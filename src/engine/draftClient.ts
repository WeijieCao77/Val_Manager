/** The 选秀夜 page's side of draft-api.js. Nothing drafted reaches the collection. */
import { api } from './account'
import { rememberedId } from './cardid'
import type { DraftAward, DraftBid, DraftStanding } from './draft'
import type { Role } from './types'

export interface DraftSeat { seat: number; name: string; tag: string; budget: number; picks: string[]; bidIn: boolean; me: boolean; host: boolean }
export interface DraftRound { round: number; lot: string[]; bids: (DraftBid & { auto?: boolean })[]; awards: DraftAward[] }
export interface DraftGameRow { a: number; b: number; aWon: boolean; mapsA: number; mapsB: number; maps: { map: string; a: number; b: number }[] }
export interface DraftRoom {
  code: string; status: 'lobby' | 'bidding' | 'playing' | 'done'; round: number; rounds: number; position: Role | null
  lot: string[] | null; deadline: number | null; host: boolean
  seats: DraftSeat[]; mySeat: number | null; myBid: DraftBid | null
  history: DraftRound[]; games: DraftGameRow[] | null; table: DraftStanding[] | null
}
export interface DraftState { ok: true; now: number; min: number; max: number; budget: number; bidSec: number; positions: Role[]; room?: DraftRoom }
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
