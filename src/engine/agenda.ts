import { squadOf, wageBill } from './world'
import { windowOpen } from './transfer'
import { nextFixtureFor, stageName } from './season'
import type { GameState, StageKey } from './types'

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
        items.push({ key: 'market', tone: 'todo', go: 'transfers', text: '转会窗口开放中，这是补强阵容的主要机会。' })
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
      if (open) items.push({ key: 'window', tone: 'todo', go: 'transfers', text: '短期转会窗口开放中。' })
      break
    case 'offseason':
      items.push({ key: 'renew', tone: 'todo', go: 'squad', text: '休赛期：处理续约、清理阵容。' })
      items.push({ key: 'market2', tone: 'todo', go: 'transfers', text: '转会窗口开放，为下赛季重建阵容。' })
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

  return items.slice(0, 5)
}
