/**
 * The 78 clubs, without the 518 players.
 *
 * world.json is one file and 370 KB of it is rosters, so anything that reached
 * for a club's name or region used to drag every player's attributes along
 * with it — including the front page, which wants a club name for the
 * 「继续上次存档」 line and two integers for the counts underneath, and was
 * downloading the whole game to get them.
 *
 * A named import lets the bundler leave the players behind. That is the entire
 * reason this file exists: world.ts imports the JSON's default export and
 * needs both halves, and a module cannot be half-imported. This one imports
 * only `teams`, and world.ts re-exports it so there is still exactly one
 * WORLD_TEAMS in the program.
 */
import { teams, meta } from '../data/world.json'

export interface RawTeam {
  id: string; name: string; tag: string; region: string; tier: number; league: string
  rating: number; budget: number; reputation: number; roster: string[]
  coach: { name: string; tactics: number; development: number; motivation: number; assistants?: string[] } | null
  facilities: number
}

export const WORLD_TEAMS = teams as unknown as RawTeam[]

/**
 * Every real analyst in the world, and there are very few.
 *
 * Liquipedia records an analyst for only a handful of clubs, and this project
 * does not invent people — so an analyst is a genuinely scarce hire rather than
 * another row in the same list as the assistant coaches.
 */
export const WORLD_ANALYSTS = ((meta as { analysts?: unknown[] })?.analysts ?? []) as {
  name: string; from: string; spec: string
  tactics: number; development: number; motivation: number
}[]
