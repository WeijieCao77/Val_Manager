import { Rng, clamp, hashStr } from './rng'
import { squadOf } from './world'
import { skillMod } from './manager'
import { duoBonded } from './bonds'
import type { GameState, Gig, GigKind, Player, SponsorTalk, StreamDeal, VentureKind } from './types'

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
  // 商务: a manager who can sell gets more for the same afternoon
  return Math.round(weekly * rng.range(t.pay[0], t.pay[1]) * pull *
    skillMod(state.manager, 'business', 0.008))
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
  const chance = clamp(0.07 + (team.reputation - 50) * 0.004, 0.04, 0.2) *
    skillMod(state.manager, 'business', 0.006)
  if (!rng.chance(chance)) return

  const t = rng.pick(TEMPLATES)
  const lead = rng.int(3, 10)
  // a window rather than a single date: an offer that happened to land on a
  // match day was simply dead, which is not how a partner would behave
  const span = rng.int(4, 8)
  const gig: Gig = {
    id: `G${state.day}_${t.kind}_${rng.int(100, 999)}`,
    kind: t.kind,
    label: t.label,
    partner: rng.pick(PARTNERS[t.kind]),
    day: state.day + lead,
    windowEnd: state.day + lead + span,
    expiresOn: state.day + lead + span - 1,
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
export function bookGig(
  state: GameState, gigId: string, playerIds: string[], onDay?: number,
): string {
  const gig = state.gigs?.find((g) => g.id === gigId)
  if (!gig) return '这个活动已经过期了。'
  if (gig.accepted) return '这个活动已经安排过了。'
  if (playerIds.length !== gig.heads) return `需要 ${gig.heads} 名选手出席。`

  const day = onDay ?? firstFreeDay(state, gig)
  if (day === null) return '这段时间里每天都有比赛，安排不下。'
  if (day < gig.day || day > (gig.windowEnd ?? gig.day)) return '这个日期不在对方能配合的范围内。'
  if (matchOn(state, day)) return '这一天有比赛，换个日期。'

  gig.day = day
  gig.accepted = true
  gig.attendees = playerIds
  return `已确认 ${gig.label}（${gig.partner}），${day - state.day} 天后进行。`
}

/** Is one of our fixtures on this day? */
export function matchOn(state: GameState, day: number): boolean {
  return state.fixtures.some(
    (f) => f.day === day && !f.result && (f.teamA === state.myTeam || f.teamB === state.myTeam),
  )
}

/** Every day in a gig's window that we could actually attend. */
export function freeDays(state: GameState, gig: Gig): number[] {
  const out: number[] = []
  for (let d = Math.max(gig.day, state.day); d <= (gig.windowEnd ?? gig.day); d++) {
    if (!matchOn(state, d)) out.push(d)
  }
  return out
}

function firstFreeDay(state: GameState, gig: Gig): number | null {
  return freeDays(state, gig)[0] ?? null
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
  runVentures(state, gigRng(state), notes)
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

// ---------------------------------------------------------------- 主动出击
//
// Waiting to be asked made the manager a passenger on the one part of the club
// they should be driving. These are the two things you can start yourself.

const VENTURES: Record<VentureKind, {
  label: string; cost: number; heads: number; lead: [number, number]
  pay: [number, number]; fans: [number, number]; fatigue: number; morale: number; blurb: string
}> = {
  openday: {
    label: '俱乐部开放日', cost: 60_000, heads: 5, lead: [5, 12],
    pay: [0.8, 2.2], fans: [6, 12], fatigue: 10, morale: 4,
    blurb: '把主场开放给粉丝，全队到场。人气收益最高，办砸了也最丢人。',
  },
  bootcamp: {
    label: '线下训练营', cost: 120_000, heads: 5, lead: [7, 14],
    pay: [0.2, 0.8], fans: [2, 5], fatigue: -12, morale: 6,
    blurb: '拉出去集训：几乎不赚钱，但恢复体能、提振士气，而且是少数能直接拉近全队关系的手段。',
  },
  watchparty: {
    label: '观赛派对', cost: 30_000, heads: 2, lead: [3, 8],
    pay: [0.7, 2.0], fans: [3, 7], fatigue: 5, morale: 3,
    blurb: '和粉丝一起看比赛，成本低，两个人就能撑场。',
  },
  merch: {
    label: '周边发售', cost: 90_000, heads: 1, lead: [6, 12],
    pay: [0.9, 2.5], fans: [1, 4], fatigue: 3, morale: 1,
    blurb: '出一批联名周边，回报最高但压资金，人气拉动有限。',
  },
}

export function ventureInfo(kind: VentureKind) {
  return VENTURES[kind]
}

/** Start organising a club event. It pays out on the day, not now. */
export function startVenture(
  state: GameState, kind: VentureKind, attendees: string[],
): string {
  const v = VENTURES[kind]
  const squad = squadOf(state, state.myTeam)
  const need = Math.min(v.heads, squad.length)
  if (attendees.length !== need) return `需要 ${need} 名选手参与。`
  if (state.finances.balance < v.cost) return `资金不足，需要先垫付 ${Math.round(v.cost / 1000)}K。`

  const rng = gigRng(state)
  const day = state.day + rng.int(v.lead[0], v.lead[1])
  if (state.fixtures.some((f) => f.day === day && !f.result &&
      (f.teamA === state.myTeam || f.teamB === state.myTeam))) {
    return '筹备日期正好撞上比赛，换个时间再试。'
  }

  state.finances.balance -= v.cost
  state.finances.log.push({ day: state.day, label: `筹备${v.label}`, amount: -v.cost })
  state.ventures = [...(state.ventures ?? []),
    { kind, day, cost: v.cost, heads: need, attendees }]
  return `${v.label}已开始筹备，${day - state.day} 天后举办。`
}

/** Club events happening today. */
function runVentures(state: GameState, rng: Rng, notes: string[]): void {
  const team = state.teams[state.myTeam]
  if (!team) return
  const due = (state.ventures ?? []).filter((v) => v.day === state.day)
  if (!due.length) return
  state.ventures = (state.ventures ?? []).filter((v) => v.day !== state.day)

  for (const v of due) {
    const t = VENTURES[v.kind]
    // turnout rides on how well known the club is — a big name fills the room
    // turnout is what makes this a bet: a club nobody has heard of cannot fill
    // a room, and even a big one has quiet nights
    const turnout = clamp(0.35 + (team.reputation - 55) * 0.018, 0.2, 1.5) *
      rng.range(0.7, 1.35)
    const take = Math.round(v.cost * rng.range(t.pay[0], t.pay[1]) * turnout)
    state.finances.balance += take
    state.finances.log.push({ day: state.day, label: v.kind === 'bootcamp' ? '训练营收入' : `${t.label}收入`, amount: take })
    team.reputation = clamp(team.reputation + rng.int(t.fans[0], t.fans[1]) * 0.05 * turnout, 0, 99)

    // A week away together is the one thing on this screen that genuinely
    // builds a squad rather than just paying for it — a bootcamp pulls every
    // pair at it closer, an open day a little, a shoot not at all.
    const closeness = v.kind === 'bootcamp' ? rng.range(5, 9)
      : v.kind === 'openday' || v.kind === 'watchparty' ? rng.range(1, 3) : 0
    if (closeness > 0) {
      for (let i = 0; i < v.attendees.length; i++) {
        for (let j = i + 1; j < v.attendees.length; j++) {
          duoBonded(state, v.attendees[i], v.attendees[j], closeness)
        }
      }
      if (v.kind === 'bootcamp') notes.push('🤝 集训期间全队关系明显拉近。')
    }

    for (const id of v.attendees) {
      const p = state.players[id]
      if (!p || p.teamId !== state.myTeam) continue
      p.fatigue = clamp(p.fatigue + t.fatigue, 0, 100)
      p.morale = clamp(p.morale + t.morale, 0, 100)
      if (t.fatigue > 0) {
        state.commercialDays = {
          ...(state.commercialDays ?? {}),
          [id]: (state.commercialDays?.[id] ?? 0) + 1,
        }
      }
    }
    const net = take - v.cost
    notes.push(
      `🎪 ${t.label}结束，票房与销售 ${Math.round(take / 1000)}K（净 ${net >= 0 ? '+' : ''}${Math.round(net / 1000)}K）。`,
    )
  }
}

/**
 * Go looking for a sponsor instead of waiting to be approached.
 *
 * Costs nothing but the cooldown, and can simply come back no — a club nobody
 * has heard of does not land deals by asking harder.
 */
export function pitchSponsor(state: GameState): string {
  if ((state.pitchCooldown ?? 0) > state.day) {
    return `刚谈过一轮，${(state.pitchCooldown ?? 0) - state.day} 天后可以再找。`
  }
  const team = state.teams[state.myTeam]
  if (!team) return '找不到俱乐部。'
  // 14 days, per the shorter cycle: a fortnight between approaches
  state.pitchCooldown = state.day + 14

  const rng = gigRng(state)
  const partner = rng.pick(PITCH_PARTNERS)
  const base = team.sponsors.reduce((s, x) => s + x.perSeason, 0) / Math.max(1, team.sponsors.length)
  const pull = skillMod(state.manager, 'business', 0.006)

  // what they want in return, which is what makes one deal different from
  // another rather than just a bigger number
  const pool: SponsorTalk['demands'] = [
    { key: 'gigs', text: '每赛季至少出席 3 次商务活动' },
    { key: 'placing', text: `赛段排名进入前 ${rng.int(4, 8)}` },
    { key: 'stream', text: '至少一名选手签约直播平台' },
    { key: 'exclusive', text: '同行业不得再签第二家赞助' },
  ]
  const demands = pool.filter(() => rng.chance(0.45)).slice(0, 2)
  const generous = demands.length >= 2 ? 1.25 : demands.length === 1 ? 1.0 : 0.8

  const talk: SponsorTalk = {
    id: `SP${state.day}`,
    name: partner.name,
    industry: partner.industry,
    base: Math.round(base * rng.range(0.3, 0.8) * pull * generous),
    bonus: Math.round(base * rng.range(0.15, 0.45) * pull),
    bonusPlacement: rng.int(2, 6),
    demands,
    day: state.day,
    replyOn: state.day + 3,      // they come back in three days
  }
  state.sponsorTalks = [...(state.sponsorTalks ?? []), talk]
  return `已联系 ${talk.name}，3 天后给出具体条件。`
}

/** Sponsors coming back with terms, and deals we already accepted. */
export function resolveSponsorTalks(state: GameState, rng: Rng): string[] {
  const notes: string[] = []
  const team = state.teams[state.myTeam]
  if (!team) return notes
  for (const t of state.sponsorTalks ?? []) {
    if (t.answer || t.replyOn > state.day) continue
    const odds = clamp(
      0.32 + (team.reputation - 55) * 0.012 + state.honours.length * 0.03, 0.1, 0.85,
    ) * skillMod(state.manager, 'business', 0.008)
    if (rng.chance(odds)) {
      // terms are on the table; the manager decides
      notes.push(`🤝 ${t.name} 提出了赞助方案，等待你答复。`)
    } else {
      t.answer = 'reject'
      t.reason = team.reputation < 55 ? '认为俱乐部影响力还不够' : '本季的预算已经排满'
      notes.push(`❌ ${t.name} 婉拒了合作：${t.reason}`)
    }
  }
  state.sponsorTalks = (state.sponsorTalks ?? [])
    .filter((t) => t.answer !== 'reject' || t.replyOn > state.day - 14)
  return notes
}

/** Sign a sponsorship whose terms are on the table. */
export function signSponsor(state: GameState, id: string): string {
  const t = state.sponsorTalks?.find((x) => x.id === id)
  const team = state.teams[state.myTeam]
  if (!t || !team || t.answer) return '这份方案已经失效。'
  t.answer = 'accept'
  team.sponsors = [...team.sponsors, {
    name: t.name, perSeason: t.base, bonusPlacement: t.bonusPlacement, bonus: t.bonus,
  }]
  state.news.push({
    day: state.day, kind: 'club', important: true,
    text: `🤝 ${team.name} 与 ${t.name} 达成赞助协议，保底 ${Math.round(t.base / 1000)}K/赛季。`,
  })
  return `已签下 ${t.name}，保底 ${Math.round(t.base / 1000)}K/赛季。`
}

export function declineSponsor(state: GameState, id: string): string {
  const t = state.sponsorTalks?.find((x) => x.id === id)
  if (!t) return '这份方案已经失效。'
  t.answer = 'reject'
  t.reason = '你拒绝了这份条件'
  return `已拒绝 ${t.name} 的方案。`
}

const PITCH_PARTNERS = [
  { name: '雷霆能量饮料', industry: '功能饮料' },
  { name: 'HyperEdge 外设', industry: '游戏外设' },
  { name: '座界人体工学', industry: '电竞座椅' },
  { name: '骋越运动', industry: '运动服饰' },
  { name: '星芒手机', industry: '消费电子' },
  { name: '连星网咖', industry: '连锁网咖' },
  { name: '视界显示器', industry: '显示设备' },
  { name: '咔嚓零食', industry: '快消零食' },
  { name: '晟通银行信用卡', industry: '金融' },
  { name: '骐骥新能源', industry: '汽车' },
]

// ---------------------------------------------------------------- 直播合同

const PLATFORMS = ['斗鱼', '虎牙', 'B 站直播', 'Twitch', '快手电竞']

/** What a platform would pay this player, and what it would cost him. */
export function streamOffer(state: GameState, playerId: string): StreamDeal | null {
  const p = state.players[playerId]
  if (!p || p.teamId !== state.myTeam || p.stream) return null
  const team = state.teams[state.myTeam]
  const rng = new Rng(hashStr(`stream:${state.seed}:${state.year}:${playerId}`))
  // platforms pay for an audience: ability, and the club's profile behind him
  const draw = p.overall - 55 + (team ? (team.reputation - 55) * 0.5 : 0)
  if (draw <= 0) return null
  // platforms sign short and renegotiate — a season-long deal took the decision
  // away for a whole year, and the player's draw changes faster than that
  const months = rng.int(2, 3)
  const annual = (18_000 + draw * draw * 55) * rng.range(0.85, 1.2)
  return {
    platform: rng.pick(PLATFORMS),
    fee: Math.round(annual * months / 12),
    months,
    nights: rng.int(2, 4),
    since: state.day,
    until: state.day + months * 28,
  }
}

export function signStream(state: GameState, playerId: string): string {
  const p = state.players[playerId]
  const offer = streamOffer(state, playerId)
  if (!p || !offer) return '这名选手目前没有直播合同可签。'
  p.stream = offer
  p.morale = clamp(p.morale + 4, 0, 100)   // the money is welcome
  return `${p.ign} 与 ${offer.platform} 签下 ${offer.months} 个月直播合同，` +
    `合计 ${Math.round(offer.fee / 1000)}K，每周 ${offer.nights} 晚。`
}

export function endStream(state: GameState, playerId: string): string {
  const p = state.players[playerId]
  if (!p?.stream) return '没有可解除的直播合同。'
  const name = p.stream.platform
  p.stream = undefined
  p.morale = clamp(p.morale - 3, 0, 100)
  return `${p.ign} 已终止与 ${name} 的直播合同。`
}

/**
 * The weekly price of streaming.
 *
 * Money arrives without the squad leaving the building, so the cost has to be
 * real: late nights are late nights, and the more of them the worse the week.
 */
export function streamWeek(state: GameState, rng: Rng, notes: string[]): void {
  for (const p of squadOf(state, state.myTeam)) {
    if (!p.stream) continue
    // a lapsed deal simply ends; renewing is a fresh decision
    // a deal signed before terms existed has no end date; give it one
    if (p.stream.until == null) {
      p.stream = { ...p.stream, months: p.stream.months ?? 3, until: state.day + 84 }
    }
    if (p.stream.until <= state.day) {
      notes.push(`📺 ${p.ign} 与 ${p.stream.platform} 的直播合同到期。`)
      p.stream = undefined
      continue
    }
    const weekly = Math.round(p.stream.fee / Math.max(4, (p.stream.months ?? 12) * 4))
    state.finances.balance += weekly
    state.finances.log.push({ day: state.day, label: `直播分成 ${p.ign}`, amount: weekly })
    p.fatigue = clamp(p.fatigue + p.stream.nights * rng.range(1.6, 3.2), 0, 100)
    // a night streaming is a night not practising, though milder than a shoot
    if (p.stream.nights >= 3) {
      state.commercialDays = {
        ...(state.commercialDays ?? {}),
        [p.id]: (state.commercialDays?.[p.id] ?? 0) + 1,
      }
    }
    if (p.fatigue > 82 && rng.chance(0.22)) {
      notes.push(`📺 ${p.ign} 直播强度偏高，状态开始受影响。`)
    }
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
