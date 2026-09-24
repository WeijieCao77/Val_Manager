import { cardById, isCoachCard, isPlayerCard } from './cards'
import type { Squad } from './cards'
import { WORLD_TEAMS } from './teams'
import { crestUrl } from './dossier'

/** Cosmetic identity only: all five distinct players and their coach must share a club. */
export function squadTeamIdentity(squad: Squad) {
  if (squad.slots.length !== 5 || !squad.coach || squad.slots.some(id => !id)) return null
  const players = squad.slots.map(id => cardById(id!))
  const coach = cardById(squad.coach)
  if (!coach || !isCoachCard(coach) || !coach.clubId || players.some(p => !p || !isPlayerCard(p) || p.clubId !== coach.clubId)) return null
  if (new Set(players.map(p => p && isPlayerCard(p) ? p.playerId : '')).size !== 5) return null
  const team = WORLD_TEAMS.find(t => t.id === coach.clubId)
  const tag = team?.tag ?? coach.clubTag ?? 'TEAM'
  const palette: Record<string, string> = { EDG: '#e63a48', PRX: '#f24b9a', GEN: '#cfab56', FNC: '#ff792b', BLG: '#4098ef', FPX: '#ef5734', DRG: '#7c69ed', XLG: '#f2a442', T1: '#ef394c', G2: '#c6d0df', NRG: '#fa6558', SEN: '#ed364a' }
  return { id: coach.clubId, tag, name: team?.name ?? tag, crest: crestUrl(coach.clubId), color: palette[tag] ?? '#54a9d8' }
}

/** Same vector artwork is used by the live board and exported share image. */
export function teamBackdrop(color: string) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs><radialGradient id="g"><stop stop-color="${color}" stop-opacity=".46"/><stop offset="1" stop-color="#080e18" stop-opacity="0"/></radialGradient><linearGradient id="b" x2="1" y2="1"><stop stop-color="#121e30"/><stop offset="1" stop-color="#070b13"/></linearGradient><pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M0 28L28 0" stroke="#fff" stroke-opacity=".025"/></pattern></defs><path fill="url(#b)" d="M0 0h1600v900H0z"/><ellipse cx="1160" cy="380" rx="900" ry="700" fill="url(#g)"/><path d="M940 0h170L480 900H310zM1300 0h25L695 900h-25z" fill="${color}" opacity=".08"/><path fill="url(#p)" d="M0 0h1600v900H0z"/><path d="M0 16h520l110 80h970M0 882h940l90-65h570" fill="none" stroke="${color}" stroke-opacity=".55" stroke-width="2"/><path d="M24 16h95M1477 882h99" stroke="${color}" stroke-width="6"/></svg>`)
}
