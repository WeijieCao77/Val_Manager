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
/**
 * The budget for one turn.
 *
 * The first version gave three a day regardless, which had it backwards: in
 * season the transfer window is shut and commercial work risks condition before
 * a fixture, so two of the three went unused — while a downtime week, with the
 * window open and every negotiation available, was squeezed into the same
 * three. The budget now follows how much there actually is to do.
 */
export const ACTIONS_IN_SEASON = 2
export const ACTIONS_PER_WEEK = 4

export function actionsForTurn(state: GameState): number {
  return cycleDays(state) > 1 ? ACTIONS_PER_WEEK : ACTIONS_IN_SEASON
}

export type ActionKind =
  | 'offer' | 'reply' | 'list' | 'release'
  | 'gig' | 'sponsor' | 'venture' | 'stream'
  | 'scrim' | 'staff' | 'facility'
  | 'league' | 'persuade'

export const ACTION_CN: Record<ActionKind, string> = {
  offer: '提交报价', reply: '答复报价', list: '挂牌/撤牌', release: '解约',
  gig: '安排商务活动', sponsor: '拜访赞助商', venture: '筹备俱乐部活动',
  stream: '直播合同', scrim: '约训练赛', staff: '教练组', facility: '设施升级',
  league: '和联盟谈判', persuade: '挽留选手',
}

/**
 * How many days one turn covers.
 *
 * In-season a day is a day: matches are close together and what you do on any
 * given one matters. In a long gap — preseason, between splits — clicking
 * through three weeks one day at a time is just work, so a turn becomes a week
 * and the same three actions cover it.
 */
export function cycleDays(state: GameState): number {
  // the trial day is a day, whatever the calendar would otherwise say
  if (state.tutorialDay) return 1
  const next = state.fixtures
    .filter((f) => !f.played && f.comp !== 'scrim' &&
      (f.teamA === state.myTeam || f.teamB === state.myTeam))
    .sort((a, b) => a.day - b.day)[0]
  const gap = next ? next.day - state.day : 99
  if (gap < 7) return 1
  // Inside an international the draw arrives one round at a time, so a side
  // that has just qualified from the Swiss round has no fixture for four days
  // and was handed a week-long turn with the off-season's budget. The event
  // is the season's sharpest week; it runs a day at a time.
  const inEvent = (['masters1', 'masters2', 'champions'] as const).some((k) => {
    const c = state.comps[k]
    return !!c && !c.champion && c.teams.includes(state.myTeam) && !c.finished.includes(state.myTeam)
  })
  return inEvent ? 1 : 7
}

function slot(state: GameState): { day: number; used: number } {
  const span = cycleDays(state)
  // the budget belongs to the turn, not the date, so advancing a day at a time
  // inside a week-long turn does not hand out three fresh actions each morning
  if (!state.actions || state.day < state.actions.day || state.day >= state.actions.day + span) {
    state.actions = { day: state.day, used: 0 }
  }
  return state.actions
}

export function actionsLeft(state: GameState): number {
  return Math.max(0, actionsForTurn(state) - slot(state).used)
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
  if (s.used >= actionsForTurn(state)) return false
  s.used += 1
  return true
}

export const NO_ACTIONS_LEFT = '今天的行动力已经用完了，推进一天再继续。'
