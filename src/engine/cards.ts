/**
 * The card layer: the same real people, dealt as a collection instead of a
 * roster.
 *
 * Nothing here invents anybody. A card IS a `Player` (or a `Coach`) out of
 * world.json — the photograph, the flag, the numbers and the trophy cabinet
 * all belong to a real professional, which is the whole premise of the game
 * and the reason the pack opening is worth watching. See engine/gacha.ts for
 * what happens once you own one.
 */
import { WORLD_PLAYERS } from './world'
import { WORLD_TEAMS, WORLD_ANALYSTS } from './teams'
import { DOSSIER, coachDossier, faceUrl, legendPhoto } from './dossier'
import { LEGENDS } from './legends'
import type { Legend } from './legends'
import { clamp } from './rng'
import type { Attrs, Coach, Region, Role } from './types'

export type Rarity = 'mythic' | 'gold' | 'silver' | 'bronze'

export const RARITY_CN: Record<Rarity, string> = {
  mythic: '彩卡', gold: '金卡', silver: '银卡', bronze: '铜卡',
}

/** worst to best, for anywhere that has to compare two metals */
export const RARITY_ORDER: Rarity[] = ['bronze', 'silver', 'gold', 'mythic']
export const rarityRank = (r: Rarity): number => RARITY_ORDER.indexOf(r)

/**
 * Where the three metals sit.
 *
 * Picked off the real distribution rather than off a round number: 84 puts 91
 * of the 518 professionals in gold (17.6%), which is roughly "a starter at a
 * VCT club having a good year". Move it to 86 and half the partnered league
 * turns silver, which reads wrong to anyone who watches the games.
 */
export const GOLD_AT = 84
export const SILVER_AT = 72

/**
 * The metal a rating earns. Never 彩卡 — that tier is not something a number
 * can qualify for, it is awarded to a specific night by engine/legends.ts.
 */
export const rarityOf = (rating: number): Rarity =>
  rating >= GOLD_AT ? 'gold' : rating >= SILVER_AT ? 'silver' : 'bronze'

/** Head coaches rate lower than players across the board, so they get their own cut. */
export const coachRarityOf = (rating: number): Rarity =>
  rating >= 78 ? 'gold' : rating >= 68 ? 'silver' : 'bronze'

export interface PlayerCard {
  kind: 'player'
  id: string
  /** the world.json player id this card is a face of */
  playerId: string
  /**
   * Set on a彩卡: the night this version of him is.
   *
   * A legend keeps the club he played it FOR, not the one he is at now, so the
   * chemistry graph reads 2023 FNATIC rather than wherever he ended up.
   */
  legend?: Legend
  ign: string
  realName: string | null
  /** two-letter country code, lowercased, from vlr.gg */
  nat: string | null
  /** photograph filename under /faces, when vlr.gg has one */
  face: string | null
  region: Region
  /** the club they play for in the 2026 season; null for a free agent */
  clubId: string | null
  clubTag: string | null
  role: Role
  roles: Role[]
  isIgl: boolean
  age: number
  attrs: Attrs
  rating: number
  rarity: Rarity
}

export interface CoachCard {
  kind: 'coach'
  id: string
  name: string
  /** real name and nationality, from the club's staff listing on vlr.gg */
  realName: string | null
  nat: string | null
  face: string | null
  /** the club they coach, or the club an analyst was hired away from */
  clubId: string | null
  clubTag: string | null
  region: Region | null
  tactics: number
  development: number
  motivation: number
  rating: number
  rarity: Rarity
  /** analysts are coaches with a speciality instead of a club */
  spec?: string
}

export type Card = PlayerCard | CoachCard

/**
 * A coach's number.
 *
 * Tactics is what the match engine actually reads off a head coach, so it
 * carries the weight; development and motivation matter over a career the card
 * mode does not have, and are kept in at a discount so a nurturing coach is
 * not simply worse.
 */
export const coachRating = (c: { tactics: number; development: number; motivation: number }): number =>
  Math.round(c.tactics * 0.45 + c.development * 0.3 + c.motivation * 0.25)

