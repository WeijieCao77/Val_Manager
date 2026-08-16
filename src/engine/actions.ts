import type { GameState } from './types'

/**
 * The manager's day.
 *
 * Every system in the game is worth using, which was exactly the problem: with
 * everything available every day, there was no reason not to do all of it, and
 * a browser game turned into a checklist. A daily budget does not remove
 * options — it makes choosing between them the interesting part.
 *
 * Only outward-facing work costs anything: deals, people, bookings. Setting
 * your own line-up or tactics is free, because a manager should never field a
 * worse five to save an errand, and because those are the decisions players
 * most want to fiddle with.
 */
export const ACTIONS_PER_DAY = 3

export type ActionKind =
  | 'offer' | 'reply' | 'list' | 'release'
  | 'gig' | 'sponsor' | 'venture' | 'stream'
  | 'scrim' | 'staff' | 'facility'

export const ACTION_CN: Record<ActionKind, string> = {
  offer: '提交报价', reply: '答复报价', list: '挂牌/撤牌', release: '解约',
  gig: '安排商务活动', sponsor: '拜访赞助商', venture: '筹备俱乐部活动',
  stream: '直播合同', scrim: '约训练赛', staff: '教练组', facility: '设施升级',
}

function slot(state: GameState): { day: number; used: number } {
  if (!state.actions || state.actions.day !== state.day) {
    state.actions = { day: state.day, used: 0 }
  }
  return state.actions
}

export function actionsLeft(state: GameState): number {
  return Math.max(0, ACTIONS_PER_DAY - slot(state).used)
}

export function canAct(state: GameState): boolean {
  return actionsLeft(state) > 0
}

/**
 * Spend one. Returns false when the day is already full, and the caller is
 * expected to abandon the action rather than perform it for free.
 */
export function spendAction(state: GameState, _kind: ActionKind): boolean {
  const s = slot(state)
  if (s.used >= ACTIONS_PER_DAY) return false
  s.used += 1
  return true
}

export const NO_ACTIONS_LEFT = '今天的行动力已经用完了，推进一天再继续。'
