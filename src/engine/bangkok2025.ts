import RAW from '../data/bangkok2025.json'
import STAGED from '../data/bangkok2025_stages.json'
import FACES from '../data/bangkok2025_faces.json'
import type { PlayerCard } from './cards'
import type { Attrs, Player, Region, Role } from './types'
import { MVP_BONUS } from './seoul2024'
import { emptyStats } from './types'

/**
 * 曼谷 2025 — the Masters Bangkok series, built exactly like 首尔 2024
 * (engine/seoul2024.ts): the same settling, stage weights, caller and
 * initiator bonuses and rarity lines, on event 2281's 41 players.
 *
 * Dealt only by the 曼谷包 (gacha.ts), never by a base pack.
 */
export const BANGKOK_EVENT = 'bangkok-2025' as const
export const BANGKOK_TEAMS = RAW.teams
export const BANGKOK_META = RAW.meta
export const BANGKOK_TOTAL = RAW.players.length
export type BangkokEntry = typeof RAW.players[number]

// seoul2024.ts's table, with the two agents released since: Tejo (initiator) and Vyse (sentinel)
const roleAgents: Record<string, Role> = {
  jett: '决斗者', raze: '决斗者', neon: '决斗者', yoru: '决斗者', reyna: '决斗者', iso: '决斗者', phoenix: '决斗者',
  sova: '先锋', fade: '先锋', breach: '先锋', skye: '先锋', kayo: '先锋', gekko: '先锋', tejo: '先锋',
  omen: '控场', brimstone: '控场', viper: '控场', astra: '控场', harbor: '控场', clove: '控场',
  cypher: '哨卫', killjoy: '哨卫', deadlock: '哨卫', sage: '哨卫', chamber: '哨卫', vyse: '哨卫',
}
// Each team's caller at the event, by vlr id. stax, valyn, johnqt and nobody are the 2026 world's verified
// callers on the same teams; MaKo and heybay called these teams at Seoul 2024 (seoul2024.ts); nAts is Team
// Liquid's IGL on Liquipedia since he joined in 2022; Sayf called Vitality (the owner, 2026-09-30).
const callers = new Set(['485', '3885', '1265', '3017', '4462', '4712', '457', '312'])
const bounded = (n: number) => Math.max(55, Math.min(96, Math.round(n)))

const SETTLE_MAPS = 6
type Stat = 'rating' | 'acs' | 'kpr' | 'kast' | 'apr' | 'clutch'
const STATS: Stat[] = ['rating', 'acs', 'kpr', 'kast', 'apr', 'clutch']
const MAPS = RAW.players.reduce((s, p) => s + p.maps, 0)
const FIELD = Object.fromEntries(STATS.map(k => [k, RAW.players.reduce((s, p) => s + p[k] * p.maps, 0) / MAPS])) as Record<Stat, number>
// Swiss 1, Lower Round 1 1.5, upper semifinal to lower final 2, grand final 3 (scripts/build_bangkok2025.mjs)
const STAGE = STAGED.players as Record<string, Partial<Record<Stat, number>>>
const played = (p: BangkokEntry, k: Stat) => STAGE[p.vlrId]?.[k] ?? p[k]
const settled = (p: BangkokEntry, k: Stat) => (played(p, k) * p.maps + FIELD[k] * SETTLE_MAPS) / (p.maps + SETTLE_MAPS)

// A substitute's few maps settle mostly onto the field's mean, which lifts a poor showing to a mid card:
// carpe's two maps (VLR 0.63) read as 77. Anyone who played under a third of his team's maps loses
// SUB_PENALTY on the rating and every attribute (the owner: 打的少要酌情减分).
const SUB_PENALTY = 4
const teamMaps = (tag: string) => Math.max(...RAW.players.filter(p => p.team === tag).map(p => p.maps))
const isSub = (p: BangkokEntry) => p.maps * 3 < teamMaps(p.team)

const CALL_BONUS: Record<number, number> = { 1: 6, 2: 5, 3: 4, 4: 4, 5: 3, 7: 3, 9: 2, 13: 1 }
const standing = (k: Stat) => {
  const xs = RAW.players.map(p => [settled(p, k), p.maps] as const)
  const mean = xs.reduce((s, [x, m]) => s + x * m, 0) / MAPS
  const sd = Math.sqrt(xs.reduce((s, [x, m]) => s + (x - mean) ** 2 * m, 0) / MAPS)
  return (x: number) => (x - mean) / sd
}
const KAST_Z = standing('kast'), APR_Z = standing('apr')
// The event MVP — Meteor (vlr 13039), named on Riot's own photos of the bracelet — gets 首尔's MVP honour
// (seoul2024.ts MVP_BONUS): his VLR rating, 1.04 across the event, put him at 82.
const MVP = '13039'

