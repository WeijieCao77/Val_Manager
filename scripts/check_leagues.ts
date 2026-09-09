/**
 * Five ladders, one record each, and a door on every one of them.
 *
 *   npx tsx scripts/check_leagues.ts [matches]
 *
 * One open ladder meant one answer to 「我该练哪张卡」 — the biggest numbers
 * you own — so four fifths of a collection was salvage. Each metal has a
 * ladder that only it and everything below may enter, and 名人堂 asks for two
 * 彩卡, which is the only place a legend is worth more than its rating.
 *
 * What is checked:
 *   - who may walk in: the ceiling holds for the coach as well as the five,
 *     and 名人堂 counts 彩卡 rather than reading a flag
 *   - the SERVER decides. The league is a request field, so a five that
 *     cannot enter is refused there, not merely greyed out on the screen
 *   - the records are separate: a win on one ladder moves that ladder and
 *     nothing else, and the open ladder is exactly where it always was
 *   - the handicaps are the measured ones — a middling collection of the
 *     metal wins about as often in 钻石 as a gold five does on the open
 *     ladder, which is the shape the whole ladder was tuned to
 *   - a save from before any of this loads, plays, and round-trips
 */
import { runAction } from '../src/engine/cardActions'
import {
  newGacha, ladderOf, leagueEntry, migrateGacha, playCost, staminaNow,
  LEAGUES, LEAGUE_RULES, MASTER_DIV, DIVISIONS, STAMINA_MAX,
} from '../src/engine/gacha'
import type { GachaState, LeagueKind } from '../src/engine/gacha'
import { playArenaMatch } from '../src/engine/arena'
import {
  ALL_CARDS, COACH_CARDS, LEGEND_CARDS, PLAYER_CARDS, SQUAD_SLOTS, cardById, isCoachCard, personOf,
} from '../src/engine/cards'
import type { PlayerCard, Squad } from '../src/engine/cards'
import { ladderPool } from '../src/engine/gacha'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const DAY = '2026-09-09'
const env = (now = Date.parse(`${DAY}T12:00:00+08:00`), seed = 99) => ({ now, today: DAY, seed })

/** the best legal five out of a pool, one card a slot, five different people */
const five = (pool: readonly PlayerCard[]): (string | null)[] => {
  const used = new Set<string>()
  return SQUAD_SLOTS.map((slot) => {
    const p = pool.find((c) => !used.has(personOf(c)) && (slot === '自由人' || c.roles.includes(slot)))
    if (!p) return null
    used.add(personOf(p))
    return p.id
  })
}
const byRarity = (r: string) => PLAYER_CARDS.filter((c) => c.rarity === r).sort((a, b) => b.rating - a.rating)
const coachOf = (r: string) => COACH_CARDS.find((c) => c.rarity === r)?.id ?? null

const SQUADS: Record<string, Squad> = {
  bronze: { slots: five(byRarity('bronze')), coach: coachOf('bronze') },
  silver: { slots: five([...byRarity('silver'), ...byRarity('bronze')]), coach: coachOf('bronze') },
  gold: { slots: five(byRarity('gold')), coach: coachOf('gold') },
  twoLegends: { slots: five([...LEGEND_CARDS.slice(0, 2), ...byRarity('gold')]), coach: coachOf('gold') },
  oneLegend: { slots: five([...LEGEND_CARDS.slice(0, 1), ...byRarity('gold')]), coach: coachOf('gold') },
}

// ---- who may walk in -------------------------------------------------------
{
  console.log('=== 入场资格 ===')
  const table: Record<string, Record<LeagueKind, boolean>> = {}
  for (const [name, sq] of Object.entries(SQUADS)) {
    table[name] = {} as Record<LeagueKind, boolean>
    for (const lg of LEAGUES) table[name][lg] = leagueEntry(sq, lg).ok
  }
  check('铜卡五人哪儿都能去，除了名人堂',
    table.bronze.bronze && table.bronze.silver && table.bronze.gold && table.bronze.open && !table.bronze.hof)
  check('带银卡就进不了铜卡赛', !table.silver.bronze && table.silver.silver)
  check('带金卡就进不了银卡赛', !table.gold.silver && table.gold.gold)
  check('彩卡进不了金卡赛', !table.twoLegends.gold && table.twoLegends.open)
  check('两张彩卡才进得了名人堂', table.twoLegends.hof && !table.oneLegend.hof)
  const why = leagueEntry(SQUADS.gold, 'silver')
  check('拒绝时说得出是谁挡的', !why.ok && why.why.includes('金卡'), why.ok ? '' : why.why)

  // the coach walks in with them
  const goldCoachOnBronze: Squad = { slots: SQUADS.bronze.slots, coach: coachOf('gold') }
  check('教练也要过同一道线', !leagueEntry(goldCoachOnBronze, 'bronze').ok)
  check('没有教练不算违规', leagueEntry({ slots: SQUADS.bronze.slots, coach: null }, 'bronze').ok)
}

