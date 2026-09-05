import { createContext, useContext } from 'react'
import type { Fixture, GameState } from '../engine/types'

export interface GameCtxValue {
  game: GameState
  /** re-render after the engine mutated state in place, and autosave */
  commit: () => void
  toast: (msg: string) => void
  /**
   * Open a player's card. `renew` opens it straight onto the renewal panel,
   * for the squad row's 续约 button — the contract column showed 到期 with only
   * a 解约 next to it, so the one destructive action was in reach and the
   * constructive one was behind an unlabelled click on the player's name.
   */
  openPlayer: (id: string, renew?: boolean) => void
  /** replace the running game with a loaded save */
  loadSlot: (slot: string) => void
  openMatch: (f: Fixture) => void
  /** hand a fixture to the live match view (watch or skip) */
  playLive: (f: Fixture) => void
  go: (screen: string) => void
  /** replay the guided trial day without reloading the page */
  startTutorial: () => void
  /** open a draw's ceremony — reveal it, or make the pick it is waiting on */
  openDraw: (id: string) => void
}

export const GameCtx = createContext<GameCtxValue | null>(null)

export function useGame(): GameCtxValue {
  const v = useContext(GameCtx)
  if (!v) throw new Error('useGame must be used inside GameCtx')
  return v
}