type Face = { face?: string; sure?: boolean; confirmed?: boolean; note?: string | null; source?: string }
/** the Features Day portrait and how sure the caption match is (scripts/bangkok2025_faces.py) */
export const bangkokFace = (vlrId: string): Face | undefined => (FACES as Record<string, Face>)[vlrId]

/** seoul2024.ts's buildSeoulCards, formula for formula. */
export function buildBangkokCards(base: readonly PlayerCard[]): PlayerCard[] {
  return RAW.players.map(p => {
    const live = p.playerId ? base.find(c => c.playerId === p.playerId && !c.legend) : undefined
    const team = BANGKOK_TEAMS.find(t => t.tag === p.team)!
    const usage = new Map<Role, number>()
    for (const [agent, share] of Object.entries(p.agentUsage)) {
      const role = roleAgents[agent]
      if (role) usage.set(role, (usage.get(role) ?? 0) + (share ?? 0))
    }
    const roles = [...usage].sort((a, b) => b[1] - a[1]).map(([role]) => role)
    const s = (k: Stat) => settled(p, k)
    const combat = 70 + (s('rating') - .75) * 45
    const isIgl = callers.has(p.vlrId)
    const call = isIgl ? CALL_BONUS[team.placement] ?? 0 : 0
    const opener = (usage.get('先锋') ?? 0) / ([...usage.values()].reduce((a, b) => a + b, 0) || 1)
    const lift = Math.round(opener * Math.max(0, Math.min(3, KAST_Z(s('kast')) + APR_Z(s('apr')))))
    const sub = isSub(p) ? SUB_PENALTY : 0
    const mvp = p.vlrId === MVP ? MVP_BONUS : 0
    const rating = bounded(combat + call + lift + mvp - sub)
    const attrs: Attrs = {
      aim: bounded(55 + s('acs') * .145 - sub), reaction: bounded(52 + s('kpr') * 42 - sub),
      awareness: bounded(20 + s('kast') * .85 - sub), utility: bounded(62 + s('apr') * 58 - sub),
      clutch: bounded(68 + s('clutch') * .55 - sub), teamwork: bounded(20 + s('kast') * .85 - sub),
      communication: bounded(65 + s('apr') * 42 - sub), igl: isIgl ? bounded(combat + call + 5) : 55,
    }
    return {
      kind: 'player', id: `b25:${p.vlrId}`,
      playerId: live?.playerId ?? `historic:vlr:${p.vlrId}`,
      event: BANGKOK_EVENT, bangkok: p,
      ign: p.ign, realName: p.realName ?? undefined, nat: p.nat,
      face: bangkokFace(p.vlrId)?.face ?? p.face ?? undefined,
      region: team.region as Region, clubId: team.clubId ?? `b25:${team.tag}`, clubTag: team.tag,
      role: roles[0] ?? '自由人', roles: roles.length ? roles : ['自由人'], isIgl,
      age: p.age ?? 0, attrs, rating, rarity: rating >= 84 ? 'gold' : rating >= 76 ? 'silver' : 'bronze',
    }
  })
}

/** Event-only people can play in the arena without adding them to a 2026 career (seoul2024.ts seoulArenaPlayer). */
export function bangkokArenaPlayer(card: PlayerCard): Player | undefined {
  if (!card.bangkok) return undefined
  return {
    id: card.playerId, ign: card.ign, realName: card.realName, nat: card.nat ?? undefined,
    teamId: card.clubId, region: card.region, role: card.role, roles: [...card.roles],
    age: card.age, ageEstimated: true, isIgl: card.isIgl, attrs: { ...card.attrs }, overall: card.rating,
    potential: card.rating, form: 76, morale: 84, fatigue: 0, salary: 0, value: 0, contractYears: 0,
    loyalty: 70, ambition: 70, agentPool: card.bangkok.agents.map(a => a === 'kayo' ? 'KAY/O' : a[0].toUpperCase() + a.slice(1)),
    season: emptyStats(), career: emptyStats(), injuredUntil: 0, xp: {},
  }
}
