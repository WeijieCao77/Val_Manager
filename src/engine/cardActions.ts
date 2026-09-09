/**
 * Everything a card account can do that is worth anything, as one function
 * the SERVER runs.
 *
 * The save used to be written by the client, so the anti-cheat question had
 * exactly one honest answer: none. Editing localStorage was editing the
 * account. What could be checked afterwards was arithmetic — can this many
 * matches have been played — and arithmetic catches the clumsy and nobody
 * else.
 *
 * This is the other design. The collection lives on the server and the
 * server is the only thing that changes it: a client that wants to open a
 * pack sends 「开一个选拔包」 and gets back what came out, along with the
 * account as it now is. The pack is rolled here, from a seed the client never
 * held; the check-in is dated here; the ladder match is simulated here with
 * the five the server knows the player owns. An edited localStorage is an
 * edited DISPLAY — the next reply from the server replaces it.
 *
 * The rules are the same functions the client ran until now. Nothing about
 * what a pack pays or what a match is worth changed; only where it runs.
 *
 * Pure: state in, state mutated, result out. The database, the clock and the
 * opponent pool are the server's business and arrive in `env`, which is what
 * lets scripts/check_authority.ts drive every action without a database.
 */
import {
  awardMinigame, canPlay, checkIn, claimQuest, claimSeries, clampState, cupBo, cupOpponent, drawOpponent, enterCup,
  levelOf, oppBumpFor, openPack, pendingOpponent, primeStamina, recordCup, recordLadder,
  refreshDaily, salvage, salvageBulk, spendPlay, upgrade, isLeague, ladderSlot, leagueEntry,
  LEAGUE_RULES, MASTER_DIV, PACKS, SERIES, STAMINA_COST, SWEEPABLE,
} from './gacha'
import {
  judgeMinigame, MINI_GAMES, MINIGAME_DAILY, MINIGAME_TTL_MS, newMinigame, refreshMinigame,
} from './minigame'
import type { MiniGame } from './minigame'
import type { GachaState, PackKind, QuestKey, Series } from './gacha'
import { playArenaMatch, playRivalMatch } from './arena'
import type { ArenaResult, RivalSquad } from './arena'
import { challengeBlock, guessChallenge } from './challenge'
import { hashStr } from './rng'
import { cardById, isPlayerCard, personOf, squadRating } from './cards'
import type { Rarity, Squad } from './cards'
import { WORLD_TEAMS } from './teams'
import { markMailSeen } from './inbox'

/** What the server knows that the rules need. */
export interface ActEnv {
  /** the server's clock, ms */
  now: number
  /** the server's date, YYYY-MM-DD in Asia/Shanghai */
  today: string
  /** unpredictable, for the match; a script may fix it */
  seed: number
  /** a real player's five for the ladder, when the division calls for one and the pool had one */
  rival?: RivalSquad | null
}

export type ActResult =
  | { ok: true; result?: unknown }
  | { ok: false; why: string }

export const ACTIONS = [
  'open', 'checkin', 'quest', 'series', 'salvage', 'salvage_dupes', 'salvage_bulk', 'upgrade',
  'ladder_draw', 'ladder', 'cup_enter', 'cup_play', 'cup_clear', 'challenge', 'mail_seen',
  'minigame_start', 'minigame_finish',
] as const
export type ActionName = (typeof ACTIONS)[number]

/** Whether this action may need a real player's five fetched before it runs. */
export const wantsRival = (g: GachaState, action: string): boolean =>
  (action === 'ladder' || action === 'ladder_draw') && !pendingOpponent(g) && g.ladder.div >= 4

/**
 * The five as the server will field it.
 *
 * The squad is the one part of the account the client still writes, because
 * which five to run is the player's choice. What it is not allowed to do is
 * name a card the account does not hold, or seat the same man twice — both are
 * checked here, against the collection the server holds, at the moment the
 * five walks out.
 */
export function squadForPlay(g: GachaState): { ok: true; squad: Squad } | { ok: false; why: string } {
  const seen = new Set<string>()
  const slots = g.squad.slots.slice(0, 5).map((id) => {
    if (!id || !g.cards[id]) return null
    const c = cardById(id)
    if (!c || !isPlayerCard(c)) return null
    const who = personOf(c)
    if (seen.has(who)) return null
    seen.add(who)
    return id
  })
  while (slots.length < 5) slots.push(null)
  const coach = g.squad.coach && g.cards[g.squad.coach] && cardById(g.squad.coach)?.kind === 'coach'
    ? g.squad.coach : null
  if (slots.filter(Boolean).length < 5) return { ok: false, why: '先凑齐五个人。' }
  return { ok: true, squad: { slots, coach } }
}

const isPack = (k: unknown): k is PackKind => typeof k === 'string' && k in PACKS
const str = (v: unknown, max = 40): string => (typeof v === 'string' ? v.slice(0, max) : '')

export function runAction(
  g: GachaState, action: string, args: Record<string, unknown>, env: ActEnv,
): ActResult {
  // the day and the meter are the server's to keep, and every action starts
  // from where they actually are
  refreshDaily(g, env.today)
  primeStamina(g, env.now)

  const out = dispatch(g, action, args ?? {}, env)
  clampState(g)
  return out
}

