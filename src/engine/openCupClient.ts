/**
 * The 全服杯 page's side of opencup-api.js: five reads and writes, none of
 * which touches the account — the prize arrives through the inbox like
 * everything else the server hands over.
 */
import { api } from './account'
import { rememberedId } from './cardid'
import type { ArenaLine } from './arena'

export interface OpenCupWho { name: string; tag: string; score: number | null }
export interface OpenCupFive { slots: (string | null)[]; coach: string | null; levels: Record<string, number>; chemistry?: number; power?: number; paper?: { score: number; mean: number; growth: number; lift: number; chem: number; short: number; uncalled: number }; cardPoolVersion?: string }
export interface OpenCupMatchRow {
  round: number
  stage?: 'swiss' | 'playin' | 'playoff' | 'knockout'
  stageRound?: number
  bo?: 3 | 5
  slot: number
  a: OpenCupWho
  b: OpenCupWho | null
  bye: boolean
  played: boolean
  aWon: boolean | null
  mapsA: number | null
  mapsB: number | null
  /** which side the asker was, on rows from their own run */
  mine?: 'a' | 'b'
}
export interface OpenCupMine {
  alive: boolean
  wins: number
  swissWins?: number
  swissLosses?: number
  swissRealWins?: number
  playoffWins?: number
  playoffSeed?: number | null
  byes?: number
  /** −1: the five was not whole when the cup started */
  outRound: number | null
  place: number | null
  score: number | null
  matches: OpenCupMatchRow[]
}
export interface OpenCupRow {
  id: string
  format?: number
  phase?: string
  stageRound?: number
  playoffRounds?: number
  starts: number
  status: 'open' | 'live' | 'done' | 'void'
  round: number
  rounds: number
  stepSec: number
  entrants: number
  nextAt: number | null
}
export interface OpenCupBoardRow { rank: number; name: string; tag: string; titles: number; me: boolean }
export interface OpenCupState {
  ok: true
  now: number
  next: (OpenCupRow & { signed: number; joined?: boolean }) | null
  live: (OpenCupRow & { alive: number; top: OpenCupMatchRow[]; me?: OpenCupMine | null }) | null
  last: (OpenCupRow & {
    champion: (OpenCupWho & { five: OpenCupFive | null }) | null
    top: OpenCupMatchRow[]
    me?: OpenCupMine | null
  }) | null
  recent: { id: string; starts: number; entrants: number; void: boolean; champion: { name: string; tag: string } | null }[]
  boards: { day: string; today: OpenCupBoardRow[]; all: OpenCupBoardRow[] }
  titles?: { today: number; all: number }
}
export interface OpenCupSideDetail { lines: ArenaLine[]; mvpCard: string | null }
export interface OpenCupMatchDetail {
  format?: number
  stage?: 'swiss' | 'playin' | 'playoff' | 'knockout'
  stageRound?: number
  playoffRounds?: number
  ok: true
  round: number
  rounds: number
  aWon: boolean
  mapsA: number
  mapsB: number
  a: (OpenCupWho & { five: OpenCupFive }) | null
  b: (OpenCupWho & { five: OpenCupFive }) | null
  detail: { bo: 3 | 5; maps: { map: string; a: number; b: number }[]; a: OpenCupSideDetail; b: OpenCupSideDetail }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T | { ok: false; why?: string }> {
  try {
    const r = await fetch(api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rememberedId(), ...body }),
    })
    if (r.status === 429) return { ok: false, why: '点得太快了，等一下再试。' }
    const j = await r.json().catch(() => null)
    if (j && typeof j === 'object') return j as T
    return { ok: false, why: '服务器没有回应。' }
  } catch {
    return { ok: false, why: '连不上服务器。' }
  }
}

export const fetchOpenCup = () => post<OpenCupState>('opencup', {})
export const joinOpenCup = () => post<{ ok: true; starts: number; score: number }>('opencup/join', {})
export const leaveOpenCup = () => post<{ ok: true }>('opencup/leave', {})
export const fetchOpenCupMatch = (cup: string, round: number, slot: number) =>
  post<OpenCupMatchDetail>('opencup/match', { cup, round, slot })
export const fetchOpenCupById = (cup: string) =>
  post<{ ok: true; cup: OpenCupRow & { top: OpenCupMatchRow[]; me: OpenCupMine | null } }>('opencup/cup', { cup })

export const fetchOpenCupSchedule = (cup: string, stage: string | null, cursor: [number, number] | null = null) =>
  post<{ ok: true; rows: OpenCupMatchRow[]; next: [number, number] | null }>('opencup/schedule', { cup, stage, cursor })

export interface SwissStanding extends OpenCupWho { wins: number; losses: number; realWins: number; byes: number; alive: boolean; seed: number | null }
export const fetchOpenCupStandings = (cup: string, wins: number | null, losses: number | null, offset = 0) =>
  post<{ ok: true; rows: SwissStanding[]; next: number | null }>('opencup/standings', { cup, wins, losses, offset })
