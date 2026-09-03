/**
 * 每日挑战 — one puzzle a day, the same one for everybody.
 *
 * The card mode's problem is not that it gives too little, it is that a
 * session is structurally four minutes long: sign in, open a pack, watch seven
 * fifteen-second matches, done. Measured, half the people who make an account
 * never come back — and no amount of tuning the pack drip fixes a game that
 * runs out of things to do before the coffee is cold.
 *
 * So: something to think about rather than something to watch. The puzzle is
 * derived from the server's date, so every player on earth gets the same one
 * on the same day and can argue about it, and it resets whether or not you
 * solved it. Six guesses, each one narrowing the answer.
 *
 * Nothing here is invented. The four kinds are built from data the game
 * already ships and is already careful about: 518 real players with their real
 * clubs, nationalities, ages and roles; 78 real clubs; the 13 maps and 27
 * agents with the artwork already in public/. There is no weapons round for
 * exactly that reason — the game holds no weapon data, and a quiz that makes
 * its facts up is worse than no quiz.
 */
import { agentCn, AGENTS, ALL_AGENTS, MAPS, mapCn } from './content'
import { natCountry, natName } from './nat'
import { hashStr } from './rng'
import { WORLD_PLAYERS } from './world'
import { WORLD_TEAMS } from './teams'
import { DOSSIER } from './dossier'
import { REGION_CN } from './types'
import type { Region } from './types'
// type-only, so this file has no runtime dependency on gacha.ts — the
// dependency runs the other way, gacha.ts calls newChallenge() to migrate
import type { GachaState, PackKind } from './gacha'

export type ChallengeKind = 'player' | 'team' | 'map' | 'agent'

export const CHALLENGE_TRIES = 6

/**
 * What one attempt costs.
 *
 * Priced off what a day actually earns rather than off feel. A bronze player
 * who does everything available takes 300 from the check-in, about 790 from
 * three quests and about 570 from a full stamina bar of ladder — call it 1660
 * a day; a 大师 player nearer 2700. So 300 is a fifth of a low day and a
 * ninth of a high one, and the 3000 a new account starts with covers ten days
 * of it before a single coin is earned.
 *
 * It has to cost something or it is not a decision, and it has to be small or
 * it competes with the packs it is supposed to feed. Losing is softened
 * rather than free: half the fee comes back, so a day you simply did not know
 * the answer costs 150 — a tenth of a day, which is a shrug, not a punishment.
 */
export const CHALLENGE_COST = 300
export const CHALLENGE_REFUND = 150

export interface ChallengeState {
  /** the server date of the puzzle in progress, YYYY-MM-DD */
  day: string | null
  /** what has been guessed, oldest first — player/team ids, or map/agent names */
  guesses: string[]
  /** the fee has been taken for this day's puzzle */
  paid: boolean
  solved: boolean
  /** finished, either way */
  done: boolean
  /** consecutive days solved */
  streak: number
  best: number
  /** how many have ever been solved */
  total: number
}

export const newChallenge = (): ChallengeState => ({
  day: null, guesses: [], paid: false, solved: false, done: false,
  streak: 0, best: 0, total: 0,
})

/**
 * Which kind of puzzle a given date holds.
 *
 * A fixed seven-day cycle rather than a roll, so it is predictable — a player
 * learns that the hard one comes round on a rhythm, and a friend saying "今天
 * 这个地图我一次就中了" means the same day to both of them. Players get three
 * of the seven because they are what this game is actually about.
 */
const CYCLE: ChallengeKind[] = ['player', 'agent', 'team', 'player', 'map', 'team', 'player']

/** Days since the epoch, from a YYYY-MM-DD the server handed us. */
const dayNumber = (day: string): number =>
  Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000)

/**
 * Which kind of thing today's puzzle is, for this account.
 *
 * It used to be the same for everybody, and so did the answer — which meant one
 * person could solve it, post the answer, and every other account collected the
 * reward for typing it in. With alt accounts that was not even sharing, it was
 * a coin printer: solve once, cash in five times.
 *
 * So the account is mixed in. The id is hashed here and never leaves the
 * device; two devices signed into the SAME account still get the same puzzle,
 * which is the property that has to hold.
 */
