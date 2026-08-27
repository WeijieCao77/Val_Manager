import { createContext, useContext } from 'react'
import type { GachaState } from '../../engine/gacha'

export interface CardCtxValue {
  g: GachaState
  /** the server's date, which is what the check-in and the quest board run on */
  today: string
  /** false when the collection is only in this browser */
  cloud: boolean
  /** re-render and write the collection back; pass true to skip the debounce */
  commit: (immediate?: boolean) => void
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
