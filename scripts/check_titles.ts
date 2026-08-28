/**
 * The names the season awards, and the names the verdicts look for.
 *
 * These were two different lists. season.ts handed out 'VALORANT Champions';
 * endings.ts and achievements.ts both asked for 'Champions' and compared with
 * ===. Nothing threw, nothing failed a test, and every Champions-shaped ending
 * was simply unreachable — a three-time world champion finished his ten years
 * and was told 「有过高光」, and a genuine 全冠之年 was told he had never won on
 * the last day.
 *
 * check_endings.ts could not see it, because it builds its careers by awarding
 * INTL_TITLES to itself: the test and the code shared the wrong constant and
 * agreed. So this one refuses to name a title at all. It runs a season, reads
 * back what the world actually created, and asks the verdicts about THAT.
 * Rename either side and it fails.
 *
 *   npx tsx scripts/check_titles.ts
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { setupSeason, advanceDay } from '../src/engine/season'
import { INTL_TITLES, CHAMPIONS, factsOf, endingOf } from '../src/engine/endings'
import { earnedNow } from '../src/engine/achievements'
import type { GameState } from '../src/engine/types'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ---- what the world actually creates ----------------------------------

const g: GameState = createNewGame(WORLD_TEAMS[0].id, '测试', 20260828)
setupSeason(g)
// far enough into the year that all three international events exist
for (let i = 0; i < 300 && !g.comps.champions; i++) advanceDay(g, { auto: true })

const made = (['masters1', 'masters2', 'champions'] as const)
  .map((k) => g.comps[k]?.name)
  .filter((n): n is string => !!n)
check('赛季里三项国际赛都办起来了', made.length === 3, made.join('、'))

for (const name of made) {
  check(`「${name}」被判定为国际赛事`, (INTL_TITLES as readonly string[]).includes(name))
}
check('冠军赛的名字就是 CHAMPIONS 常量', g.comps.champions?.name === CHAMPIONS,
  `${g.comps.champions?.name} vs ${CHAMPIONS}`)

// ---- and a career that won them is told so ----------------------------

const won = (titles: string[]): GameState => {
  const s = createNewGame(WORLD_TEAMS[0].id, '测试', 1)
  s.year = 2036; s.finished = true; s.gameOver = true
  s.honours = titles.map((title) => ({ year: 2030, title })) as GameState['honours']
  return s
}

const champ = won([CHAMPIONS])
check('拿过冠军赛的人，国际冠军数不是 0', factsOf(champ).intlTitles === 1,
  `intlTitles ${factsOf(champ).intlTitles}`)
check('也不会被说成「一座国际冠军也没有」',
  !['silverware', 'nothing', 'regionKing'].includes(endingOf(champ).dynasty?.key ?? ''),
  `结局「${endingOf(champ).dynasty?.title}」`)
check('「冠军赛冠军」成就能拿到', earnedNow(champ).includes('firstChampions'))

const perfect = won([...INTL_TITLES])
check('同一年拿满三项 → 全冠之年', factsOf(perfect).perfectYears.length === 1,
  `全冠年 ${factsOf(perfect).perfectYears.length}`)
check('并且结局就是「全冠之年」', endingOf(perfect).dynasty?.key === 'perfectYear',
  `结局「${endingOf(perfect).dynasty?.title}」`)
check('「全冠之年」成就能拿到', earnedNow(perfect).includes('perfectSeason'))

// 只拿大师赛的人才是「大师」
const masters = won([INTL_TITLES[0], INTL_TITLES[1]])
check('只拿大师赛的仍然是「大师」', endingOf(masters).dynasty?.key === 'masterOnly',
  `结局「${endingOf(masters).dynasty?.title}」`)

console.log(bad ? `\n${bad} FAILED` : '\nall held')
process.exit(bad ? 1 : 0)