export function kindFor(day: string, who = ''): ChallengeKind {
  const n = dayNumber(day) + (who ? hashStr(`kind:${who}`) : 0)
  return CYCLE[((n % CYCLE.length) + CYCLE.length) % CYCLE.length]
}

// ------------------------------------------------------------------ pools

/**
 * Everything that can be typed in, and everything that can be the answer.
 *
 * They are not the same list. Any of the 518 players may be guessed — a
 * Challengers name is a legitimate thing to try — but the answer only ever
 * comes from a tier-one roster with a photograph on file, because a puzzle
 * whose answer nobody could have heard of is a coin flip with extra steps.
 */
export interface Choice {
  id: string
  /** what the player types and reads */
  name: string
  /** the line under it in the picker, for telling two of them apart */
  hint: string
  /** which pool it came from — never shown before it has been guessed */
  kind?: ChallengeKind
}

const TIER1 = new Set(WORLD_TEAMS.filter((t) => t.tier === 1).map((t) => t.id))

/**
 * Everything is typed in Chinese OR English, whichever the player reaches for.
 *
 * The picker matches on the name and the hint together, so putting both
 * spellings across the two fields is what makes 「铁臂」 and 「Breach」 both
 * find the same agent. Reported the hard way: agents were English-only, so a
 * Chinese player could not search for the thing this game is written in.
 * Regions get the same treatment — 「美洲」 finds Leviatán.
 */
const regionCn = (r: string): string => REGION_CN[r as Region] ?? r

const playerChoices = (): Choice[] =>
  WORLD_PLAYERS.map((p) => ({
    id: p.id,
    name: p.ign,
    hint: `${WORLD_TEAMS.find((t) => t.id === p.teamId)?.tag ?? '自由'} · ${regionCn(p.region)}`,
  }))

const teamChoices = (): Choice[] =>
  WORLD_TEAMS.map((t) => ({
    id: t.id, name: t.name, hint: `${t.tag} · ${regionCn(t.region)}`,
  }))

const mapChoices = (): Choice[] =>
  MAPS.map((m) => ({ id: m, name: mapCn(m), hint: m }))

// 铁臂 and Breach are the same agent, and both have to find him
const agentChoices = (): Choice[] =>
  ALL_AGENTS.map((a) => ({
    id: a,
    name: agentCn(a),
    hint: `${a}${roleOfAgent(a) ? ` · ${roleOfAgent(a)}` : ''}`,
  }))

/** The in-game role an agent is filed under, from the game's own table. */
export function roleOfAgent(agent: string): string | null {
  for (const [role, list] of Object.entries(AGENTS)) {
    if (role !== '自由人' && list.includes(agent)) return role
  }
  return null
}

export const KIND_CN: Record<ChallengeKind, string> = {
  player: '选手', team: '战队', map: '地图', agent: '英雄',
}

/**
 * Everything, in one list.
 *
 * The first cut printed 「猜地图」 at the top, which hands over half the answer
 * before a guess is made — thirteen maps and six tries is not a puzzle. What
 * kind of thing today is IS the puzzle now, so the picker holds all 636 of
 * them and the first thing a guess tells you is whether you are even looking
 * in the right place.
 *
 * The ids are unique across the four pools (P… for players, T… for clubs, and
 * maps and agents are their own names), so a guess needs no prefix to say
 * which list it came from.
 */
export function choicesFor(kind: ChallengeKind): Choice[] {
  return kind === 'player' ? playerChoices()
    : kind === 'team' ? teamChoices()
      : kind === 'map' ? mapChoices()
        : agentChoices()
}

let ALL: Choice[] | null = null

export function allChoices(): Choice[] {
  if (!ALL) {
    ALL = ([
      ['player', playerChoices()], ['team', teamChoices()],
      ['map', mapChoices()], ['agent', agentChoices()],
    ] as [ChallengeKind, Choice[]][]).flatMap(([kind, list]) =>
      list.map((c) => ({ ...c, kind })))
  }
  return ALL
}

export const kindOfId = (id: string): ChallengeKind | null =>
  allChoices().find((c) => c.id === id)?.kind ?? null

