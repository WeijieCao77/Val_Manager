import { squadOf, wageBill } from './world'
import { windowOpen, TRANSFER_WINDOWS } from './transfer'
import { nextFixtureFor, stageName } from './season'
import type { Activity, GameState, StageKey } from './types'

/** Record something the manager did today. */
export function logActivity(state: GameState, kind: Activity['kind'], text: string): void {
  state.activity ??= []
  // one line per distinct action per day; repeating an action just updates it
  const existing = state.activity.find((a) => a.day === state.day && a.text === text)
  if (existing) return
  state.activity.push({ day: state.day, kind, text })
  if (state.activity.length > 300) state.activity.splice(0, state.activity.length - 300)
}

export const activityOn = (state: GameState, day: number): Activity[] =>
  (state.activity ?? []).filter((a) => a.day === day)

/**
 * What actually deserves the manager's attention right now.
 *
 * The problem this solves is that every screen is always available, so the game
 * never says what today is for. Rather than adding a tutorial, the current
 * phase is asked what it wants, and anything genuinely urgent is raised on top.
 */
export interface AgendaItem {
  key: string
  text: string
  /** screen to jump to */
  go?: string
  tone: 'urgent' | 'todo' | 'info'
}

/** Which screens are meaningful during a given phase. */
export const SCREEN_PHASES: Record<string, { always?: boolean; stages?: StageKey[] }> = {
  dashboard: { always: true },
  squad: { always: true },
  tactics: { always: true },
  training: { always: true },
  schedule: { always: true },
  standings: { always: true },
  finance: { always: true },
  saves: { always: true },
  // the market is the one screen that genuinely closes
  transfers: { stages: ['preseason', 'masters2', 'offseason'] },
}

/**
 * Days left in the window that is currently open, or null when it is shut.
 *
 * Worth saying out loud because a turn is not a day: preseason moves a week at
 * a time and the window is 21 days, so three clicks of 推进 spend the whole of
 * it. "转会窗口开放中" one turn and gone the next is not a warning.
 */
export function windowDaysLeft(state: GameState): number | null {
  const w = TRANSFER_WINDOWS.find(([a, b]) => state.day >= a && state.day <= b)
  return w ? w[1] - state.day + 1 : null
}

export function screenLocked(screen: string, state: GameState): string | null {
  if (screen !== 'transfers') return null
  if (windowOpen(state.day)) return null
  const next = [0, 169, 311].find((d) => d > state.day)
  return next
    ? `转会窗口关闭中，${next - state.day} 天后开启`
    : '转会窗口本赛季已关闭'
}

