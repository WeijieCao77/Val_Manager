/**
 * 排位赛季: four weeks, a two-division drop at the turn, and every promotion and 大师 title pack paid
 * again each season (owner, 2026-09-27: 「排位奖励都是一次性的，玩家打多了就不会想再打排位了」).
 *
 *   npx tsx scripts/check_seasons.ts
 */
import {
  MASTER_DIV, MASTER_TITLES, SEASON_DAYS, SEASON_START, newGacha, recordLadder, rollSeason, seasonDaysLeft,
  seasonFirstDay, seasonLastDay, seasonOf, migrateGacha,
} from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// the calendar
check('开服到 9/27 是赛季前', seasonOf('2026-09-27') === 0 && seasonOf('2026-08-30') === 0)
check('S1 从 9/28 开始，28 天', SEASON_START === '2026-09-28' && SEASON_DAYS === 28 && seasonOf('2026-09-28') === 1 && seasonOf('2026-10-25') === 1 && seasonOf('2026-10-26') === 2)
check('起止日期', seasonFirstDay(2) === '2026-10-26' && seasonLastDay(1) === '2026-10-25' && seasonLastDay(0) === '2026-09-27')
check('剩余天数含当天', seasonDaysLeft('2026-09-28') === 28 && seasonDaysLeft('2026-10-25') === 1)

// the turn
const g = newGacha('VM-TEST-SEASON', '赛季', '2026-09-20')
g.ladder = { ...g.ladder, div: MASTER_DIV, stars: 0, best: MASTER_DIV, points: 1200, bestPoints: 1300, wins: 140, losses: 90, streak: 4 }
g.leagues = {
  gold: { div: 4, stars: 5, best: 4, wins: 30, losses: 20, streak: 0, points: 0, bestPoints: 0 },
  silver: { div: 1, stars: 1, best: 2, wins: 5, losses: 9, streak: -1, points: 0, bestPoints: 0 },
  bronze: { div: 0, stars: 0, best: 0, wins: 0, losses: 0, streak: 0, points: 0, bestPoints: 0 },
}
check('同一赛季里不动', rollSeason(g, '2026-09-27') === null && g.ladder.div === MASTER_DIV)
const ended = rollSeason(g, '2026-09-28')
check('进入 S1：大师回铂金，星和分清零', g.season === 1 && g.ladder.div === 3 && g.ladder.stars === 0 && g.ladder.points === 0 && g.ladder.best === 3 && g.ladder.bestPoints === 0)
check('钻石回黄金、白银回青铜；没打过的天梯不动也不记', g.leagues.gold!.div === 2 && g.leagues.silver!.div === 0 && !ended!.ranks.bronze)
check('生涯胜负不清零（待打对手和检查都读它），本赛季胜负清零', g.ladder.wins === 140 && g.ladder.losses === 90 && g.ladder.sWins === 0 && g.ladder.sLosses === 0)
check('记下上赛季和历史最高', ended!.season === 0 && ended!.ranks.open!.points === 1200 && g.ladder.peak === MASTER_DIV && g.ladder.peakPoints === 1300 && g.lastSeason === ended)
check('同一天再滚一次什么都不变', rollSeason(g, '2026-10-02') === null && g.ladder.div === 3)
const again = migrateGacha(JSON.parse(JSON.stringify(g)), 'VM-TEST-SEASON')
check('读档后新字段都还在', again.season === 1 && again.ladder.peak === MASTER_DIV && again.leagues!.gold!.peak === 4 && again.leagues!.gold!.sWins === 0)

// the point of it: the packs pay again
let packs = 0
const before = { ...g.packs }
let guard = 0
while (g.ladder.div < MASTER_DIV && guard++ < 200) { const out = recordLadder(g, true, 86); if (out.pack) packs++ }
check('铂金打回大师：钻石、大师两个升段包再发一次', packs === 2 && (g.packs.ten ?? 0) - (before.ten ?? 0) >= 2, `${packs} 个`)
let titles = 0
const immortal = MASTER_TITLES.find((t) => t.name === '不朽')!.at
while ((g.ladder.points ?? 0) < immortal && guard++ < 400) { const out = recordLadder(g, true, 95); if (out.pack === 'ten') titles++ }
check('大师称号的十连包也再发', titles >= 1, `${titles} 个`)
check('本赛季战绩在涨', (g.ladder.sWins ?? 0) > 0 && g.ladder.wins > 140)

// two seasons away: one drop a season missed
const idle = newGacha('VM-TEST-IDLE', '潜水', '2026-09-20')
idle.ladder = { ...idle.ladder, div: MASTER_DIV, best: MASTER_DIV, wins: 50, losses: 50, points: 400, bestPoints: 400 }
rollSeason(idle, '2026-10-30')
check('错过一个赛季：降两次（大师 → 铂金 → 白银）', idle.season === 2 && idle.ladder.div === 1)

// the server path: the first action in a new season rolls it
const acted = newGacha('VM-TEST-ACT', '动作', '2026-09-20')
acted.ladder = { ...acted.ladder, div: 4, best: 4, wins: 10, losses: 3 }
runAction(acted, 'mail_seen', {}, { now: Date.parse('2026-09-28T02:00:00Z'), today: '2026-09-28', seed: 1 })
check('新赛季第一次操作就进入新赛季', acted.season === 1 && acted.ladder.div === 2)

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
