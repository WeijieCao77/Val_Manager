import { squadOf, wageBill } from './roster'
import { windowOpen, TRANSFER_WINDOWS } from './transfer'
import { nextFixtureFor, noticeHint, stageName } from './season'
import { gigWindow } from './commercial'
import { nextInEvent, qualification, upcomingInternational } from './qualify'
import type { Activity, GameState, StageKey } from './types'

/** Record something the manager did today. */
export function logActivity(state: GameState, kind: Activity['kind'], text: string): void {
  state.activity ??= []
  // one line per distinct action per day; repeating an action just updates it
  const existing = state.activity.find(
    (a) => a.day === state.day && (a.year ?? state.year) === state.year && a.text === text)
  if (existing) return
  state.activity.push({ day: state.day, year: state.year, kind, text })
  if (state.activity.length > 300) state.activity.splice(0, state.activity.length - 300)
}

/**
 * What was done on a given day OF THIS SEASON.
 *
 * The clock resets every new year while the log deliberately keeps its old
 * entries, so matching on day alone showed last season's errands under
 * today's heading. Entries written before this carried no year; treat them as
 * belonging to whatever season they are being read in, which is the old
 * behaviour and cannot make an existing save worse.
 */
export const activityOn = (state: GameState, day: number): Activity[] =>
  (state.activity ?? []).filter((a) => a.day === day && (a.year ?? state.year) === state.year)

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
  transfers: { stages: ['preseason', 'masters1', 'masters2', 'offseason'] },
}

/**
 * Days left in the window that is currently open, or null when it is shut.
 *
 * Worth saying out loud because a turn is not a day: preseason moves a week at
 * a time and the window is 21 days, so three clicks of 推进 spend the whole of
 * it. "转会窗口开放中" one turn and gone the next is not a warning.
 */
export function windowDaysLeft(state: GameState): number | null {
  // The pre-calendar prep days run straight into the preseason window, so from
  // there the clock counts down to that window's close — windowOpen() says the
  // market is open on those days, and "还剩 null 天" is what saying nothing
  // here actually printed.
  if (state.day < 0) return TRANSFER_WINDOWS[0][1] - state.day + 1
  const w = TRANSFER_WINDOWS.find(([a, b]) => state.day >= a && state.day <= b)
  return w ? w[1] - state.day + 1 : null
}

