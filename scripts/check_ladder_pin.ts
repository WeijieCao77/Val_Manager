/**
 * The ladder opponent must not be re-rollable.
 *
 *   npx tsx scripts/check_ladder_pin.ts
 *
 * Reported: 「目前我在天梯页，对手显示 A，我切去好友，再点回天梯，对手就会变成
 * B。这样用户可以一直刷。」 — and the reason it worked is that the server hands
 * back a random dozen rivals, so every remount dealt a different one. Seeing a
 * strong opponent cost nothing: flick away, come back, get somebody else.
 *
 * The draw belongs to the MATCH, not to the visit. It is stamped with the match
 * number and kept in the save, so the only way to a new opponent is to play the
 * one you have.
 *
 * Both halves need it. The world club looked safe because ladderOpponent() is
 * deterministic — but it is seeded from the account's rng, and that seed moves
 * every time a pack is opened, so opening a pack re-dealt the club.
 */
import {
  drawOpponent, ladderOpponent, matchNo, newGacha, openPack, pendingOpponent, recordLadder,
} from '../src/engine/gacha'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const fakeRival = (n: number) => ({
  name: `对手${n}`, tag: `#${n}`, slots: [`a${n}`, `b${n}`, `c${n}`, `d${n}`, `e${n}`],
  coach: null, levels: {}, div: 5, points: n * 100,
})

const g = newGacha('VM-PIN', '审计', '2026-09-01')
g.coins = 1e9
g.ladder = { div: 5, stars: 0, best: 5, wins: 10, losses: 4, streak: 0, points: 300 }

// ---- the visit does not re-deal -----------------------------------------
check(pendingOpponent(g) === null, '还没抽过的时候，没有待打的对手')
const first = drawOpponent(g, fakeRival(1))
check(pendingOpponent(g)?.rival?.name === '对手1', '抽完之后钉住了')
check(first.at === matchNo(g), '钉的是这一场，不是这一次访问')

// leaving the tab and coming back is exactly this: read it again
for (let i = 0; i < 20; i++) {
  const seen = pendingOpponent(g)
  check(seen?.rival?.name === '对手1' && seen.club === first.club,
    `第 ${i + 1} 次回到天梯页，对手没变`, seen?.rival?.name ?? 'null')
  if (bad) break
}

// ---- opening a pack must not re-deal the club ---------------------------
{
  const clubBefore = pendingOpponent(g)!.club
  const seedBefore = g.seed
  g.packs.ten = 1
  openPack(g, 'ten', 'pack')
  check(g.seed !== seedBefore, '开包之后账号种子确实变了')
  check(ladderOpponent(g) !== undefined, 'ladderOpponent 仍能算出一个俱乐部')
  check(pendingOpponent(g)!.club === clubBefore,
    '开了包，钉住的俱乐部对手也不会换', `${clubBefore} -> ${pendingOpponent(g)!.club}`)
}

// ---- playing the match is the only way to a new one ---------------------
{
  const before = pendingOpponent(g)!.rival!.name
  recordLadder(g, true, 84)
  check(pendingOpponent(g) === null, '打完这一场，钉子就松开了')
  const next = drawOpponent(g, fakeRival(2))
  check(next.rival?.name === '对手2' && next.rival?.name !== before, '下一场才会换人')
  check(next.at === matchNo(g), '新的钉子对应新的场次')
}

// ---- a failed fetch must not pin "nobody" -------------------------------
{
  // the screen only calls drawOpponent once the server has actually answered;
  // this is the state it must be in until then
  const h = newGacha('VM-NET', '审计', '2026-09-01')
  h.ladder = { div: 5, stars: 0, best: 5, wins: 0, losses: 0, streak: 0, points: 0 }
  check(pendingOpponent(h) === null, '没答复之前不钉任何东西')
  // and a deliberate "there was nobody available" IS a decision worth keeping
  drawOpponent(h, undefined)
  const p = pendingOpponent(h)
  check(p !== null && p.rival === undefined && !!p.club,
    '服务器答复「没有真人对手」也算抽过了，这一场打俱乐部', JSON.stringify(p))
}

console.log(bad ? `\n${bad} 项不通过` : '\n全部通过')
process.exit(bad ? 1 : 0)
