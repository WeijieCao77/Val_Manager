/**
 * Putting a collection of cards on a server against a real club.
 *
 * The card mode does not get its own match engine. It borrows the one the
 * career mode uses — veto, economy, round-by-round, the lot — by assembling a
 * throwaway `GameState` whose managed club is the five cards you picked. That
 * is why a well-linked 78-rated five can beat a pile of 85s: composition,
 * calling and cohesion are read by the same code that reads them in a VCT
 * season.
 */
import { createNewGame, WORLD_TEAMS } from './world'
import { simulateMatch } from './match'
import { NEUTRAL } from './bonds'
import { Rng, clamp } from './rng'
import {
  cardById, chemistry, isCoachCard, isPlayerCard, personOf, ratingAt, SQUAD_SLOTS,
} from './cards'
import type { Squad } from './cards'
import type { PlayerCard } from './cards'
import type { GameState, MatchResult, Player, Role } from './types'
import { defaultTactics } from './types'

export const ARENA_TEAM = 'ARENA'

/**
 * What chemistry is worth, in rating points per point of chemistry.
 *
 * Read this together with the two other places chemistry lands: the bond table
 * below (worth about ±4.5 at the extremes, via squadHarmony) and the teamwork
 * and communication lift (about ±0.5). Routed through those two alone it was
 * worth a third of a rating point, which made the links decorative and "pick
 * the biggest numbers" the correct answer, so this direct term carries most of
 * it. Measured, not guessed: a same-club five four to six points below an
 * all-star five wins the head-to-head; nine points below, it loses.
 */
const CHEM_RATING = 0.12

export interface ArenaSquad extends Squad {
  /** display name for the assembled club */
  name?: string
  /** three-letter tag shown on the scoreboard */
  tag?: string
}

/**
 * Turn a card into the player who walks onto the server.
 *
 * The numbers come from the CARD, not from world.json. That distinction was
 * missing and it quietly made the whole彩卡 tier cosmetic: a 96-rated 2024
 * 首尔 FMVP ZmjjKK played at ZmjjKK's ordinary 85, because the clone was built
 * from the world player and never read the card it came from. Levels had the
 * same problem in miniature.
 */
function levelled(p: Player, card: PlayerCard, level: number, misfit: boolean): Player {
  const bump = Math.max(0, level)
  const attrs = { ...card.attrs }
  for (const k of Object.keys(attrs) as (keyof typeof attrs)[]) {
    attrs[k] = clamp(Math.round(attrs[k] + bump), 1, 99)
  }
  return {
    ...p,
    attrs,
    // A card standing in a role it does not cover is worse at it. The engine
    // already punishes the resulting hole in the composition; this is the
    // separate cost of the individual being out of position.
    overall: clamp(ratingAt(card.rating, bump) - (misfit ? 5 : 0), 1, 99),
    traits: p.traits ? [...p.traits] : p.traits,
    // cards arrive rested and confident: the card mode has no season to tire
    // anyone out, and form drift would make the same squad a different squad
    // between two matches for no reason the player could see
    form: 76, morale: 84, fatigue: 0, injuredUntil: 0,
    season: { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0 },
    career: { maps: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0, mvps: 0 },
    xp: {},
  }
}

export interface Arena {
  state: GameState
  /** arena player id -> the card it came from, for reading match lines back */
  cardOf: Record<string, string>
}

/**
 * Build the throwaway world a card match is played in.
 *
 * Cloned under fresh ids rather than reused: your Gen.G cards can be drawn
 * against Gen.G, and one `Player` object on both sides of the server would
 * have had t3xture fragging himself.
 */