function dispatch(
  g: GachaState, action: string, a: Record<string, unknown>, env: ActEnv,
): ActResult {
  switch (action) {
    case 'open': {
      const kind = a.kind
      if (!isPack(kind)) return { ok: false, why: '没有这种卡包' }
      const payWith = a.payWith === 'coins' ? 'coins' : 'pack'
      // A pack must not be knowable before it is bought. `seed` lives in the
      // account, the account is handed to the client with every reply, and
      // openPack is a pure function of it — so a player holding their own
      // state could work out the next pack card for card and open only when a
      // 彩卡 was due. Folding in a number the server made and has never sent
      // anywhere makes the reply worthless for guessing the one after it.
      // Mixed here rather than inside openPack so the pack itself stays a
      // pure function of the state, which is what the odds scripts measure.
      g.seed = hashStr(`${g.seed}:${env.seed}`) >>> 0
      try {
        const pulled = openPack(g, kind, payWith, env.today)
        return {
          ok: true,
          result: {
            pulled: pulled.map((p) => ({ cardId: p.card.id, dupe: p.dupe, salvage: p.salvage })),
          },
        }
      } catch (e) {
        return { ok: false, why: e instanceof Error ? e.message : '开不了' }
      }
    }
    case 'checkin': {
      const r = checkIn(g, env.today)
      return { ok: true, result: r }
    }
    case 'quest': {
      const key = str(a.key) as QuestKey
      const coins = claimQuest(g, key)
      if (!coins) return { ok: false, why: '这个任务还领不了' }
      return { ok: true, result: { coins } }
    }
    case 'series': {
      const region = str(a.region) as Series
      if (!(SERIES as readonly string[]).includes(region)) return { ok: false, why: '没有这个赛区' }
      const got = claimSeries(g, region)
      if (!got) return { ok: false, why: '这个赛区没有可领的奖励' }
      return { ok: true, result: { got } }
    }
    case 'salvage': {
      const cardId = str(a.cardId)
      const count = Math.max(0, Math.min(999, Math.trunc(Number(a.count) || 0)))
      const coins = salvage(g, cardId, count)
      if (!coins) return { ok: false, why: '没有可分解的重复卡' }
      return { ok: true, result: { coins } }
    }
    case 'salvage_dupes': {
      // the reveal's 「分解重复卡」: one spare of each card named, no more
      const ids = Array.isArray(a.cardIds) ? a.cardIds.map((x) => str(x)).filter(Boolean).slice(0, 20) : []
      let coins = 0
      for (const id of ids) coins += salvage(g, id, 1)
      return { ok: true, result: { coins } }
    }
    case 'salvage_bulk': {
      // 「一键分解」. The request names a pile — these rarities, these cards —
      // and never a count: how many spares are in it is read off the
      // collection here. A彩卡 is only ever in it by name (see SWEEPABLE).
      const rarities = (Array.isArray(a.rarities) ? a.rarities : [])
        .map((x) => str(x, 8))
        .filter((r): r is Rarity => (SWEEPABLE as readonly string[]).includes(r))
      const cardIds = (Array.isArray(a.cardIds) ? a.cardIds : [])
        .map((x) => str(x)).filter(Boolean).slice(0, 300)
      if (!rarities.length && !cardIds.length) return { ok: false, why: '没有选中要分解的卡' }
      const got = salvageBulk(g, { rarities, cardIds, keepForUpgrade: a.keepForUpgrade === true })
      if (!got.dupes) return { ok: false, why: '没有可分解的重复卡' }
      return { ok: true, result: got }
    }
    case 'upgrade': {
      const cardId = str(a.cardId)
      if (!upgrade(g, cardId)) return { ok: false, why: '还升不了' }
      return { ok: true, result: { level: levelOf(g, cardId) } }
    }
    case 'ladder_draw': {
      const league = isLeague(a.league) ? a.league : 'open'
      const L = ladderSlot(g, league)
      if (pendingOpponent(g, league)) return { ok: true, result: { league, pending: L.pending } }
      // only the open ladder puts another player's five across the net; a
      // metal ladder is about your own shelf and plays the clubs
      drawOpponent(g, league === 'open' && L.div >= 4 ? env.rival ?? undefined : undefined, league)
      return { ok: true, result: { league, pending: L.pending } }
    }
    case 'ladder': {
      const league = isLeague(a.league) ? a.league : 'open'
      const five = squadForPlay(g)
      if (!five.ok) return five
      // the terms of entry, checked here — the client picks the ladder, the
      // server decides whether this five may walk into it
      const entry = leagueEntry(five.squad, league)
      if (!entry.ok) return { ok: false, why: entry.why }
      if (!canPlay(g, 'ladder', env.now)) return { ok: false, why: '体力不够' }
      const L = ladderSlot(g, league)
      // the opponent the screen showed is the opponent that gets played; a
      // client that never asked for one gets one drawn now
      if (!pendingOpponent(g, league)) {
        drawOpponent(g, league === 'open' && L.div >= 4 ? env.rival ?? undefined : undefined, league)
      }
      const pinned = pendingOpponent(g, league)!
      const rival = (pinned.rival ?? null) as RivalSquad | null
      const oppId = pinned.club ?? WORLD_TEAMS[0].id
      const opp = WORLD_TEAMS.find((t) => t.id === oppId)
      const master = L.div >= MASTER_DIV
      // the league's own handicap, and above 大师 the sharpening on top
      const bump = LEAGUE_RULES[league].oppBump + (master ? oppBumpFor(L.points ?? 0) : 0)
      if (!spendPlay(g, 'ladder', env.now)) return { ok: false, why: '体力不够' }
      const level = (id: string) => levelOf(g, id)
      const res: ArenaResult = rival
        ? playRivalMatch(five.squad, level, rival, 3, env.seed)
        : playArenaMatch(five.squad, level, oppId, 3, env.seed, bump)
      // a real five is worth what its own ladder position says it is worth
      const strength = rival
        ? 84 + Math.min(10, Math.floor(rival.points / 250))
        : (opp?.rating ?? 80) + bump
      const out = recordLadder(g, res.win, strength, league)
      return {
        ok: true,
        result: { league, res, opp: oppId, who: rival ? `${rival.name} ${rival.tag}` : undefined, out },
      }
    }
    case 'cup_enter': {
      const five = squadForPlay(g)
      if (!five.ok) return five
      if (g.cup && !g.cup.done) return { ok: true, result: { cup: g.cup } }
      if (!canPlay(g, 'cup', env.now)) return { ok: false, why: `体力不够，入场要 ${STAMINA_COST.cup} 点` }
      try {
        enterCup(g, squadRating(five.squad, (id) => levelOf(g, id)), env.now)
        return { ok: true, result: { cup: g.cup } }
      } catch (e) {
        return { ok: false, why: e instanceof Error ? e.message : '报不了名' }
      }
    }
    case 'cup_play': {
      const five = squadForPlay(g)
      if (!five.ok) return five
      const cup = g.cup
      const oppId = cupOpponent(g)
      if (!cup || !oppId) return { ok: false, why: '没有进行中的杯赛' }
      // the ticket was the whole price: nothing is charged per round
      const level = (id: string) => levelOf(g, id)
      const res = playArenaMatch(five.squad, level, oppId, cupBo(cup), env.seed)
      const out = recordCup(g, {
        opponent: oppId, win: res.win, mapsWon: res.mapsWon, mapsLost: res.mapsLost,
      })
      return { ok: true, result: { res, opp: oppId, out } }
    }
    case 'cup_clear': {
      // only a finished bracket can be put away; an unfinished one is a paid
      // entry and stays until it is played out
      if (g.cup && !g.cup.done) return { ok: false, why: '这届杯赛还没打完' }
      g.cup = null
      return { ok: true }
    }
    case 'challenge': {
      const why = challengeBlock(g, env.today)
      if (why) return { ok: false, why }
      const guessId = str(a.guessId, 80)
      if (!guessId) return { ok: false, why: '先选一个' }
      const turn = guessChallenge(g, env.today, guessId)
      return { ok: true, result: { turn } }
    }
    case 'mail_seen': {
      markMailSeen(g)
      return { ok: true }
    }
    // ---- 位置小游戏: the server opens the round and judges it — engine/minigame.ts
    case 'minigame_start': {
      const game = str(a.game, 12) as MiniGame
      if (!MINI_GAMES.includes(game)) return { ok: false, why: '没有这个小游戏' }
      const m = (g.minigame ??= newMinigame())
      refreshMinigame(m, env.today)
      if (m.plays >= MINIGAME_DAILY) return { ok: false, why: `今天的 ${MINIGAME_DAILY} 次都用完了，明天再来` }
      // starting again abandons the round in progress; the play it spent stays spent,
      // or a bad seed could be rerolled for free
      m.plays += 1
      const seed = hashStr(`${g.seed}:${env.seed}:${env.now}:${game}:${m.plays}`) >>> 0
      m.live = { game, seed, startedAt: env.now }
      return { ok: true, result: { game, seed, startedAt: env.now, playsLeft: MINIGAME_DAILY - m.plays } }
    }
    case 'minigame_finish': {
      const m = g.minigame
      const live = m?.live
      if (!m || !live) return { ok: false, why: '没有进行中的小游戏' }
      const elapsed = env.now - live.startedAt
      m.live = null
      if (elapsed > MINIGAME_TTL_MS) return { ok: false, why: '这局放太久了，已经作废' }
      const verdict = judgeMinigame(live.game, live.seed, a.transcript, elapsed)
      if (!verdict.ok) return { ok: false, why: verdict.why }
      const reward = awardMinigame(g, live.game, verdict.tier)
      m.best[live.game] = Math.max(m.best[live.game] ?? 0, verdict.score)
      return { ok: true, result: { game: live.game, tier: verdict.tier, score: verdict.score, summary: verdict.summary, detail: verdict.detail, reward, playsLeft: MINIGAME_DAILY - m.plays } }
    }
    default:
      return { ok: false, why: '没有这个操作' }
  }
}
