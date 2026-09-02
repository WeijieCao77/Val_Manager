import { createContext, useContext } from 'react'
import type { GachaState } from '../../engine/gacha'
import type { ActOutcome } from '../../engine/account'

export interface CardCtxValue {
  g: GachaState
  /** the server's date, which is what the check-in and the quest board run on */
  today: string
  /**
   * The server's clock, re-read every half minute.
   *
   * 体力 comes back by the hour, so the screens need a moment that moves on
   * its own — otherwise the countdown sits still and the button stays greyed
   * out for a minute after the point has actually landed.
   */
  now: number
  /** false when the server cannot be reached: the collection is read-only until it can */
  cloud: boolean
  /**
   * Re-render and write the cosmetic fields back; pass true to skip the debounce.
   *
   * Resolves once the write has had its turn, which is what the leaderboard
   * needs before it reads the server back.
   */
  commit: (immediate?: boolean) => Promise<void>
  /**
   * Do something that counts — open a pack, check in, play a match.
   *
   * Runs on the server, which hands the account back; the screen re-renders
   * from that. Resolves to the action's own result, or to a reason written
   * for the player. Nothing of value is ever changed locally.
   */
  act: (action: string, args?: Record<string, unknown>) => Promise<ActOutcome>
  toast: (msg: string) => void
  /** open the reference page for a real player */
  openDossier: (playerId: string) => void
  go: (tab: string) => void
}

export const CardCtx = createContext<CardCtxValue | null>(null)

export function useCards(): CardCtxValue {
  const v = useContext(CardCtx)
  if (!v) throw new Error('useCards must be used inside CardCtx')
  return v
}
