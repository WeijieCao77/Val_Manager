/**
 * 对手针对 — the rest of the league watches your tape.
 *
 * Two numbers decide how ready an opponent is for you.
 *
 * 针对度 (`heat`, 0–100) is how much of the league's attention you have. It
 * climbs with every win and every trophy and falls hard with a loss: +3 a
 * win, −8 a defeat, so it holds still at about 73% — a club winning more
 * than that is studied more, a club losing more is left alone. Winter
 * cools it to 60%.
 *
 * 被摸透 (`read`, 0–1, per map) is how much of what you are about to bring
 * they have already seen. Every official map on the same five agents and the
 * same dials teaches them a little more; three in a row and they know it.
 * Changing the sheet makes their homework partly wrong (in proportion to the
 * agents that changed), and moving the dials does too.
 *
 * An AI club facing you adds prepMax × heat × (35% + 65% × read) to its
 * strength on that map. So the one sheet you drilled to the ceiling — the
 * familiarity bonus that only grows by repeating it — is exactly what a
 * contender is waiting for. That is the choice this file exists to make:
 * the comfort of the practised comp against the surprise of a new one.
 *
 * A 宿敌 (nemesis) is the contender you beat most often in the season that
 * made you famous: the next season it prepares 40% harder for you, gets a
 * war chest and shops every week the window is open.
 *
 * Scrims are practice and teach nobody anything. Only the managed club is
 * studied: AI clubs never face a manager whose habits could be read.
 */
import { compKey } from './comp'
import { spec } from './difficulty'
import type { Fixture, GameState, Tactics } from './types'

export const HEAT_WIN = 3
export const HEAT_LOSS = 8
export const HEAT_TITLE = { regional: 8, international: 15 }
/** what is left of the attention after a winter */
export const HEAT_WINTER = 0.6
/** official maps on an unchanged plan until they know it completely */
export const READ_FULL = 3
/** the least prep a contender brings: they study your players whatever you run */
export const PREP_FLOOR = 0.35
/** how much harder the nemesis prepares */
export const NEMESIS_PREP = 1.4
/** heat at the end of a season it takes for a nemesis to declare */
export const NEMESIS_HEAT = 50
/** tier-one money a nemesis finds for the winter */
export const NEMESIS_CHEST = 1_500_000
/** two plans are the same if every dial is within this */
const DIAL_SAME = 10

export interface MapRead {
  key: string
  dials: [number, number, number, number]
  nSheet: number
  nDial: number
}

export interface ScoutState {
  heat: number
  reads: Record<string, MapRead>
  /** this season's wins over each club, knockout and international worth two */
  beat: Record<string, number>
}

export const scoutOf = (state: GameState): ScoutState =>
  (state.scout ??= { heat: 0, reads: {}, beat: {} })

const dialsOf = (t: Tactics): [number, number, number, number] =>
  [t.pace, t.aggression, t.utility, t.adaptability]

const overlap = (a: string, b: string): number => {
  const bs = b.split('|')
  let n = 0
  for (const x of a.split('|')) {
    const i = bs.indexOf(x)
    if (i >= 0) { n++; bs.splice(i, 1) }
  }
  return n / 5
}

/** How much of this plan on this map the league has already seen, 0–1. */
export function readOf(
  state: GameState, map: string, agents: Record<string, string>, t: Tactics,
): { read: number; sheet: number; dials: number } {
  const r = state.scout?.reads[map]
  if (!r) return { read: 0, sheet: 0, dials: 0 }
  const key = compKey(agents)
  const sheetSeen = Math.min(1, r.nSheet / READ_FULL) * (key === r.key ? 1 : overlap(key, r.key))
  const now = dialsOf(t)
  const same = now.every((v, i) => Math.abs(v - r.dials[i]) <= DIAL_SAME)
  const dialSeen = same ? Math.min(1, r.nDial / READ_FULL) : 0
  return { read: 0.65 * sheetSeen + 0.35 * dialSeen, sheet: sheetSeen, dials: dialSeen }
}

export const isNemesis = (state: GameState, teamId: string): boolean =>
  state.nemesis?.teamId === teamId && state.nemesis.year === state.year

/**
 * The strength an AI club brings to an official map against the managed club.
 * Zero for everyone else, for scrims, and in the card game.
 */
