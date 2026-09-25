/**
 * Retired players the game can show: in a 2023–2025 world, not in the 2026
 * one, no club and no match for a year (or on a bench now), and a photograph
 * on file. Built by scripts/build_retired.py from people.json and the
 * historical worlds; nobody here is invented, and an age without a birthdate
 * on any site is carried from the historical world and marked estimated.
 *
 * Used by the 资料库's 退役 list and by the 每日挑战 player pool, which had
 * been answered from the same 2026 rosters long enough to be learned by heart.
 */
import RAW from '../data/retired.json'
import type { Region, Role } from './types'

export interface RetiredPlayer {
  /** Hv<vlr id>, the id the historical worlds and the dossier's `hist` use */
  id: string
  ign: string
  real: string | null
  nat: string | null
  region: Region
  birth: string | null
  /** on 1 January 2026, the way every rostered player's age is counted */
  age: number
  ageEstimated: boolean
  role: Role
  roles?: Role[]
  /** best overall he had in any historical world, and where */
  peak: number
  peakYear: number
  peakClub: string | null
  lastYear: number
  lastClub: string | null
  /** played on a tier-one roster at some point */
  tier1: boolean
  /** on a staff now rather than simply gone */
  coach: boolean
  img: string
}

export const RETIRED: RetiredPlayer[] = (RAW as unknown as { players: RetiredPlayer[] }).players ?? []
export const RETIRED_BY_ID = new Map(RETIRED.map((r) => [r.id, r]))