const teamById = new Map(WORLD_TEAMS.map((t) => [t.id, t]))

function buildPlayerCards(): PlayerCard[] {
  return WORLD_PLAYERS.map((p) => {
    const d = DOSSIER.players[p.id]
    const club = p.teamId ? teamById.get(p.teamId) : undefined
    return {
      kind: 'player' as const,
      id: `p:${p.id}`,
      playerId: p.id,
      ign: p.ign,
      // the scrape fills in what world.json was missing: 178 players carried no
      // nationality at all, and a card with no flag on it is half a card
      realName: d?.real ?? p.realName ?? null,
      nat: (d?.nat ?? p.nat) || null,
      face: d?.img ? faceUrl(d.img, d.v) : null,
      region: p.region as Region,
      clubId: p.teamId ?? null,
      clubTag: club?.tag ?? null,
      role: p.role as Role,
      roles: (p.roles as Role[] | undefined)?.length ? (p.roles as Role[]) : [p.role as Role],
      isIgl: !!p.isIgl,
      age: p.age,
      attrs: p.attrs,
      rating: p.overall,
      rarity: rarityOf(p.overall),
    }
  })
}

function buildCoachCards(): CoachCard[] {
  const out: CoachCard[] = []
  const seen = new Set<string>()
  for (const t of WORLD_TEAMS) {
    const c = t.coach as Coach | undefined
    if (!c?.name || seen.has(c.name)) continue
    seen.add(c.name)
    const rating = coachRating(c)
    const d = coachDossier(c.name)
    out.push({
      kind: 'coach', id: `c:${c.name}`, name: c.name,
      realName: d?.real ?? null,
      nat: d?.nat ?? null,
      face: d?.img ? faceUrl(d.img, d.v) : null,
      clubId: t.id, clubTag: t.tag, region: t.region as Region,
      tactics: c.tactics, development: c.development, motivation: c.motivation,
      rating, rarity: coachRarityOf(rating),
    })
  }
  // the five real analysts are cards too — they coach a different way, and
  // there are few enough of them to be worth chasing
  for (const a of WORLD_ANALYSTS as { name: string; from: string; tactics: number; development: number; motivation: number; spec: string }[]) {
    if (seen.has(a.name)) continue
    seen.add(a.name)
    const club = WORLD_TEAMS.find((t) => t.name === a.from || t.tag === a.from)
    const rating = coachRating(a)
    const d = coachDossier(a.name)
    out.push({
      kind: 'coach', id: `c:${a.name}`, name: a.name,
      realName: d?.real ?? null,
      nat: d?.nat ?? null,
      face: d?.img ? faceUrl(d.img, d.v) : null,
      clubId: club?.id ?? null, clubTag: club?.tag ?? a.from,
      region: (club?.region as Region) ?? null,
      tactics: a.tactics, development: a.development, motivation: a.motivation,
      rating, rarity: coachRarityOf(rating), spec: a.spec,
    })
  }
  return out
}

/**
 * Where a legend's numbers come from.
 *
 * The rating is authored — it is a claim about a night, and Boaster's 62 in
 * 2026 says nothing about the two majors he called in 2023. The attributes are
 * not authored: they are his own, moved by the same amount the rating moved,
 * so the shape of the player survives. A duelist stays a duelist.
 */
/** How far above his ordinary card a彩卡 of the same man always sits. */
export const LEGEND_EDGE = 2

function legendAttrs(base: Attrs, delta: number): Attrs {
  const out = { ...base }
  for (const k of Object.keys(out) as (keyof Attrs)[]) {
    out[k] = clamp(Math.round(out[k] + delta), 1, 99)
  }
  return out
}