/** The subset a day's answer is drawn from. */
function answerPool(kind: ChallengeKind): string[] {
  if (kind === 'player') {
    // a tier-one roster AND a photograph on file: the picture IS the puzzle,
    // so a player without one cannot be the answer. The comment above used to
    // claim this and the code did not do it.
    return WORLD_PLAYERS
      .filter((p) => TIER1.has(p.teamId ?? '') && !!DOSSIER.players?.[p.id]?.img)
      .map((p) => p.id)
  }
  if (kind === 'team') return WORLD_TEAMS.filter((t) => TIER1.has(t.id)).map((t) => t.id)
  if (kind === 'map') return MAPS.slice()
  return ALL_AGENTS.slice()
}

/**
 * The answer for a date, which every copy of the game agrees on.
 *
 * Seeded on the date alone — not on the account — because the whole point is
 * that it is the same puzzle everywhere. It is derivable on the client, which
 * is not worth defending against: the simulation, the collection and the odds
 * are all in the browser already, and somebody who reads the bundle to win a
 * word game has beaten only themselves.
 */
export function answerFor(day: string, who = ''): string {
  const kind = kindFor(day, who)
  const pool = answerPool(kind)
  return pool[hashStr(`challenge:${kind}:${day}:${who}`) % pool.length]
}

// ------------------------------------------------------------------ hints

export type HintMark = 'hit' | 'near' | 'miss' | 'up' | 'down'

export interface HintCell {
  label: string
  value: string
  mark: HintMark
}

export interface GuessRow {
  id: string
  name: string
  /** the face, crest, map or agent art, where there is one */
  img?: string
  cells: HintCell[]
}

const num = (guess: number, answer: number, slack: number): HintMark =>
  guess === answer ? 'hit'
    : Math.abs(guess - answer) <= slack ? 'near'
      : guess < answer ? 'up' : 'down'

const same = (a: unknown, b: unknown): HintMark => (a === b ? 'hit' : 'miss')

/**
 * The picture for anything guessable, in a frame that never says which.
 *
 * A player's is looked up rather than assumed: 52 of the 518 have no
 * photograph, and one more lost his the day it turned out to be somebody else
 * with the same name. `faces/${id}.webp` for all of them would have been a
 * broken image in the guess list — and, on a day the answer was one of them, a
 * broken puzzle for everybody on earth.
 */
export function imgOf(kind: ChallengeKind, id: string): string | undefined {
  if (kind === 'player') {
    const d = DOSSIER.players?.[id]
    return d?.img ? `faces/${d.img}` : undefined
  }
  return kind === 'team' ? `logos/${id}.webp`
    : kind === 'map' ? `maps/${id}.webp`
      : `agents/${id.replace(/[^A-Za-z]/g, '')}.webp`
}

/**
 * One guess, marked against the answer.
 *
 * The first cell is always WHAT IT IS, because that is now the first half of
 * the puzzle: the screen no longer says 「猜地图」 at the top, which handed
 * over half the answer before a guess was made. Guess a player when the answer
 * is a map and all you learn is that you are looking in the wrong place —
 * which is worth learning, and is why the type is a cell rather than a label.
 *
 * `up` and `down` read from the guess's side: 「↑」 means the answer is higher
 * than what was just guessed, which is the direction a player needs to move.
 */
