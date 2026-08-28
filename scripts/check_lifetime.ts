/**
 * The lifetime record, written from a modal that mounts more than once.
 *
 * GameOver is rendered as `{game.gameOver && <GameOver/>}` inside the career
 * tree, and the front page unmounts that tree. Walk out to the front page and
 * back in and the modal mounts again — which used to add the whole career to
 * the totals a second time. One eleven-season, sixteen-trophy career read as
 * 「32 座冠军、22 个赛季、完成 2 次」 after a single round trip.
 *
 * This replays exactly what src/ui/GameOver.tsx writes, three times over, and
 * insists the answer does not move.
 *
 *   npx tsx scripts/check_lifetime.ts
 */
import { claimCareer, readProfile, record } from '../src/engine/profile'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}
// no server in a check script: push() would retry a relative URL forever
;(globalThis as never as { fetch: unknown }).fetch = undefined

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const ID = 'VM-TEST-TEST-TEST-TEST-TEST'

/** What GameOver.tsx does, for one career. */
function showGameOver(seed: number, o: {
  finished: boolean; honours: number; worlds: number; lastYear: number; club: string
}) {
  const r = readProfile(ID).record
  const first = claimCareer(seed, ID)
  record({
    endings: ['quiet'],
    achievements: ['firstTitle'],
    record: first ? {
      careers: r.careers + 1,
      finished: r.finished + (o.finished ? 1 : 0),
      sacked: r.sacked + (o.finished ? 0 : 1),
      titles: r.titles + o.honours,
      worldTitles: r.worldTitles + o.worlds,
      bestHaul: Math.max(r.bestHaul, o.honours),
      seasons: r.seasons + (o.lastYear - 2026 + 1),
      clubs: [...r.clubs, o.club],
    } : undefined,
  }, ID)
}

const A = { finished: true, honours: 16, worlds: 10, lastYear: 2036, club: 'T74' }
showGameOver(1001, A)
const once = readProfile(ID).record
check('一段生涯记一次：冠军 16', once.titles === 16, `${once.titles}`)
check('赛季 11', once.seasons === 11, `${once.seasons}`)
check('完成 1', once.finished === 1, `${once.finished}`)
check('执教生涯 1', once.careers === 1, `${once.careers}`)

showGameOver(1001, A)
showGameOver(1001, A)
const thrice = readProfile(ID).record
check('回首页再看两次，数字纹丝不动',
  thrice.titles === 16 && thrice.seasons === 11 && thrice.finished === 1 && thrice.careers === 1,
  `冠军 ${thrice.titles} · 赛季 ${thrice.seasons} · 完成 ${thrice.finished} · 生涯 ${thrice.careers}`)

// a genuinely different career does count
showGameOver(2002, { finished: false, honours: 3, worlds: 0, lastYear: 2029, club: 'T7' })
const two = readProfile(ID).record
check('换一段生涯才会累加',
  two.careers === 2 && two.titles === 19 && two.seasons === 15 && two.sacked === 1,
  `生涯 ${two.careers} · 冠军 ${two.titles} · 赛季 ${two.seasons} · 下课 ${two.sacked}`)
check('最好成绩取最高而不是最后一次', two.bestHaul === 16, `${two.bestHaul}`)

// five careers must be able to unlock 「老江湖」
for (let i = 3; i <= 5; i++) {
  showGameOver(3000 + i, { finished: true, honours: 1, worlds: 0, lastYear: 2036, club: 'T' + i })
}
const fiveP = readProfile(ID)
check('五段生涯之后「老江湖」的条件成立', fiveP.record.careers >= 5, `careers ${fiveP.record.careers}`)
// the whole chain, not just the number: record() recomputes 生涯成就 after the
// merge, so a counter that never moved meant an achievement nobody could earn
check('并且「老江湖」真的解锁了', fiveP.achievements.includes('careers5'),
  fiveP.achievements.join('、'))
check('「三个十年」也随之成立', fiveP.record.finished >= 3 && fiveP.achievements.includes('finished3'),
  `finished ${fiveP.record.finished}`)

console.log(bad ? `\n${bad} FAILED` : '\nall held')
process.exit(bad ? 1 : 0)