export function buildArena(
  squad: ArenaSquad, level: (cardId: string) => number, seed: number,
): Arena {
  const state = createNewGame(WORLD_TEAMS[0].id, '卡组', seed)
  const chem = chemistry(squad)
  const cardOf: Record<string, string> = {}
  const roster: string[] = []
  // The squad builder will not let you seat a man twice, but a save written
  // before that rule — or edited by hand — can still hold the ordinary Derke
  // and the 2023 FNATIC Derke in the same five. The engine is the last word,
  // so the second copy is dropped here and the side plays short.
  const seated = new Set<string>()

  squad.slots.forEach((cardId, i) => {
    if (!cardId) return
    const card = cardById(cardId)
    if (!isPlayerCard(card)) return
    if (seated.has(personOf(card))) return
    seated.add(personOf(card))
    const src = state.players[card.playerId]
    if (!src) return
    const id = `A${i}`
    const misfit = !card.roles.includes(SQUAD_SLOTS[i]) && SQUAD_SLOTS[i] !== '自由人'
    const clone = levelled(src, card, level(cardId), misfit)
    // Chemistry lands in two places, and it has to land hard.
    //
    // Routed through teamwork and communication alone it was worth about a
    // third of a rating point: a same-club five on 86 lost to five scattered
    // 93s by five matches in three hundred, which makes the links decorative
    // and "pick the biggest numbers" the correct answer. Centred on 50 and
    // worth ±6 rating, the same five now wins that comparison — a four-point
    // gap in ability is recoverable by a squad that has actually played
    // together, a fifteen-point one is not.
    const lift = Math.round((chem.score - 50) * 0.14)
    clone.attrs = {
      ...clone.attrs,
      teamwork: clamp(clone.attrs.teamwork + lift, 1, 99),
      communication: clamp(clone.attrs.communication + lift, 1, 99),
    }
    clone.overall = clamp(Math.round(clone.overall + (chem.score - 50) * CHEM_RATING), 1, 99)
    state.players[id] = { ...clone, id, teamId: ARENA_TEAM }
    cardOf[id] = cardId
    roster.push(id)
  })

  const coachCard = squad.coach ? cardById(squad.coach) : undefined
  const mapPrefs: Record<string, number> = {}
  for (const m of Object.keys(state.teams[WORLD_TEAMS[0].id].mapPrefs)) mapPrefs[m] = 50

  state.teams[ARENA_TEAM] = {
    id: ARENA_TEAM,
    name: squad.name ?? '我的卡组',
    tag: squad.tag ?? 'MINE',
    region: 'Americas',
    tier: 1,
    league: '开瓦包',
    rating: 70,
    budget: 0,
    reputation: 60,
    roster,
    coach: isCoachCard(coachCard)
      ? {
        name: coachCard.name,
        tactics: coachCard.tactics,
        development: coachCard.development,
        motivation: coachCard.motivation,
      }
      : null,
    facilities: 60,
    starters: roster.slice(0, 5),
    tactics: defaultTactics(),
    sponsors: [],
    mapPrefs,
    seasonPrize: 0,
    champPoints: 0,
  }
  state.myTeam = ARENA_TEAM

  // The bonds table is what squadHarmony averages. Seeding it from chemistry
  // is what makes a same-club five feel like a team that has practised
  // together, rather than five names that happen to share a logo.
  state.bonds ??= {}
  const bond = Math.round(NEUTRAL + (chem.score - 50) * 0.5)
  for (let i = 0; i < roster.length; i++) {
    for (let j = i + 1; j < roster.length; j++) {
      const a = roster[i]
      const b = roster[j]
      state.bonds[a < b ? `${a}|${b}` : `${b}|${a}`] = clamp(bond, -60, 70)
    }
  }

  return { state, cardOf }
}

export interface ArenaResult {
  win: boolean
  mapsWon: number
  mapsLost: number
  result: MatchResult
  /** per-card scoreboard, best first */
  lines: { cardId: string; kills: number; deaths: number; assists: number; acs: number; maps: number }[]
  mvpCard: string | null
}

/** Play one card-mode match against a real club and read the scoreboard back. */
export function playArenaMatch(
  squad: ArenaSquad, level: (cardId: string) => number, opponentId: string,
  bo: 1 | 3 | 5, seed: number,
): ArenaResult {
  const { state, cardOf } = buildArena(squad, level, seed)
  const rng = new Rng(seed ^ 0x1d0c)
  const result = simulateMatch(state, ARENA_TEAM, opponentId, bo, rng)

  const totals: Record<string, { kills: number; deaths: number; assists: number; acs: number; maps: number }> = {}
  for (const m of result.maps) {
    for (const [pid, l] of Object.entries(m.lines)) {
      const cardId = cardOf[pid]
      if (!cardId) continue
      const t = (totals[cardId] ??= { kills: 0, deaths: 0, assists: 0, acs: 0, maps: 0 })
      t.kills += l.kills
      t.deaths += l.deaths
      t.assists += l.assists
      t.acs += l.acs
      t.maps++
    }
  }
  const lines = Object.entries(totals)
    .map(([cardId, t]) => ({ cardId, ...t, acs: t.maps ? Math.round(t.acs / t.maps) : 0 }))
    .sort((a, b) => b.acs - a.acs)

  return {
    win: result.mapsWonA > result.mapsWonB,
    mapsWon: result.mapsWonA,
    mapsLost: result.mapsWonB,
    result,
    lines,
    mvpCard: result.mvp ? cardOf[result.mvp] ?? null : null,
  }
}

/** The roles a squad is still missing, for the builder's nudge line. */
export function roleGaps(squad: Squad): Role[] {
  const covered = new Set<Role>()
  for (const id of squad.slots) {
    const c = id ? cardById(id) : undefined
    if (isPlayerCard(c)) for (const r of c.roles) covered.add(r)
  }
  return (['决斗者', '先锋', '控场', '哨卫'] as Role[]).filter((r) => !covered.has(r))
}