export function evaluate(kind: ChallengeKind, answerId: string, guessId: string): GuessRow {
  const guessKind = kindOfId(guessId) ?? kind
  const typeCell: HintCell = {
    label: '类型', value: KIND_CN[guessKind], mark: same(guessKind, kind),
  }
  if (guessKind !== kind) {
    const name = allChoices().find((c) => c.id === guessId)?.name ?? guessId
    return { id: guessId, name, img: imgOf(guessKind, guessId), cells: [typeCell] }
  }

  if (kind === 'player') {
    const a = WORLD_PLAYERS.find((p) => p.id === answerId)
    const g = WORLD_PLAYERS.find((p) => p.id === guessId)
    if (!a || !g) return { id: guessId, name: guessId, cells: [] }
    const gTeam = WORLD_TEAMS.find((t) => t.id === g.teamId)
    const aRoles = new Set(g.roles ?? [g.role])
    const shares = (a.roles ?? [a.role]).some((r) => aRoles.has(r))
    return {
      id: g.id, name: g.ign, img: imgOf('player', g.id),
      cells: [
        typeCell,
        { label: '赛区', value: String(g.region), mark: same(g.region, a.region) },
        { label: '战队', value: gTeam?.tag ?? '自由', mark: same(g.teamId, a.teamId) },
        {
          label: '位置',
          value: String(g.role),
          mark: g.role === a.role ? 'hit' : shares ? 'near' : 'miss',
        },
        {
          label: '国籍', value: natName(g.nat),
          // 中国台湾 / 中国香港 / 中国澳门 against 中国 is the same country,
          // not the same code — a near miss, like sharing one of two roles
          mark: same(g.nat, a.nat) === 'hit' ? 'hit'
            : natCountry(g.nat) && natCountry(g.nat) === natCountry(a.nat) ? 'near' : 'miss',
        },
        { label: '年龄', value: String(g.age), mark: num(g.age, a.age, 1) },
        { label: '能力', value: String(g.overall), mark: num(g.overall, a.overall, 2) },
      ],
    }
  }

  if (kind === 'team') {
    const a = WORLD_TEAMS.find((t) => t.id === answerId)
    const g = WORLD_TEAMS.find((t) => t.id === guessId)
    if (!a || !g) return { id: guessId, name: guessId, cells: [] }
    return {
      id: g.id, name: g.name, img: imgOf('team', g.id),
      cells: [
        typeCell,
        { label: '赛区', value: String(g.region), mark: same(g.region, a.region) },
        {
          label: '分级',
          value: g.tier === 1 ? 'VCT' : '次级',
          mark: same(g.tier, a.tier),
        },
        { label: '首字母', value: g.tag.slice(0, 1), mark: same(g.tag[0], a.tag[0]) },
        { label: '评分', value: String(g.rating), mark: num(g.rating, a.rating, 2) },
        { label: '声望', value: String(g.reputation), mark: num(g.reputation, a.reputation, 4) },
      ],
    }
  }

  if (kind === 'agent') {
    const role = roleOfAgent(guessId)
    return {
      id: guessId, name: agentCn(guessId), img: imgOf('agent', guessId),
      cells: [typeCell, {
        label: '定位', value: role ?? '?',
        mark: same(role, roleOfAgent(answerId)),
      }],
    }
  }

  // maps carry no facts this game actually holds, so the picture is the puzzle
  return { id: guessId, name: mapCn(guessId), img: imgOf('map', guessId), cells: [typeCell] }
}

/**
 * How much of the picture is showing.
 *
 * Every round is a visual round now — a face, a crest, a map or an agent, all
 * in the same frame, all blurred past telling which is which. Working out WHAT
 * you are looking at is the first half of the puzzle. Returned as a fraction so
 * the screen decides what blur and what zoom that means.
 */
export const revealed = (used: number): number =>
  Math.min(1, used / (CHALLENGE_TRIES - 1))

/**
 * How finely the picture is drawn: cells across the frame.
 *
 * The screen shrinks the frame to this many pixels wide and grows it back,
 * so nothing finer than a cell survives — at six cells a crest is a few
 * patches of colour whatever its shape, and a map's hard top and bottom
 * edges are averaged into the backdrop. Blur was tried first and is the
 * wrong tool: it softens edges but keeps every large shape, and the first
 * screenshots from the group were a map you could name unguessed and a
 * crest you could read through it. Each miss buys a real step (6 → 10 → 17
 * → 28 → 48, a factor of 1.68), and the last guess is made on the picture
 * as it is. Relative to the frame rather than in pixels, so a phone and a
 * desktop are equally hard.
 */
export const detail = (used: number): number =>
  used >= CHALLENGE_TRIES - 1 ? Infinity : Math.round(6 * 1.68 ** used)

// ---------------------------------------------------------------- rewards

export interface ChallengeReward {
  pack?: PackKind
  coins: number
  /** a seventh consecutive day is worth something on its own */
  streakPack?: PackKind
}