export function prepEdge(
  state: GameState, teamId: string, oppId: string | undefined, map: string,
  oppAgents: Record<string, string>, oppTactics: Tactics, official: boolean,
): number {
  if (!official || !oppId || oppId !== state.myTeam || teamId === state.myTeam) return 0
  const heat = state.scout?.heat ?? 0
  if (heat <= 0) return 0
  const { read } = readOf(state, map, oppAgents, oppTactics)
  const nem = isNemesis(state, teamId) ? NEMESIS_PREP : 1
  return spec(state).prepMax * (heat / 100) * (PREP_FLOOR + (1 - PREP_FLOOR) * read) * nem
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * After one of our official matches: the tape goes out, the league's
 * attention moves. `plans` is what we brought to each map, read before the
 * match changed anything.
 */
export function recordMatch(
  state: GameState, f: Fixture,
  plans: Record<string, { agents: Record<string, string>; tactics: Tactics }>,
  knockout: boolean,
): void {
  if (f.scrim || !f.result) return
  const sc = scoutOf(state)
  for (const m of f.result.maps) {
    const plan = plans[m.map]
    if (!plan) continue
    const key = compKey(plan.agents)
    const dials = dialsOf(plan.tactics)
    const r = sc.reads[m.map]
    if (!r) {
      sc.reads[m.map] = { key, dials, nSheet: 1, nDial: 1 }
      continue
    }
    const sameDials = dials.every((v, i) => Math.abs(v - r.dials[i]) <= DIAL_SAME)
    r.nSheet = r.key === key ? Math.min(READ_FULL + 1, r.nSheet + 1) : Math.floor(r.nSheet * overlap(key, r.key)) + 1
    r.nDial = sameDials ? Math.min(READ_FULL + 1, r.nDial + 1) : 1
    r.key = key
    r.dials = dials
  }
  const mineA = f.teamA === state.myTeam
  const won = (f.result.mapsWonA > f.result.mapsWonB) === mineA
  const opp = mineA ? f.teamB : f.teamA
  sc.heat = clamp(sc.heat + (won ? HEAT_WIN : -HEAT_LOSS), 0, 100)
  if (won && state.teams[opp]) sc.beat[opp] = (sc.beat[opp] ?? 0) + (knockout ? 2 : 1)
}

/** A trophy puts more eyes on you than any single win. */
export function scoutTitle(state: GameState, international: boolean): void {
  const sc = scoutOf(state)
  sc.heat = clamp(sc.heat + (international ? HEAT_TITLE.international : HEAT_TITLE.regional), 0, 100)
}

/**
 * The winter: attention cools, the tape gets old, and the contender you beat
 * most may decide this is personal. Call before the new season's year is set,
 * with the year that is starting.
 */
export function scoutWinter(state: GameState, nextYear: number, notes: string[]): void {
  const sc = scoutOf(state)
  const hot = sc.heat >= NEMESIS_HEAT
  const me = state.teams[state.myTeam]
  let pick: string | undefined
  if (hot && me) {
    pick = Object.entries(sc.beat)
      .filter(([id]) => id !== state.myTeam && state.teams[id]?.tier === 1)
      .sort((a, b) => b[1] - a[1] || (state.teams[b[0]].rating - state.teams[a[0]].rating))[0]?.[0]
  }
  if (pick) {
    const t = state.teams[pick]
    state.nemesis = { teamId: pick, year: nextYear }
    t.budget += NEMESIS_CHEST
    const text = `⚔️ ${t.name} 把我们列为头号对手：新赛季加倍研究我们的比赛，休赛期砸钱补强。`
    notes.push(text)
    state.news.push({ day: state.day, kind: 'league', important: true, text })
  } else {
    state.nemesis = undefined
  }
  sc.heat = Math.round(sc.heat * HEAT_WINTER)
  for (const r of Object.values(sc.reads)) {
    r.nSheet = Math.floor(r.nSheet / 2)
    r.nDial = Math.floor(r.nDial / 2)
  }
  sc.beat = {}
}

/** 针对度 in words, for the chip and the tactics panel. */
export function heatLabel(heat: number): string {
  return heat >= 75 ? '重点针对' : heat >= 45 ? '很受关注' : heat >= 20 ? '有人研究' : '没人盯'
}
