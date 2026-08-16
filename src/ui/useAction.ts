import { useGame } from './ctx'
import { NO_ACTIONS_LEFT, spendAction } from '../engine/actions'
import type { ActionKind } from '../engine/actions'

/**
 * Wrap an outward-facing action in the day's budget.
 *
 * Returns a function that runs `fn` only if a point was available, so a screen
 * can never perform the work and forget to pay for it.
 */
export function useAction(): (kind: ActionKind, fn: () => void) => void {
  const { game, toast, commit } = useGame()
  return (kind, fn) => {
    if (!spendAction(game, kind)) {
      toast(NO_ACTIONS_LEFT)
      return
    }
    fn()
    commit()
  }
}
