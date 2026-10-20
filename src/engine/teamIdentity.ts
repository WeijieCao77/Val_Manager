import { cardById, clubKey, isCoachCard, isPlayerCard } from './cards'
import type { PlayerCard, Squad } from './cards'
import { WORLD_TEAMS } from './teams'
import { crestUrl } from './dossier'

/**
 * Cosmetic identity only: all five distinct players and their coach must share a club.
 * A retired card's club is its own `H:` id, so it counts by club tag: s0m with four
 * of today's NRG and their coach is an NRG five (2026-10-11).
 */
export function squadTeamIdentity(squad: Squad) {
  if (squad.slots.length !== 5 || !squad.coach || squad.slots.some(id => !id)) return null
  const players = squad.slots.map(id => cardById(id!))
  const coach = cardById(squad.coach)
  if (!coach || !isCoachCard(coach) || !coach.clubId) return null
  const clubTag = clubKey(coach.clubTag)
  // a retired coach's club is his own `H:` id as well: he counts by tag the same way (2026-10-20)
  const ofClub = (p: PlayerCard) => p.clubId === coach.clubId || ((!!p.retired || !!coach.retired) && !!clubTag && clubKey(p.clubTag) === clubTag)
  if (players.some(p => !p || !isPlayerCard(p) || !ofClub(p))) return null
  if (new Set(players.map(p => p && isPlayerCard(p) ? p.playerId : '')).size !== 5) return null
  // the club as it plays today, found by tag when the coach carries a former club's `H:` id
  const team = WORLD_TEAMS.find(t => t.id === coach.clubId) ?? WORLD_TEAMS.find(t => clubKey(t.tag) === clubTag)
  const tag = team?.tag ?? coach.clubTag ?? 'TEAM'
  const palette: Record<string, string> = { EDG: '#e63a48', PRX: '#f24b9a', GEN: '#cfab56', FNC: '#ff792b', BLG: '#4098ef', FPX: '#ef5734', DRG: '#7c69ed', XLG: '#f2a442', T1: '#ef394c', G2: '#c6d0df', NRG: '#fa6558', SEN: '#ed364a' }
  const id = team?.id ?? coach.clubId
  return { id, tag, name: team?.name ?? tag, crest: crestUrl(id), color: palette[tag] ?? '#54a9d8', era: squadEra(players as PlayerCard[]) }
}

/**
 * The years a card stands for: today's card is 2026, an event card its event's
 * year, a 彩卡 its night, a retired card his career. Null when nobody knows
 * (an archived former card, a 彩蛋卡).
 */
const EVENT_YEAR: Record<string, { year: number; name: string }> = {
  'seoul-2024': { year: 2024, name: '2024 首尔冠军赛' },
  'bangkok-2025': { year: 2025, name: '2025 曼谷大师赛' },
  'los-angeles-2023': { year: 2023, name: '2023 洛杉矶冠军赛' },
}
function yearsOf(p: PlayerCard): number[] | null {
  if (p.event && EVENT_YEAR[p.event]) return [EVENT_YEAR[p.event].year]
  if (p.legend) return [p.legend.year]
  if (p.retired && p.afterglow?.span) {
    const [a, b] = p.afterglow.span.split('–')
    const from = Number(a), to = b ? Number(a.slice(0, 4 - b.length) + b) : from
    return Number.isFinite(from) && Number.isFinite(to) ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : null
  }
  if (p.former || p.event) return null
  return [2026]
}

/**
 * 同期阵容 (owner, 2026-10-20: 「队里选手五个人都是一个时期的背景底板更帅一点」):
 * the five share a year — today's roster, one event's lineup, the nights of one
 * season. Returns that year and what to call it, or null for a five from
 * different times.
 */
export function squadEra(players: PlayerCard[]): { year: number; label: string } | null {
  let common: number[] | undefined
  for (const p of players) {
    const ys = yearsOf(p)
    if (!ys) return null
    common = common === undefined ? ys : common.filter((y) => ys.includes(y))
    if (!common.length) return null
  }
  if (!common?.length) return null
  const year = Math.max(...common)
  const events = new Set(players.map((p) => p.event ?? ''))
  const one = events.size === 1 ? EVENT_YEAR[[...events][0]] : undefined
  const label = one ? one.name : players.every((p) => !p.event && !p.legend && !p.retired) ? '2026 现役阵容' : `${year} 同期阵容`
  return { year, label }
}

/**
 * Same vector artwork is used by the live board and exported share image.
 * A five from one time gets the full treatment — brighter light, gold rules, its
 * year across the plate; a five pieced together from different years a quieter one.
 */
export function teamBackdrop(color: string, era?: { year: number } | null) {
  const svg = era
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><radialGradient id="g"><stop stop-color="${color}" stop-opacity=".62"/><stop offset="1" stop-color="#080e18" stop-opacity="0"/></radialGradient><radialGradient id="h" cx=".2" cy=".1" r=".6"><stop stop-color="#f4d58d" stop-opacity=".16"/><stop offset="1" stop-color="#f4d58d" stop-opacity="0"/></radialGradient><linearGradient id="b" x2="1" y2="1"><stop stop-color="#16243a"/><stop offset="1" stop-color="#060a12"/></linearGradient><linearGradient id="gold" x2="1"><stop stop-color="#f4d58d" stop-opacity="0"/><stop offset=".5" stop-color="#f4d58d"/><stop offset="1" stop-color="#f4d58d" stop-opacity="0"/></linearGradient><pattern id="p" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M0 22L22 0" stroke="#fff" stroke-opacity=".035"/></pattern></defs><path fill="url(#b)" d="M0 0h1600v900H0z"/><ellipse cx="1150" cy="360" rx="980" ry="760" fill="url(#g)"/><path fill="url(#h)" d="M0 0h1600v900H0z"/><text x="1560" y="760" text-anchor="end" font-family="Impact,Arial Black,sans-serif" font-size="420" font-weight="900" fill="${color}" fill-opacity=".10" letter-spacing="-18">${era.year}</text><path d="M900 0h210L470 900H260zM1180 0h60L600 900h-60zM1360 0h22L742 900h-22z" fill="${color}" opacity=".13"/><path fill="url(#p)" d="M0 0h1600v900H0z"/><path d="M0 16h520l110 80h970M0 882h940l90-65h570" fill="none" stroke="#f4d58d" stroke-opacity=".7" stroke-width="2.5"/><path d="M0 26h500l104 76h996" fill="none" stroke="${color}" stroke-opacity=".6" stroke-width="1.5"/><path d="M24 16h140M1437 882h140" stroke="#f4d58d" stroke-width="7"/><path d="M640 96h960" stroke="url(#gold)" stroke-width="1"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><radialGradient id="g"><stop stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="#080e18" stop-opacity="0"/></radialGradient><linearGradient id="b" x2="1" y2="1"><stop stop-color="#111b2a"/><stop offset="1" stop-color="#070b13"/></linearGradient></defs><path fill="url(#b)" d="M0 0h1600v900H0z"/><ellipse cx="1160" cy="380" rx="900" ry="700" fill="url(#g)"/><path d="M940 0h170L480 900H310z" fill="${color}" opacity=".05"/><path d="M0 16h520l110 80h970M0 882h940l90-65h570" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="2"/></svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
