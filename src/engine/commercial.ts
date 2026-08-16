import { Rng, clamp, hashStr } from './rng'
import { squadOf } from './world'
import type { GameState, Gig, GigKind, Player } from './types'

/**
 * The commercial side of running a club.
 *
 * A roster does not pay for itself on prize money. Appearances, brand days and
 * streaming are where a manager actually finds cash — and the cost is always
 * the same currency: a day the squad spends being famous is a day it does not
 * spend practising. Every gig below takes players out of the week's training.
 */

interface GigTemplate {
  kind: GigKind
  label: string
  /** how many players have to show up */
  heads: number
  /** fee as a multiple of the club's weekly sponsor income */
  pay: [number, number]
  fatigue: [number, number]
  morale: [number, number]
  /** fans won, which feeds next season's sponsorship */
  fans: [number, number]
  blurb: string
}

const TEMPLATES: GigTemplate[] = [
  {
    kind: 'fanmeet', label: '粉丝见面会', heads: 3,
    pay: [0.5, 1.1], fatigue: [6, 12], morale: [3, 7], fans: [3, 6],
    blurb: '签售与合影，选手会很享受，粉丝增长最快。',
  },
  {
    kind: 'brand', label: '品牌活动', heads: 2,
    pay: [1.4, 2.6], fatigue: [10, 18], morale: [-4, 1], fans: [1, 3],
    blurb: '赞助商的站台活动，钱最多，但选手当天基本报废。',
  },
  {
    kind: 'campus', label: '校园行', heads: 4,
    pay: [0.3, 0.7], fatigue: [8, 14], morale: [1, 5], fans: [4, 8],
    blurb: '去高校做分享，钱少但最能拉新观众。',
  },
  {
    kind: 'shoot', label: '拍摄', heads: 5,
    pay: [1.0, 2.0], fatigue: [12, 20], morale: [-6, -1], fans: [2, 5],
    blurb: '队服或宣传片拍摄，全队到场，反复重拍很消耗人。',
  },
  {
    kind: 'stream', label: '直播', heads: 1,
    pay: [0.2, 0.6], fatigue: [4, 9], morale: [0, 4], fans: [1, 4],
    blurb: '一个人开播，占用最少，适合塞在赛程空档里。',
  },
]

const PARTNERS: Record<GigKind, string[]> = {
  fanmeet: ['官方粉丝俱乐部', '城市主场馆', '线下体验店'],
  brand: ['外设赞助商', '功能饮料品牌', '手机厂商', '汽车品牌'],
  campus: ['本地高校电竞社', '大学生联赛', '职业技术学院'],
  shoot: ['新赛季队服', 'season 宣传片', '纪录片摄制组'],
  stream: ['斗鱼', '虎牙', 'B 站直播', 'Twitch'],
}

/** What one gig is worth, scaled to the size of the club. */
function feeFor(state: GameState, t: GigTemplate, rng: Rng): number {
  const team = state.teams[state.myTeam]
  const weekly = (team?.sponsors.reduce((s, x) => s + x.perSeason, 0) ?? 0) / 48
  // a bigger name commands more for the same afternoon
  const pull = 0.6 + (team?.reputation ?? 50) / 100
  return Math.round(weekly * rng.range(t.pay[0], t.pay[1]) * pull)
}

/**
 * Offers arrive on their own; the manager does not go looking for them.
 *
 * They expire, so passing on one is a real decision rather than a deferral.
 */
