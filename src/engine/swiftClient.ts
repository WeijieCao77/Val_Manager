/** The 抢五 page's side of swift-api.js. Nothing here touches the account: wins pay through the inbox. */
import { api } from './account'
import { rememberedId } from './cardid'
import type { Choice, Plan, SwiftView } from './swift'
import type { CupPick } from './openCupClient'

export interface SwiftBoardRow { rank: number; name: string; tag: string; rating: number; played: number; won: number; h: string }
export interface SwiftMatchView {
  id: string
  kind: 'live' | 'ghost' | 'ai'
  status: 'live' | 'done'
  /** when this phase's clock runs out (server time); null once it is over */
  deadline: number | null
  opponent: { name: string; tag: string }
  view: SwiftView
  ratings: { before: number; after: number; delta: number; coins?: number } | null
}
export interface SwiftState {
  ok: true; now: number; waitSec: number; paidWins: number; winCoins: number
  board: SwiftBoardRow[]
  me?: { rating: number; played: number; won: number; dayWins: number; h: string }
  queue?: { since: number }
  match?: SwiftMatchView
}
type Fail = { ok: false; why?: string; match?: SwiftMatchView }

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T | Fail> {
  try {
    const r = await fetch(api(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rememberedId(), ...body }) })
    if (r.status === 429) return { ok: false, why: '点得太快了，等一下再试。' }
    const j = await r.json().catch(() => null)
    return j && typeof j === 'object' ? j as T : { ok: false, why: '服务器没有回应。' }
  } catch { return { ok: false, why: '连不上服务器。' } }
}
export const swiftState = (match?: string) => post<SwiftState>('swift', match ? { match } : {})
export const swiftQueue = (squad: CupPick) => post<{ ok: true; match?: string; already?: boolean }>('swift/queue', { squad })
export const swiftLeave = (match?: string, resign = false) => post<{ ok: true }>('swift/leave', { match, resign })
export const swiftCall = (match: string, round: number, choice: Choice) => post<{ ok: true; match: SwiftMatchView }>('swift/call', { match, round, choice })
export const swiftRecon = (match: string, plan: Plan) => post<{ ok: true; match: SwiftMatchView }>('swift/recon', { match, plan })
export const swiftPause = (match: string) => post<{ ok: true; match: SwiftMatchView }>('swift/pause', { match })
