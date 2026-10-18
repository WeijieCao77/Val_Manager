import RAW from '../data/losangeles2023.json'
import STAGED from '../data/losangeles2023_stages.json'
import FACES from '../data/losangeles2023_faces.json'
import type { PlayerCard } from './cards'
import type { Attrs, Player, Region, Role } from './types'
import { MVP_BONUS } from './seoul2024'
import { emptyStats } from './types'

/**
 * 洛杉矶 2023 — the VALORANT Champions 2023 series, built exactly like 首尔 2024
 * (engine/seoul2024.ts) and 曼谷 2025: the same settling, stage weights, caller and
 * initiator bonuses, MVP honour and rarity lines, on vlr event 1657's 80 players.
 *
 * Dealt only by the 洛杉矶包 (gacha.ts), never by a base pack.
 */
export const LOS_ANGELES_EVENT = 'los-angeles-2023' as const
export const LOS_ANGELES_TEAMS = RAW.teams
export const LOS_ANGELES_META = RAW.meta
export const LOS_ANGELES_TOTAL = RAW.players.length
export type LosAngelesEntry = typeof RAW.players[number]

// seoul2024.ts's table, plus the two agents released since (no one played them in 2023)
const roleAgents: Record<string, Role> = {
  jett: '决斗者', raze: '决斗者', neon: '决斗者', yoru: '决斗者', reyna: '决斗者', iso: '决斗者', phoenix: '决斗者',
  sova: '先锋', fade: '先锋', breach: '先锋', skye: '先锋', kayo: '先锋', gekko: '先锋', tejo: '先锋',
  omen: '控场', brimstone: '控场', viper: '控场', astra: '控场', harbor: '控场', clove: '控场',
  cypher: '哨卫', killjoy: '哨卫', deadlock: '哨卫', sage: '哨卫', chamber: '哨卫', vyse: '哨卫',
}
// Each team's caller at Champions 2023, by vlr id — 2023's, not today's (nAts and MaKo called later):
// Boostio (EG) and FNS (NRG) by Liquipedia's role field (analysis/rating/history_v16/liquipedia_roles.json);
// saadhak (LOUD), Boaster (FNC), ANGE1 (NAVI) as named throughout the event's coverage; stax (DRX, "former
// DRX IGL" when T1 signed him in 2024); Haodong (EDG, Strafe's 2023 IGL list); Biank (BLG, Knight took the
// calls only after Champions); Munchkin (T1, announced by coach Autumn for 2023); rhyme (Giants' 2023 roster
// announcement); Redgar (Liquid's IGL until he left for Giants); Klaus (KRÜ) and Laz (ZETA) from the
// event's own roster listings; MrFaliN (FUT's captain, who called them at Seoul 2024 too); d4v41 (PRX, as
// on the 首尔 card); BerLIN (FPX, as on the 首尔 card).
const callers = new Set(['604', '9803', '727', '438', '485', '4720', '3021', '8044', '109', '817', '2489', '10', '1427', '7857', '2610', '999'])
const bounded = (n: number) => Math.max(55, Math.min(96, Math.round(n)))

const SETTLE_MAPS = 6
type Stat = 'rating' | 'acs' | 'kpr' | 'kast' | 'apr' | 'clutch'
const STATS: Stat[] = ['rating', 'acs', 'kpr', 'kast', 'apr', 'clutch']
const MAPS = RAW.players.reduce((s, p) => s + p.maps, 0)
const FIELD = Object.fromEntries(STATS.map(k => [k, RAW.players.reduce((s, p) => s + p[k] * p.maps, 0) / MAPS])) as Record<Stat, number>
// groups 1, Upper Quarterfinals / Lower Rounds 1–2 1.5, upper semifinal to lower final 2, grand final 3
// (scripts/build_losangeles2023.mjs — Seoul 2024 ran the same format)
const STAGE = STAGED.players as Record<string, Partial<Record<Stat, number>>>
const played = (p: LosAngelesEntry, k: Stat) => STAGE[p.vlrId]?.[k] ?? p[k]
const settled = (p: LosAngelesEntry, k: Stat) => (played(p, k) * p.maps + FIELD[k] * SETTLE_MAPS) / (p.maps + SETTLE_MAPS)

