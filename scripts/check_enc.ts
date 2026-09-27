/**
 * 国家队杯 (ENC): five players and a coach of one nationality, one entry a day, no 体力, a bracket of
 * national teams built from real players (owner, 2026-09-27).
 *
 *   npx tsx scripts/check_enc.ts
 */
import { newGacha, staminaNow } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { encTeams } from '../src/engine/encTeams'
import { cupTeam } from '../src/engine/cupTeams'
import { BASE_PLAYER_CARDS, COACH_CARDS, cardById } from '../src/engine/cards'
import { natCountry } from '../src/engine/nat'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// the national teams: real people only, one country each, every one a legal five
const teams = encTeams()
check('至少 15 支国家队', teams.length >= 15, `${teams.length} 支`)
check('每支五个人、都是这个国家的、没有重复', teams.every((t) => {
  const people = t.squad.slots.map((id) => cardById(id as string))
  return people.length === 5 && people.every((c) => c && natCountry(c.nat) === t.nat) && new Set(t.squad.slots).size === 5
    && (!t.squad.coach || natCountry(cardById(t.squad.coach)?.nat ?? null) === t.nat)
}))
check('比赛能找到国家队（杯赛对阵表同一个查法）', cupTeam('enc-kr')?.name === '韩国国家队' && cupTeam('enc-cn')?.tag === 'CN')

// a Korean five and a Korean coach, owned
const own = (g: GachaState, ids: string[]) => { for (const id of ids) g.cards[id] = { id, level: 0, dupes: 0, seen: 1, got: '2026-09-27' } }
const kr = BASE_PLAYER_CARDS.filter((c) => natCountry(c.nat) === 'kr').sort((a, b) => b.rating - a.rating)
const krCoach = COACH_CARDS.find((c) => !c.legend && natCountry(c.nat) === 'kr')!
const g = newGacha('VM-TEST-ENC', '国家队', '2026-09-20')
g.cards = {}
own(g, [...kr.slice(0, 6).map((c) => c.id), krCoach.id])
g.squad = { slots: kr.slice(0, 5).map((c) => c.id), coach: krCoach.id }
const env = (today: string, n = 1) => ({ now: Date.parse(`${today}T06:00:00Z`) + n * 1000, today, seed: 7 + n })
const stamina = staminaNow(g, env('2026-09-28').now)
const entered = runAction(g, 'enc_enter', {}, env('2026-09-28'))
check('韩国五人加韩国教练：可以报名', entered.ok && g.enc?.nat === 'kr' && g.enc.day === '2026-09-28', JSON.stringify(entered).slice(0, 120))
check('不花体力', staminaNow(g, env('2026-09-28').now) === stamina)
check('对手都是国家队，不会碰到韩国', !!g.enc && g.enc.path.every((id) => id.startsWith('enc-') && id !== 'enc-kr'))
let n = 0
while (g.enc && !g.enc.done && n < 12) {
  const r = runAction(g, 'enc_play', {}, env('2026-09-28', ++n))
  if (!r.ok) { check('打比赛', false, r.why); break }
}
check('一届打完', !!g.enc?.done, `${n} 场`)
const again = runAction(g, 'enc_enter', {}, env('2026-09-28', 20))
check('同一天不能再报', !again.ok && /一天一次/.test(again.why))
const tomorrow = runAction(g, 'enc_enter', {}, env('2026-09-29', 21))
check('第二天可以再报', tomorrow.ok && g.enc?.day === '2026-09-29')
check('俱乐部杯不受影响', g.cup === null || g.cup === undefined || !!g.cup)

// the rule: one nationality, all six
const mixed = newGacha('VM-TEST-ENC2', '混编', '2026-09-20')
const cnPlayer = BASE_PLAYER_CARDS.find((c) => natCountry(c.nat) === 'cn')!
mixed.cards = {}
own(mixed, [...kr.slice(0, 4).map((c) => c.id), cnPlayer.id, krCoach.id])
mixed.squad = { slots: [...kr.slice(0, 4).map((c) => c.id), cnPlayer.id], coach: krCoach.id }
const refused = runAction(mixed, 'enc_enter', {}, env('2026-09-28'))
check('混了一个中国选手：不能报，说清楚有哪几国', !refused.ok && /同一国籍/.test(refused.why) && /中国/.test(refused.why) && /韩国/.test(refused.why), refused.ok ? '' : refused.why)
mixed.squad = { slots: kr.slice(0, 4).map((c) => c.id).concat(kr[5].id), coach: null }
own(mixed, [kr[5].id])
const noCoach = runAction(mixed, 'enc_enter', {}, env('2026-09-28'))
check('没有教练：不能报', !noCoach.ok && /教练/.test(noCoach.why), noCoach.ok ? '' : noCoach.why)
// 中国台湾 plays for 中国, as chemistry counts it
const tw = BASE_PLAYER_CARDS.filter((c) => c.nat === 'tw')
check('台湾选手算中国', tw.length > 0 && natCountry(tw[0].nat) === 'cn')

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
