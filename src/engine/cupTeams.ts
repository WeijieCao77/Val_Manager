/** Cup clubs use ordinary, unlevelled cards and the same paper score as users. */
import { COACH_CARDS, BASE_PLAYER_CARDS, SQUAD_SLOTS, squadPaper, squadRating } from './cards'
import type { Squad } from './cards'
import { WORLD_TEAMS } from './teams'

export const CUP_TEAMS = WORLD_TEAMS.map(team => {
  const players = BASE_PLAYER_CARDS.filter(c => c.clubId === team.id && team.roster.includes(c.playerId))
    .sort((a, b) => a.id.localeCompare(b.id))
  const coach = COACH_CARDS.find(c => c.clubId === team.id && c.name === team.coach?.name)?.id ?? null
  let best: Squad = { slots: [], coach }, bestScore = -Infinity
  const slots: string[] = []
  // At most a small professional roster. Enumerate legal distinct-person
  // seatings once, then cache; no world creation or search on each match.
  const used = new Set<string>()
  const visit = () => {
    if (slots.length === SQUAD_SLOTS.length) {
      const candidate = { slots: [...slots], coach }
      const score = squadPaper(candidate).score
      if (score > bestScore) { best = candidate; bestScore = score }
      return
    }
    for (const c of players) {
      if (used.has(c.playerId)) continue
      used.add(c.playerId); slots.push(c.id)
      visit()
      slots.pop(); used.delete(c.playerId)
    }
  }
  visit()
  if (best.slots.length !== 5) throw new Error(`杯赛俱乐部 ${team.id} 缺少五名现役卡`)
  return { id: team.id, name: team.name, tag: team.tag, squad: best, rating: squadRating(best) }
})

const byId = new Map(CUP_TEAMS.map(t => [t.id, t]))
export const cupTeam = (id: string) => byId.get(id)