/**
 * What solving it is worth.
 *
 * Steep on the first guess, because 十连包 is the one thing in this game
 * nobody sees — sixteen people opened one in a month — and a puzzle solved
 * cold is exactly the moment to hand one over. Everything else is priced
 * above the 300 it cost to sit down: the worst possible win still nets a
 * 试训包 for less than half its shop price.
 */
export function rewardFor(tries: number, solved: boolean, streak: number): ChallengeReward {
  if (!solved) return { coins: CHALLENGE_REFUND }
  const pack: PackKind = tries <= 1 ? 'ten' : tries <= 3 ? 'elite' : 'scout'
  const out: ChallengeReward = { pack, coins: 120 + Math.min(streak, 10) * 30 }
  if (streak > 0 && streak % 7 === 0) out.streakPack = 'ten'
  return out
}

// ------------------------------------------------------------------ play

/** Bring the state onto today's puzzle, resetting yesterday's attempt. */
export function openChallenge(c: ChallengeState, today: string): ChallengeState {
  if (c.day === today) return c
  // a day missed breaks the run — checked against the puzzle actually played,
  // never against a clock the device controls
  const yesterday = new Date(`${today}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const consecutive = c.day === yesterday.toISOString().slice(0, 10) && c.solved
  c.day = today
  c.guesses = []
  c.paid = false
  c.solved = false
  c.done = false
  if (!consecutive) c.streak = 0
  return c
}

export const triesLeft = (c: ChallengeState): number =>
  Math.max(0, CHALLENGE_TRIES - c.guesses.length)

/** Why today's puzzle cannot be played, or null when it can. */
export function challengeBlock(g: GachaState, today: string): string | null {
  const c = g.challenge
  if (!c) return null
  if (c.day === today && c.done) return '今天的挑战已经结束了，明天换一道。'
  const owed = c.day === today && c.paid ? 0 : CHALLENGE_COST
  if (g.coins < owed) return `金币不够——入场要 ${CHALLENGE_COST} 金币。`
  return null
}

export interface ChallengeTurn {
  row: GuessRow
  finished: boolean
  solved: boolean
  reward?: ChallengeReward
}

/**
 * One guess, fee taken and prize paid.
 *
 * The fee comes off the first guess of the day rather than on opening the
 * screen: reading the puzzle and deciding not to play it should be free, and
 * a player who opens the tab to see what today is has not spent anything.
 */
export function guessChallenge(g: GachaState, today: string, guessId: string): ChallengeTurn {
  const c = (g.challenge ??= newChallenge())
  openChallenge(c, today)
  const answer = answerFor(today, g.id)
  const kind = kindFor(today, g.id)

  if (!c.paid) {
    g.coins -= CHALLENGE_COST
    c.paid = true
  }

  const row = evaluate(kind, answer, guessId)
  c.guesses = [...c.guesses, guessId]

  if (guessId === answer) {
    c.solved = true
    c.done = true
    c.streak += 1
    c.best = Math.max(c.best, c.streak)
    c.total += 1
    const reward = rewardFor(c.guesses.length, true, c.streak)
    g.coins += reward.coins
    for (const p of [reward.pack, reward.streakPack]) {
      if (p) g.packs[p] = (g.packs[p] ?? 0) + 1
    }
    return { row, finished: true, solved: true, reward }
  }

  if (c.guesses.length >= CHALLENGE_TRIES) {
    c.done = true
    c.streak = 0
    const reward = rewardFor(c.guesses.length, false, 0)
    g.coins += reward.coins
    return { row, finished: true, solved: false, reward }
  }

  return { row, finished: false, solved: false }
}

/** Everything the screen needs to draw today, without deciding any of it. */
export function challengeToday(g: GachaState, today: string): {
  kind: ChallengeKind
  answer: string
  state: ChallengeState
  rows: GuessRow[]
} {
  const c = (g.challenge ??= newChallenge())
  openChallenge(c, today)
  const answer = answerFor(today, g.id)
  const kind = kindFor(today, g.id)
  return {
    kind, answer, state: c,
    rows: c.guesses.map((id: string) => evaluate(kind, answer, id)),
  }
}
