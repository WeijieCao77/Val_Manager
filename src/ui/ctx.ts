import { createContext, useContext } from 'react'
import type { Fixture, GameState } from '../engine/types'

export interface GameCtxValue {
  game: GameState
  /** re-render after the engine mutated state in place, and autosave */
  commit: () => void
  toast: (msg: string) => void
  openPlayer: (id: string) => void
  openMatch: (f: Fixture) => void
  /** hand a fixture to the live match view (watch or skip) */
  playLive: (f: Fixture) => void
  go: (screen: string) => void
  /** replay the guided trial day without reloading the page */
  startTutorial: () => void
}

export const GameCtx = createContext<GameCtxValue | null>(null)

export function useGame(): GameCtxValue {
  const v = useContext(GameCtx)
  if (!v) throw new Error('useGame must be used inside GameCtx')
  return v
}
