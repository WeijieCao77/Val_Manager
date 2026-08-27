import { createContext, useContext } from 'react'
import type { GachaState } from '../../engine/gacha'

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