function buildLegendCards(players: PlayerCard[]): PlayerCard[] {
  const byIgn = new Map(players.map((c) => [c.ign.toLowerCase(), c]))
  const out: PlayerCard[] = []
  for (const l of LEGENDS) {
    const base = byIgn.get(l.ign.toLowerCase())
    // A legend with no live player behind it would be a fabricated person,
    // which this project does not have. Skipped loudly rather than invented.
    if (!base) {
      console.warn(`legend ${l.id}: no player called ${l.ign} in world.json`)
      continue
    }
    // the picture from that night, where Liquipedia has one; otherwise the
    // ordinary studio portrait rather than nothing
    const photo = legendPhoto(l.id)
    // A night is never worth less than the everyday card of the same man.
    // The authored number was written against the ordinary rating of its
    // day; ratings move (CHICHOO reached 94 on 2026-09-03 while his 2024
    // Seoul card still said 93), so the彩卡 floors at the ordinary card
    // plus two, and the authored number only ever lifts it further.
    const rating = Math.min(99, Math.max(l.rating, base.rating + LEGEND_EDGE))
    out.push({
      ...base,
      id: l.id,
      legend: l,
      clubId: l.clubId,
      clubTag: l.clubTag,
      face: photo ? faceUrl(photo.img, photo.v) : base.face,
      attrs: legendAttrs(base.attrs, rating - base.rating),
      rating,
      rarity: 'mythic',
    })
  }
  return out
}

/**
 * One card per real player, before the彩卡 versions are added.
 *
 * Anything listing PEOPLE wants this; anything listing CARDS wants
 * PLAYER_CARDS. The dossier used the latter and so printed everyone with a
 * legend twice — two Derkes, two Boasters — and counted 538 players out of 518.
 */
export const BASE_PLAYER_CARDS: PlayerCard[] = buildPlayerCards()
export const LEGEND_CARDS: PlayerCard[] = buildLegendCards(BASE_PLAYER_CARDS)
export const PLAYER_CARDS: PlayerCard[] = [...BASE_PLAYER_CARDS, ...LEGEND_CARDS]
export const COACH_CARDS: CoachCard[] = buildCoachCards()
export const ALL_CARDS: Card[] = [...PLAYER_CARDS, ...COACH_CARDS]

const byId = new Map(ALL_CARDS.map((c) => [c.id, c]))
export const cardById = (id: string): Card | undefined => byId.get(id)

export const isPlayerCard = (c: Card | undefined): c is PlayerCard => c?.kind === 'player'
export const isCoachCard = (c: Card | undefined): c is CoachCard => c?.kind === 'coach'

/** Display name, whichever kind of card it is. */
export const cardName = (c: Card): string => (c.kind === 'player' ? c.ign : c.name)

/**
 * Who a card actually IS, as opposed to which card it is.
 *
 * A legend and the ordinary card share a person: "2023 双冠 FNATIC Derke" and
 * "Derke, Team Vitality" are the same man, and a five containing both is a
 * five of four people. Anything picking a squad compares this, not the id.
 */
export const personOf = (c: Card): string =>
  c.kind === 'player' ? c.playerId : `c:${c.name}`

// ---------------------------------------------------------------- levels

/**
 * What a duplicate is worth.
 *
 * Five levels, +1 rating each, so a bronze you keep pulling can climb into
 * silver and a gold can reach 89 — enough for the card to be worth keeping,
 * short of turning the collection into a treadmill. The cost curve is steep at
 * the top so the last level is a decision, not a formality.
 *
 * Deliberately one currency and one pile of duplicates, not a third resource:
 * a spare copy either goes into the card it belongs to or gets sold for coins,
 * and those are the only two things it can ever do.
 */
export const MAX_LEVEL = 5
export const DUPES_FOR = [1, 1, 2, 3, 5]
export const COINS_FOR = [400, 900, 2000, 4200, 9000]

/** What a spare copy sells for. */
export const SALVAGE: Record<Rarity, number> = {
  // a spare彩卡 is worth more than a pack of anything else, and still nobody
  // sane sells one
  mythic: 4000, gold: 700, silver: 200, bronze: 60,
}

export const ratingAt = (base: number, level: number): number =>
  Math.min(99, base + Math.max(0, Math.min(MAX_LEVEL, level)))

// ---------------------------------------------------------------- squad

export const SQUAD_SLOTS: Role[] = ['决斗者', '先锋', '控场', '哨卫', '自由人']