export function screenLocked(screen: string, state: GameState): string | null {
  if (screen !== 'transfers') return null
  if (windowOpen(state.day)) return null
  const next = TRANSFER_WINDOWS.map(([a]) => a).find((d) => d > state.day)
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
    // and how it comes off. Without this half the warning reads as permanent,
    // which is exactly how it was reported: 「为什么被警告一次之后就一直在」
    items.push({
      key: 'notice', tone: 'urgent', go: 'standings',
      text: `董事会警告：这个赛段没成绩就下课。${noticeHint(state)}。`,
    })
  }

  // ---- urgent: things that are actively costing you
  if (squad.length < 5) {
    items.push({
      key: 'thin', tone: 'urgent', go: 'transfers',
      text: `阵容只有 ${squad.length} 人，凑不齐首发。`,
    })
  }
  const expiring = squad.filter((p) => p.contractYears <= 0)
  if (expiring.length) {
    items.push({
      key: 'expiring', tone: 'urgent', go: 'squad',
      text: `${expiring.map((p) => p.ign).join('、')} 合同到期，不续就走。`,
    })
  }
  // A finished drill leaves nothing running. Without a nudge the squad simply
  // stops doing team work and the only sign is a panel that has gone quiet.
  if (state.drillLock == null || state.drillLock <= state.day) {
    items.push({
      key: 'drill', tone: 'todo', go: 'training',
      text: '没有在跑的团队训练，去排下一轮（七天一轮）。',
    })
  }
  const unhappy = squad.filter((p) => (p.grievance ?? 0) > 45)
  if (unhappy.length) {
    items.push({
      key: 'unhappy', tone: 'urgent', go: 'squad',
      text: `${unhappy.map((p) => p.ign).join('、')} 有意见，再拖就想走了。`,
    })
  }
  if (state.finances.balance < 0) {
    items.push({
      key: 'broke', tone: 'urgent', go: 'finance',
      text: '账上是负的，董事会看着呢。',
    })
  }
  const injured = squad.filter((p) => p.injuredUntil > state.day)
  if (injured.length && me.starters.some((id) => injured.some((p) => p.id === id))) {
    items.push({
      key: 'injured', tone: 'urgent', go: 'squad',
      text: `首发 ${injured.length} 人伤停，得调阵容。`,
    })
  }

  // ---- what this phase is for
  switch (state.stage) {
    case 'preseason':
      if (open) {
        const left = windowDaysLeft(state)
        items.push({
          key: 'market', tone: 'todo', go: 'transfers',
          text: `转会窗口还剩 ${left} 天，补强就趁现在。`,
        })
      }
      items.push({ key: 'plan', tone: 'todo', go: 'training', text: '定本赛季的训练重点，中途改效果打折。' })
      items.push({ key: 'tac', tone: 'todo', go: 'tactics', text: '定战术风格和首发五人。' })
      break
    case 'kickoff':
    case 'stage1':
    case 'stage2':
      items.push({ key: 'lineup', tone: 'todo', go: 'squad', text: '赛段进行中，注意轮换和体能。' })
      {
        // where the table leads — the next Masters or Champions, and what we
        // still need for it — rather than a line that only named the cut
        const q = qualification(state)
        items.push({
          key: 'table', tone: q?.tone === 'warn' ? 'todo' : 'info', go: 'standings',
          text: q ? `${q.event}：${q.headline}` : '积分榜前 8 进季后赛。',
        })
      }
      break
    case 'masters1':
    case 'masters2':
    case 'champions': {
      const q = qualification(state)
      items.push({
        key: 'intl', tone: 'info', go: 'standings',
        text: q ? q.headline : `${stageName(state.stage)} 期间没我们的比赛，可以约训练赛。`,
      })
      if (open) {
        items.push({
          key: 'window', tone: 'todo', go: 'transfers',
          text: `短期转会窗口开放中，还剩 ${windowDaysLeft(state)} 天。`,
        })
      }
      break
    }
    case 'offseason':
      items.push({ key: 'renew', tone: 'todo', go: 'squad', text: '休赛期：续约、清人。' })
      items.push({
        key: 'market2', tone: 'todo', go: 'transfers',
        text: `转会窗口还剩 ${windowDaysLeft(state)} 天。`,
      })
      break
    default:
      break
  }

  // ---- the gap between fixtures is a decision too
  const next = nextFixtureFor(state, state.myTeam)
  const up = upcomingInternational(state)
  const inEv = nextInEvent(state)
  const soonest = Math.min(next ? next.day : Infinity, up ? up.day : Infinity, inEv ? inEv.day : Infinity)
  const gap = Number.isFinite(soonest) ? soonest - state.day : 0
  if (gap >= 4) {
    items.push({
      key: 'scrim', tone: 'todo', go: 'dashboard',
      text: `距下一场 ${gap} 天，可以约训练赛。`,
    })
  }

  // ---- a standing money problem, stated once
  const bill = wageBill(state, state.myTeam)
  if (bill > me.budget * 0.9 && state.finances.balance >= 0) {
    items.push({ key: 'wages', tone: 'info', go: 'finance', text: '薪资偏高，看着点现金流。' })
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
      text: `${incoming.length} 份报价要我们的人，`
        + `${soonest <= 0 ? '今天必须答复' : `最快 ${soonest} 天后作废`}。`,
    })
  }

  // commercial work has to be booked before the day arrives, so surface it
  const gigs = (state.gigs ?? []).filter(
    (g) => !g.done && (g.accepted ? g.day >= state.day : (g.windowEnd ?? g.expiresOn ?? g.day) >= state.day))
  const unbooked = gigs.filter((g) => !g.accepted)
  if (unbooked.length) {
    // Rank by what is running out — the deadline to arrange it — not by a
    // window start that may already be behind us.
    const soon = unbooked.reduce((a, b) =>
      (gigWindow(state, a).left <= gigWindow(state, b).left ? a : b))
    const left = gigWindow(state, soon).left
    items.push({
      key: 'gig',
      text: `${unbooked.length} 个商务邀约没排，${soon.label}`
        + (left <= 0 ? '今天最后一天' : `还剩 ${left} 天`),
      tone: left <= 2 ? 'urgent' : 'todo',
      go: 'commercial',
    })
  }
  const today = gigs.find((g) => g.accepted && g.day === state.day)
  if (today) {
    items.push({ key: 'gig-today', text: `今天有${today.label}（${today.partner}）`, tone: 'info', go: 'commercial' })
  }

  return items.slice(0, 5)
}
