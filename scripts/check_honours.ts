/**
 * A title stays with the man and the club that won it.
 *
 *   npx tsx scripts/check_honours.ts
 *
 * 2026-09-13: titles were `{year, name}` on the player, capped at forty,
 * and shown nowhere but the farewell card; the club was whoever he played
 * for when you looked. Now a title records the competition, the club and
 * its name that day, the day, and starter-or-squad; it is written once per
 * settlement; it follows him through a transfer; and every roster join and
 * leave opens or closes his in-save CV line (engine/history.ts).
 */
const mem: Record<string, string> = {}
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v },
  removeItem: (k: string) => { delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
}
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, finishDraw, settleCompetition, setupSeason, continuePastFive } from '../src/engine/season'
import { exportSave, importSave } from '../src/engine/save'
import { releasePlayer, doTransfer } from '../src/engine/transfer'
import { defaultContract } from '../src/engine/types'
import { TITLE_CAP, titleClub } from '../src/engine/history'
import type { Competition, GameState } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (seed = 20260913): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '审计', seed)
  setupSeason(g)
  return g
}
const comp = (g: GameState, stage: Competition['stage'], name: string, champ: string): Competition => {
  const teams = [champ, ...Object.keys(g.teams).filter((t) => t !== champ).slice(0, 7)]
  return { key: `${stage}-${g.year}`, name, stage, tier: 1, teams, finished: teams, champion: champ } as unknown as Competition
}

// ---- one settlement writes one full line for every man on the roster
{
  const g = mk()
  g.day = 120
  const me = g.teams[g.myTeam]
  const bench = me.roster.find((id) => !me.starters.includes(id))
  const c = comp(g, 'masters1', 'Masters Toronto', g.myTeam)
  settleCompetition(g, c, [])
  const p = g.players[me.starters[0]]
  const t = p.titles![p.titles!.length - 1]
  check('首发拿到的冠军记录带赛事、俱乐部、日期、身份', t.key === c.key && t.stage === 'masters1' && t.team === g.myTeam && t.teamName === me.name && t.day === 120 && t.part === 'starter' && t.intl === true, JSON.stringify(t))
  check('整个 roster 都有，替补记为替补席', me.roster.every((id) => g.players[id].titles?.some((x) => x.key === c.key)) && (!bench || g.players[bench].titles!.at(-1)!.part === 'squad'))
  const n = p.titles!.length
  settleCompetition(g, c, [])
  check('同一赛事再结算一次不重复（awarded）', p.titles!.length === n)
  c.awarded = false
  settleCompetition(g, c, [])
  check('就算 awarded 被清掉，同 key 同年也只记一次', p.titles!.length === n)
  check('地区赛不算国际赛', (() => { settleCompetition(g, comp(g, 'stage1', '赛区第一赛段', g.myTeam), []); return p.titles!.at(-1)!.intl === false })())
}

// ---- the title follows him to the next club, and names the old one
{
  const g = mk()
  g.day = 120
  const me = g.teams[g.myTeam]
  settleCompetition(g, comp(g, 'masters1', 'Masters Toronto', g.myTeam), [])
  const p = g.players[me.starters[0]]
  const other = Object.values(g.teams).find((t) => t.id !== g.myTeam && t.tier === 1)!
  const before = p.clubHist!.length
  doTransfer(g, p, other.id, 0, defaultContract(p.salary, 2))
  check('转会后冠军仍写原俱乐部', titleClub(g, p.titles![0]) === me.name && p.titles![0].team === g.myTeam)
  check('转会开了新的效力一行，旧的一行收口', p.clubHist!.length === before + 1 && p.clubHist![before - 1].team === g.myTeam && p.clubHist![before].team === other.id)
  // a later arrival does not get the old title
  const late = Object.values(g.players).find((x) => !x.teamId)!
  doTransfer(g, late, g.myTeam, 0, defaultContract(late.salary, 2))
  check('之后转进来的人没有那座冠军', !(late.titles ?? []).some((x) => x.key === `masters1-${g.year}`))
  check('转进来的人开了效力一行', late.clubHist?.at(-1)?.team === g.myTeam && late.clubHist?.at(-1)?.from === g.year)
  // released mid-year (the squad is back above the floor): the line closes at this year
  const q = g.players[me.starters[1]]
  const why = releasePlayer(g, q)
  const last = q.clubHist![q.clubHist!.length - 1]
  check('解约后效力一行收在今年', last.team === g.myTeam && last.to === g.year && q.teamId === null, why)
}

// ---- a whole season: real settlements, the rollover keeps everything, the save keeps it
{
  const g = mk(20260901)
  let guard = 0
  while (g.year === 2026 && guard++ < 420) {
    advanceDay(g, { autoResolveDrawDecisions: true })
    if (g.midReview) continuePastFive(g)
    if (g.pendingDrawId) finishDraw(g, g.pendingDrawId)
  }
  const winners = Object.values(g.players).filter((p) => p.titles?.length)
  check('一整季后有人拿到冠军记录', winners.length > 0, `${winners.length} 人`)
  const complete = winners.every((p) => p.titles!.every((t) => t.key && t.team && t.teamName && t.day != null && t.part))
  check('每一条都完整', complete)
  const dup = winners.some((p) => new Set(p.titles!.map((t) => `${t.key}:${t.year}`)).size !== p.titles!.length)
  check('没有重复的冠军行', !dup)
  const back = importSave(exportSave(g))
  const w = winners[0]
  check('存档来回后记录还在', JSON.stringify(back.players[w.id]?.titles) === JSON.stringify(w.titles))
  check('跨赛年后效力经历延到 2026', Object.values(back.players).filter((p) => p.teamId).every((p) => p.clubHist?.some((s) => s.to >= 2026)))
  check(`上限是 ${TITLE_CAP} 而不是 40`, TITLE_CAP >= 100)
  // an old save: bare {year, title} lines
  const raw = JSON.parse(exportSave(g))
  const st = raw.state ?? raw
  st.players[w.id].titles = [{ year: 2025, title: '旧存档冠军' }]
  const old = importSave(JSON.stringify(raw))
  const t = old.players[w.id].titles![0]
  check('老存档的旧记录照常显示，俱乐部写未知而不是猜', titleClub(old, t) === '俱乐部未知' && t.title === '旧存档冠军')
}

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