export interface Squad {
  /** five player card ids, positionally matched to SQUAD_SLOTS */
  slots: (string | null)[]
  coach: string | null
}

export const emptySquad = (): Squad => ({ slots: [null, null, null, null, null], coach: null })

export interface ChemLink {
  a: number
  b: number
  /** why these two get on: same club beats same country beats same region */
  why: 'club' | 'nat' | 'region'
  value: number
}

export interface ChemReport {
  /** 0-100, what the squad screen shows and what the match engine is handed */
  score: number
  links: ChemLink[]
  /** slots whose card does not cover the role it is standing in */
  misfits: number[]
  /** true when nobody in the five is a real in-game leader */
  noIgl: boolean
  coachBonus: number
  notes: string[]
}

const LINK_VALUE = { club: 3, nat: 2, region: 1 } as const

/**
 * How well a five would actually get along.
 *
 * The links are the real ones the sport has: people who play for the same
 * club, people from the same country, people from the same region. It is the
 * one system in the card mode that rewards knowing VALORANT rather than
 * knowing which numbers are biggest — a 78-rated Gen.G five with a Korean
 * coach beats a scattered pile of 85s, and that is the whole point.
 */
export function chemistry(squad: Squad): ChemReport {
  const cards = squad.slots.map((id) => (id ? cardById(id) : undefined))
  const links: ChemLink[] = []
  const notes: string[] = []
  let raw = 0

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]
      const b = cards[j]
      if (!isPlayerCard(a) || !isPlayerCard(b)) continue
      let why: ChemLink['why'] | null = null
      if (a.clubId && a.clubId === b.clubId) why = 'club'
      else if (a.nat && a.nat === b.nat) why = 'nat'
      else if (a.region === b.region) why = 'region'
      if (!why) continue
      const value = LINK_VALUE[why]
      links.push({ a: i, b: j, why, value })
      raw += value
    }
  }

  const coach = squad.coach ? cardById(squad.coach) : undefined
  let coachBonus = 0
  if (isCoachCard(coach)) {
    const players = cards.filter(isPlayerCard)
    const sameClub = players.filter((p) => p.clubId && p.clubId === coach.clubId).length
    const sameRegion = players.filter((p) => p.region === coach.region).length
    coachBonus = sameClub * 2 + sameRegion
    if (sameClub >= 2) notes.push(`${coach.name} 带过这套阵容里的 ${sameClub} 个人`)
  }

  const misfits: number[] = []
  cards.forEach((c, i) => {
    if (!isPlayerCard(c)) return
    if (!c.roles.includes(SQUAD_SLOTS[i]) && SQUAD_SLOTS[i] !== '自由人') misfits.push(i)
  })

  const noIgl = !cards.some((c) => isPlayerCard(c) && c.isIgl)

  // 30 is a perfect ten links of the same club, which no real collection will
  // reach; 11 is the coach ceiling. Normalising against the practical maximum
  // instead would make an ordinary squad look finished.
  let score = Math.round(((raw + coachBonus) / 41) * 100)
  score = Math.max(0, Math.min(100, score))
  if (misfits.length) notes.push(`${misfits.length} 人被放在不熟悉的位置上`)
  if (noIgl) notes.push('没有人喊指挥')

  return { score, links, misfits, noIgl, coachBonus, notes }
}

/** The squad's headline number, after levels, role misfits and chemistry. */
export function squadRating(squad: Squad, level: (id: string) => number = () => 0): number {
  const cards = squad.slots.map((id) => (id ? cardById(id) : undefined)).filter(isPlayerCard)
  if (!cards.length) return 0
  const chem = chemistry(squad)
  const vals = cards.map((c, i) => {
    const r = ratingAt(c.rating, level(c.id))
    const idx = squad.slots.indexOf(c.id)
    return chem.misfits.includes(idx === -1 ? i : idx) ? r - 6 : r
  })
  const mean = vals.reduce((s, v) => s + v, 0) / cards.length
  // five people who have never met are worth less than the sum of their parts
  const short = (5 - cards.length) * 9
  return Math.max(0, Math.round(mean + (chem.score - 50) * 0.06 - short))
}