// 曼谷's substitute rule. Every Champions 2023 team played its five on every map, so it touches no one;
// it stays so a rebuild with a sub reads like the other series.
const SUB_PENALTY = 4
const teamMaps = (tag: string) => Math.max(...RAW.players.filter(p => p.team === tag).map(p => p.maps))
const isSub = (p: LosAngelesEntry) => p.maps * 3 < teamMaps(p.team)

const CALL_BONUS: Record<number, number> = { 1: 6, 2: 5, 3: 4, 4: 4, 5: 3, 7: 3, 9: 2, 13: 1 }
const standing = (k: Stat) => {
  const xs = RAW.players.map(p => [settled(p, k), p.maps] as const)
  const mean = xs.reduce((s, [x, m]) => s + x * m, 0) / MAPS
  const sd = Math.sqrt(xs.reduce((s, [x, m]) => s + (x - mean) ** 2 * m, 0) / MAPS)
  return (x: number) => (x - mean) / sd
}
const KAST_Z = standing('kast'), APR_Z = standing('apr')
// The event MVP: Demon1 (vlr 26171), named by Riot at the final; 首尔's MVP honour (seoul2024.ts MVP_BONUS).
const MVP = '26171'

type Face = { face?: string; sure?: boolean; confirmed?: boolean; note?: string | null; source?: string }
/** the Features Day portrait and how sure the caption match is (scripts/losangeles2023_faces.py) */
export const losAngelesFace = (vlrId: string): Face | undefined => (FACES as Record<string, Face>)[vlrId]

/** seoul2024.ts's buildSeoulCards, formula for formula. */
export function buildLosAngelesCards(base: readonly PlayerCard[]): PlayerCard[] {
  return RAW.players.map(p => {
    const live = p.playerId ? base.find(c => c.playerId === p.playerId && !c.legend) : undefined
    const team = LOS_ANGELES_TEAMS.find(t => t.tag === p.team)!
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
      kind: 'player', id: `la23:${p.vlrId}`,
      playerId: live?.playerId ?? `historic:vlr:${p.vlrId}`,
      event: LOS_ANGELES_EVENT, losAngeles: p,
      ign: p.ign, realName: p.realName ?? undefined, nat: p.nat,
      face: losAngelesFace(p.vlrId)?.face ?? p.face ?? undefined,
      region: team.region as Region, clubId: team.clubId ?? `la23:${team.tag}`, clubTag: team.tag,
      role: roles[0] ?? '自由人', roles: roles.length ? roles : ['自由人'], isIgl,
      age: p.age ?? 0, attrs, rating, rarity: rating >= 84 ? 'gold' : rating >= 76 ? 'silver' : 'bronze',
    }
  })
}

/** Event-only people can play in the arena without adding them to a 2026 career (seoul2024.ts seoulArenaPlayer). */
export function losAngelesArenaPlayer(card: PlayerCard): Player | undefined {
  if (!card.losAngeles) return undefined
  return {
    id: card.playerId, ign: card.ign, realName: card.realName, nat: card.nat ?? undefined,
    teamId: card.clubId, region: card.region, role: card.role, roles: [...card.roles],
    age: card.age, ageEstimated: true, isIgl: card.isIgl, attrs: { ...card.attrs }, overall: card.rating,
    potential: card.rating, form: 76, morale: 84, fatigue: 0, salary: 0, value: 0, contractYears: 0,
    loyalty: 70, ambition: 70, agentPool: card.losAngeles.agents.map(a => a === 'kayo' ? 'KAY/O' : a[0].toUpperCase() + a.slice(1)),
    season: emptyStats(), career: emptyStats(), injuredUntil: 0, xp: {},
  }
}