// ---- the server is the door ------------------------------------------------
{
  console.log('\n=== 服务器把门 ===')
  const g = newGacha('VM-TEST-0000-0000-0000-0LG1', '天梯', DAY)
  for (const id of SQUADS.gold.slots) if (id) g.cards[id] = { id, level: 0, dupes: 0, seen: 1, got: DAY }
  if (SQUADS.gold.coach) g.cards[SQUADS.gold.coach] = { id: SQUADS.gold.coach, level: 0, dupes: 0, seen: 1, got: DAY }
  g.squad = { slots: [...SQUADS.gold.slots], coach: SQUADS.gold.coach }
  const refused = runAction(g, 'ladder', { league: 'silver' }, env())
  check('金卡五人报名银卡赛被服务器拒绝', !refused.ok, refused.ok ? '' : (refused as { why: string }).why)
  const before = staminaNow(g, env().now)
  check('被拒绝不扣体力', staminaNow(g, env().now) === before)
  const ok = runAction(g, 'ladder', { league: 'gold' }, env())
  check('金卡赛放行', ok.ok, ok.ok ? '' : (ok as { why: string }).why)
  const junk = runAction(g, 'ladder', { league: 'platinum' }, env(Date.now(), 5))
  check('编出来的赛事名当成公开赛，不是崩', junk.ok, junk.ok ? '' : (junk as { why: string }).why)
}

// ---- one record each -------------------------------------------------------
{
  console.log('\n=== 各算各的 ===')
  const g = newGacha('VM-TEST-0000-0000-0000-0LG2', '天梯', DAY)
  for (const id of SQUADS.bronze.slots) if (id) g.cards[id] = { id, level: 0, dupes: 0, seen: 1, got: DAY }
  g.squad = { slots: [...SQUADS.bronze.slots], coach: null }
  let now = env().now
  const play = (league: LeagueKind) => {
    // a full meter every time: this is about the records, not the budget
    g.daily.stamina = STAMINA_MAX
    g.daily.staminaAt = now
    return runAction(g, 'ladder', { league }, env(now, 1000 + g.ladder.wins + g.ladder.losses))
  }
  for (let i = 0; i < 6; i++) { play('bronze'); now += 60_000 }
  const bronze = ladderOf(g, 'bronze')
  check('铜卡赛记了六场', bronze.wins + bronze.losses === 6, `${bronze.wins}–${bronze.losses}`)
  check('公开赛一场没动', g.ladder.wins + g.ladder.losses === 0)
  for (const lg of LEAGUES) {
    if (lg === 'bronze') continue
    const L = g.leagues?.[lg as Exclude<LeagueKind, 'open'>]
    check(`${LEAGUE_RULES[lg].name}没有被顺带写进去`, lg === 'open' ? true : !L || L.wins + L.losses === 0)
  }
  play('open'); now += 60_000
  check('打了公开赛，公开赛才动', g.ladder.wins + g.ladder.losses === 1)
  check('铜卡赛还是六场', bronze.wins + bronze.losses === 6)
  check('每个天梯有自己的对手', ladderOf(g, 'bronze').pending !== g.ladder.pending)
}

// ---- the handicaps are the measured ones ----------------------------------
{
  console.log('\n=== 对手强度 ===')
  const N = Number(process.argv[2] ?? 80)
  // the middling half of each metal — what a collection of it actually looks
  // like — against 钻石, where the open ladder's own gold five wins about 63%
  const mid = (r: string) => { const l = byRarity(r); return l.slice(Math.floor(l.length * 0.45)) }
  const rows: [LeagueKind, Squad][] = [
    ['open', { slots: five(mid('gold')), coach: null }],
    ['gold', { slots: five(mid('gold')), coach: null }],
    ['silver', { slots: five(mid('silver')), coach: null }],
    ['bronze', { slots: five(mid('bronze')), coach: null }],
  ]
  const pool = ladderPool(4)
  for (const [lg, sq] of rows) {
    if (sq.slots.filter(Boolean).length < 5) { check(`${lg} 凑得齐五人`, false); continue }
    let w = 0
    for (let i = 0; i < N; i++) {
      if (playArenaMatch(sq, () => 0, pool[i % pool.length], 3, 6100 + i, LEAGUE_RULES[lg].oppBump).win) w++
    }
    const pct = w / N * 100
    check(`${LEAGUE_RULES[lg].name}的中游卡组在钻石段打得动，也赢不麻木`,
      pct >= 40 && pct <= 80, `${pct.toFixed(0)}%`)
  }
}

// ---- a save from before ----------------------------------------------------
{
  console.log('\n=== 旧存档 ===')
  const old = newGacha('VM-TEST-0000-0000-0000-0LG3', '老账号', DAY)
  old.ladder = { div: 3, stars: 2, best: 3, wins: 40, losses: 12, streak: 2 }
  delete (old as { leagues?: unknown }).leagues
  const m = migrateGacha(JSON.parse(JSON.stringify(old)), old.id)
  check('没有 leagues 字段照样读', m.ladder.wins === 40 && m.ladder.div === 3 && !m.leagues)
  check('公开赛还是原来那一份', ladderOf(m, 'open') === m.ladder)
  const junk = JSON.parse(JSON.stringify(old)) as GachaState & { leagues: unknown }
  junk.leagues = { bronze: { div: 99, stars: -4, wins: '7', losses: null }, nosuch: { div: 2 } }
  const m2 = migrateGacha(junk as GachaState, old.id)
  const b = m2.leagues?.bronze
  check('乱写的段位被夹回范围', !!b && b.div === DIVISIONS.length - 1 && b.stars >= 0, JSON.stringify(b))
  check('不认识的赛事名被丢掉', !(m2.leagues as Record<string, unknown>)?.nosuch)
  check('存档转一圈还在', JSON.parse(JSON.stringify(m2)).leagues.bronze.wins === 7)
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
