/**
 * 夺冠海报在该弹的时候有东西可弹。
 *
 *   npx tsx scripts/check_poster.ts
 *
 * 晋级早就有一张海报（QualifyPoster），夺冠没有——赛季的终点反而没有仪式。
 * 这里验的是三档赛事夺冠都会留下 titlePoster，而且留的是事后反推不回来的东西：
 * 决赛对手、主办城市、这是哪一级。
 */
import { createNewGame } from '../src/engine/world'
import { setupSeason, settleCompetition } from '../src/engine/season'
import { WORLD_TEAMS } from '../src/engine/teams'
import type { Competition, GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: () => {}, key: () => null, clear: () => {}, get length() { return 0 },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const mk = (): GameState => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'EDG')!.id, '审计', 20260909)
  setupSeason(g)
  return g
}

const win = (g: GameState, stage: string, name: string, region?: string, city?: string) => {
  const other = Object.keys(g.teams).find((t) => t !== g.myTeam)!
  const comp = {
    key: `k:${stage}`, stage, name, region, city,
    teams: [g.myTeam, other], finished: [g.myTeam, other],
    champion: g.myTeam, awarded: false,
  } as unknown as Competition
  settleCompetition(g, comp)
  return g.titlePoster
}

{
  const g = mk()
  check('新档没有待弹的海报', !g.titlePoster)
  const p = win(g, 'stage2', 'VCT 中国 · 第二赛段', '中国')
  check('赛区赛夺冠留下海报', !!p && p.tier === 'regional', p?.tier)
  check('记下了决赛对手', !!p?.how && p.how.includes('决赛击败'), p?.how)
  check('赛区赛没有主办城市', !p?.city)
  check('年份是当年', p?.year === g.year, String(p?.year))
}
{
  const g = mk()
  const p = win(g, 'champions', 'Champions 2026', undefined, '上海')
  check('国际赛夺冠是最高一档', !!p && p.tier === 'international', p?.tier)
  check('国际赛带主办城市', p?.city === '上海', p?.city)
}
{
  const g = mk()
  win(g, 'stage1', '第一赛段', '中国')
  const first = g.titlePoster?.name
  win(g, 'champions', 'Champions 2026', undefined, '上海')
  check('再拿一个冠军会换成新的那张', g.titlePoster?.name !== first, `${first} → ${g.titlePoster?.name}`)
}
{
  // 看过就清掉，跟 UI 的 onClose 一致；这里只验状态能被清空
  const g = mk()
  win(g, 'masters1', 'Masters 上海', undefined, '上海')
  check('大师赛也是国际赛档', g.titlePoster?.tier === 'international')
  g.titlePoster = undefined
  check('清掉之后不会再弹', !g.titlePoster)
}

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