export function agendaFor(state: GameState): AgendaItem[] {
  const items: AgendaItem[] = []
  const me = state.teams[state.myTeam]
  if (!me) return items
  const squad = squadOf(state, state.myTeam)
  const open = windowOpen(state.day)

  // the board's standing ask for this stage leads, when there is one
  if (state.objective && !state.objective.settled) {
    items.push({ key: 'objective', tone: 'info', go: 'standings', text: state.objective.text })
  }

  if (state.onNotice) {
    items.push({
      key: 'notice', tone: 'urgent', go: 'standings',
      text: '董事会已经警告过你——这个赛段交不出成绩就会被解约。',
    })
  }

  // ---- urgent: things that are actively costing you
  if (squad.length < 5) {
    items.push({
      key: 'thin', tone: 'urgent', go: 'transfers',
      text: `阵容只有 ${squad.length} 人，无法正常出战，必须补人。`,
    })
  }
  const expiring = squad.filter((p) => p.contractYears <= 0)
  if (expiring.length) {
    items.push({
      key: 'expiring', tone: 'urgent', go: 'squad',
      text: `${expiring.map((p) => p.ign).join('、')} 合同已到期，再不续约就会走人。`,
    })
  }
  const unhappy = squad.filter((p) => (p.grievance ?? 0) > 45)
  if (unhappy.length) {
    items.push({
      key: 'unhappy', tone: 'urgent', go: 'squad',
      text: `${unhappy.map((p) => p.ign).join('、')} 对出场时间不满，兑现承诺或考虑出售。`,
    })
  }
  if (state.finances.balance < 0) {
    items.push({
      key: 'broke', tone: 'urgent', go: 'finance',
      text: '资金已经为负，董事会不会容忍太久。',
    })
  }
  const injured = squad.filter((p) => p.injuredUntil > state.day)
  if (injured.length && me.starters.some((id) => injured.some((p) => p.id === id))) {
    items.push({
      key: 'injured', tone: 'urgent', go: 'squad',
      text: `首发中有 ${injured.length} 人伤停，需要调整阵容。`,
    })
  }

  // ---- what this phase is for
  switch (state.stage) {
    case 'preseason':
      if (open) {
        const left = windowDaysLeft(state)
        items.push({
          key: 'market', tone: 'todo', go: 'transfers',
          text: `转会窗口开放中（还剩 ${left} 天，一回合走 7 天），这是补强阵容的主要机会。`,
        })
      }
      items.push({ key: 'plan', tone: 'todo', go: 'training', text: '为本赛季设定训练重点，赛段中途改动收益有限。' })
      items.push({ key: 'tac', tone: 'todo', go: 'tactics', text: '确认战术风格与首发五人。' })
      break
    case 'kickoff':
    case 'stage1':
    case 'stage2':
      items.push({ key: 'lineup', tone: 'todo', go: 'squad', text: '赛段进行中，主要工作是轮换阵容、控制体能。' })
      items.push({ key: 'table', tone: 'info', go: 'standings', text: '关注积分榜，前 8 名才能进季后赛。' })
      break
    case 'masters1':
    case 'masters2':
    case 'champions':
      items.push({ key: 'intl', tone: 'info', go: 'standings', text: `${stageName(state.stage)} 期间，没有你的比赛时可以安排训练赛。` })
      if (open) {
        items.push({
          key: 'window', tone: 'todo', go: 'transfers',
          text: `短期转会窗口开放中，还剩 ${windowDaysLeft(state)} 天。`,
        })
      }
      break
    case 'offseason':
      items.push({ key: 'renew', tone: 'todo', go: 'squad', text: '休赛期：处理续约、清理阵容。' })
      items.push({
        key: 'market2', tone: 'todo', go: 'transfers',
        text: `转会窗口开放，为下赛季重建阵容（还剩 ${windowDaysLeft(state)} 天）。`,
      })
      break
    default:
      break
  }

  // ---- the gap between fixtures is a decision too
  const next = nextFixtureFor(state, state.myTeam)
  const gap = next ? next.day - state.day : 0
  if (gap >= 4) {
    items.push({
      key: 'scrim', tone: 'todo', go: 'dashboard',
      text: `距下一场还有 ${gap} 天，可以安排训练赛保持状态。`,
    })
  }

  // ---- a standing money problem, stated once
  const bill = wageBill(state, state.myTeam)
  if (bill > me.budget * 0.9 && state.finances.balance >= 0) {
    items.push({ key: 'wages', tone: 'info', go: 'finance', text: '薪资支出偏高，注意现金流。' })
  }

  const pending = state.offers.filter((o) => o.status === 'pending' && o.toTeam === state.myTeam)
  if (pending.length) {
    items.push({
      key: 'offers', tone: 'info', go: 'transfers',
      text: `${pending.length} 份报价等待对方答复。`,
    })
  }

  // Bids for our own players are a decision with a deadline: unanswered, they
  // expire after seven days and the digest reports a withdrawal for an offer
  // the manager was never shown. They stay on the list until answered.
  const incoming = state.offers.filter(
    (o) => o.status === 'pending' && o.fromTeam === state.myTeam && o.toTeam !== state.myTeam,
  )
  if (incoming.length) {
    const soonest = Math.min(...incoming.map((o) => o.day + 7 - state.day))
    items.push({
      key: 'incoming', tone: 'todo', go: 'transfers',
      text: `收到 ${incoming.length} 份对我方选手的报价，`
        + `${soonest <= 0 ? '今天就要答复' : `最快 ${soonest} 天后失效`}——不答复视为拒绝。`,
    })
  }

  // commercial work has to be booked before the day arrives, so surface it
  const gigs = (state.gigs ?? []).filter((g) => !g.done && g.day >= state.day)
  const unbooked = gigs.filter((g) => !g.accepted)
  if (unbooked.length) {
    const soon = unbooked.reduce((a, b) => (a.day < b.day ? a : b))
    items.push({
      key: 'gig',
      text: `有 ${unbooked.length} 个商务邀约待处理，最近的是${soon.label}（${soon.day - state.day} 天后）`,
      tone: soon.day - state.day <= 2 ? 'urgent' : 'todo',
      go: 'commercial',
    })
  }
  const today = gigs.find((g) => g.accepted && g.day === state.day)
  if (today) {
    items.push({ key: 'gig-today', text: `今天有${today.label}（${today.partner}）`, tone: 'info', go: 'commercial' })
  }

  return items.slice(0, 5)
}