export function offerGigs(state: GameState, rng: Rng, notes: string[]): void {
  // an accepted booking survives until the day itself; only an offer nobody
  // took expires, which is what makes passing on one a real decision
  state.gigs = (state.gigs ?? []).filter(
    (g) => !g.done && (g.accepted ? g.day >= state.day : g.expiresOn >= state.day),
  )
  const pending = state.gigs.filter((g) => !g.accepted)
  if (pending.length >= 3) return

  const team = state.teams[state.myTeam]
  if (!team) return
  // a well-known club gets approached more often
  // roughly one approach a week for a mid-table club, more if you are a name.
  // Offers have to stay scarce or the commercial screen out-earns the sport.
  const chance = clamp(0.07 + (team.reputation - 50) * 0.004, 0.04, 0.2)
  if (!rng.chance(chance)) return

  const t = rng.pick(TEMPLATES)
  const lead = rng.int(3, 10)
  const gig: Gig = {
    id: `G${state.day}_${t.kind}_${rng.int(100, 999)}`,
    kind: t.kind,
    label: t.label,
    partner: rng.pick(PARTNERS[t.kind]),
    day: state.day + lead,
    expiresOn: state.day + lead - 1,
    fee: feeFor(state, t, rng),
    heads: Math.min(t.heads, squadOf(state, state.myTeam).length),
    fatigue: rng.int(t.fatigue[0], t.fatigue[1]),
    morale: rng.int(t.morale[0], t.morale[1]),
    fans: rng.int(t.fans[0], t.fans[1]),
    blurb: t.blurb,
  }
  state.gigs.push(gig)
  notes.push(`💼 ${gig.partner} 来谈${gig.label}。`)
}

/** Accept an offer and name the players who will attend. */
export function bookGig(state: GameState, gigId: string, playerIds: string[]): string {
  const gig = state.gigs?.find((g) => g.id === gigId)
  if (!gig) return '这个活动已经过期了。'
  if (gig.accepted) return '这个活动已经安排过了。'
  if (playerIds.length !== gig.heads) return `需要 ${gig.heads} 名选手出席。`

  const clash = state.fixtures.find(
    (f) => f.day === gig.day && !f.result && (f.teamA === state.myTeam || f.teamB === state.myTeam),
  )
  if (clash) return '这一天有比赛，不能安排商务活动。'

  gig.accepted = true
  gig.attendees = playerIds
  return `已确认 ${gig.label}（${gig.partner}），${gig.day - state.day} 天后进行。`
}

/** Withdraw before the day arrives. */
export function cancelGig(state: GameState, gigId: string): string {
  const gig = state.gigs?.find((g) => g.id === gigId)
  if (!gig || !gig.accepted) return '没有可取消的安排。'
  gig.accepted = false
  gig.attendees = undefined
  return `已取消 ${gig.label}。`
}

/**
 * Run whatever was booked for today.
 *
 * The money lands immediately; the cost lands on the players, and on the week's
 * training, which is settled separately and reads `commercialDays`.
 */
export function runGigsToday(state: GameState, notes: string[]): void {
  const team = state.teams[state.myTeam]
  if (!team) return
  for (const gig of state.gigs ?? []) {
    if (gig.done || !gig.accepted || gig.day !== state.day) continue
    gig.done = true

    const attendees = (gig.attendees ?? [])
      .map((id) => state.players[id])
      .filter((p): p is Player => !!p && p.teamId === state.myTeam)
    if (!attendees.length) {
      notes.push(`⚠️ ${gig.label} 没有可出席的选手，活动取消。`)
      continue
    }

    state.finances.balance += gig.fee
    state.finances.log.push({ day: state.day, label: `商务：${gig.label}`, amount: gig.fee })
    team.reputation = clamp(team.reputation + gig.fans * 0.05, 0, 99)

    for (const p of attendees) {
      p.fatigue = clamp(p.fatigue + gig.fatigue, 0, 100)
      p.morale = clamp(p.morale + gig.morale, 0, 100)
      // the day is spent, so this week's practice is worth less for them
      state.commercialDays = { ...(state.commercialDays ?? {}), [p.id]: (state.commercialDays?.[p.id] ?? 0) + 1 }
    }

    const who = attendees.map((p) => p.ign).join('、')
    notes.push(`💼 ${gig.label}（${gig.partner}）完成，进账 ${Math.round(gig.fee / 1000)}K。出席：${who}`)
    state.news.push({
      day: state.day, kind: 'club', important: false,
      text: `💼 ${team.name} 参加了${gig.partner}的${gig.label}。`,
    })
  }
}

/** Offers that are still open, soonest first. */
export function openGigs(state: GameState): Gig[] {
  return (state.gigs ?? [])
    .filter((g) => !g.done && g.day >= state.day)
    .sort((a, b) => a.day - b.day)
}

export function gigRng(state: GameState): Rng {
  return new Rng(hashStr(`gig:${state.seed}:${state.year}:${state.day}`))
}
