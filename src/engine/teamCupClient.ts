/** The 组队杯 page's side of teamcup-api.js. Nothing here touches the account: the purse arrives through the inbox. */
import { api } from './account'
import { rememberedId } from './cardid'
import type { TeamPrize } from './teamCup'

export interface TeamWho { name: string; tag: string; score: number | null; me: boolean }
export interface TeamMember extends TeamWho { duels: number; duelWins: number }
export interface TeamDuel { a: TeamWho; b: TeamWho; aWon: boolean; mapsA: number; mapsB: number }
export interface TeamTie {
  round: number; slot: number; teamA: number; teamB: number | null; bye: boolean; played: boolean
  winsA: number | null; winsB: number | null; winner: number | null; duels: TeamDuel[]
}
export interface TeamCupRow {
  id: string; starts: number; status: 'open' | 'live' | 'done' | 'void'; round: number; rounds: number
  stepSec: number; entrants: number; teams: number; champion: number | null; nextAt: number | null
}
export interface TeamCupMine {
  seated: boolean; team?: number; place?: number | null; duels?: number; duelWins?: number; alive?: boolean
  members?: TeamMember[]; ties?: TeamTie[]; prize?: TeamPrize | null; coins?: number
}
export interface TeamCupState {
  ok: true; now: number; size: number; hours: number[]; duelCoins: number
  next: (TeamCupRow & { signed: number; joined?: boolean }) | null
  live: (TeamCupRow & { me?: TeamCupMine | null }) | null
  last: (TeamCupRow & { me?: TeamCupMine | null; final?: { tie: TeamTie; champions: TeamMember[] } | null }) | null
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
export const teamCupState = () => post<TeamCupState>('teamcup')
export const teamCupJoin = () => post<{ ok: true; starts: number; score: number; already?: boolean }>('teamcup/join')
export const teamCupLeave = () => post<{ ok: true }>('teamcup/leave')
