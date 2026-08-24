import { useGame } from './ctx'
import { track } from '../engine/telemetry'
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
      // running out of points is a design signal, not a mistake: if most
      // people hit this every turn the budget is too tight
      track('action_spend', { kind, ok: false, day: game.day })
      return
    }
    // Every outward-facing action goes through here, so this one line covers
    // transfers, scouting, commercial, staff and scrims at once. Instrumenting
    // the screens instead would mean a new screen silently reports nothing.
    track('action_spend', { kind, ok: true, day: game.day, stage: game.stage })
    fn()
    commit()
  }
}
