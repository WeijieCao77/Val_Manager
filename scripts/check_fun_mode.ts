/**
 * 娱乐模式 (beta): retired players and streamers come back, for the manager's
 * club only, and the numbers say what the page says.
 *
 *   npx tsx scripts/check_fun_mode.ts
 */
import raw from '../src/data/funPool.json'
import world from '../src/data/world.json'
import prospects from '../src/data/prospects.json'
import retired from '../src/data/retired.json'
import { createNewGame } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { advanceDay, continuePastFive, setupSeason } from '../src/engine/season'
import { doTransfer } from '../src/engine/transfer'
import { expectedSalary, recomputeOverall } from '../src/engine/player'
import { streamOffer } from '../src/engine/commercial'
import { packState, unpackState } from '../src/engine/save'
import { squadOf } from '../src/engine/roster'
import { defaultContract } from '../src/engine/types'
import { FAME_WAGE, headroomFor, rustRecovered, RUST_YEARS_MAX, type FunRow } from '../src/engine/fun'
import type { GameState, Player } from '../src/engine/types'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const rows = (raw as unknown as { players: FunRow[] }).players
const club = (tag: string) => WORLD_TEAMS.find((t) => t.tag === tag)!.id
const fresh = (seed = 7, tag = 'EDG') => { const g = createNewGame(club(tag), '审计', seed, undefined, { fun: rows }); setupSeason(g); return g }
const pin = (g: GameState) => { g.boardConfidence = 100; g.onNotice = false; g.missedStreak = 0; if (g.midReview) continuePastFive(g) }
const by = (g: GameState, ign: string) => Object.values(g.players).find((p) => p.ign === ign && p.comeback)!

// ---- the pool
const ids = rows.map((r) => r.id)
const taken = new Set([...(world as { players: { id: string }[] }).players.map((p) => p.id),
  ...(prospects as unknown as { players: { id: string }[] }).players.map((p) => p.id)])
const coaches = new Set((retired as unknown as { players: { id: string; coach: boolean }[] }).players.filter((p) => p.coach).map((p) => p.id))
check('名单不重复，不和现役、新人撞 id', new Set(ids).size === ids.length && ids.every((id) => !taken.has(id)))
check('现在在当教练的退役选手不进名单', ids.every((id) => !coaches.has(id)))
for (const [ign, kind, fame] of [['TenZ', 'retired', 3], ['Sacy', 'retired', 2], ['yay', 'retired', 2], ['Babyblue', 'retired', 2],
  ['tarik', 'streamer', 3], ['TryTryz', 'streamer', 1]] as const) {
  const r = rows.find((x) => x.ign === ign)
  check(`${ign} 在名单里：${kind === 'retired' ? '退役' : '主播'}，人气 ${fame}`, !!r && r.kind === kind && r.fame === fame)
}
check('退役选手带着最后一季的真实能力', rows.filter((r) => r.kind === 'retired').every((r) => r.lastYear && r.overall && r.attrs))

// ---- a fun career
const g = fresh()
const fun = Object.values(g.players).filter((p) => p.comeback)
check('娱乐模式开档：mode=fun，名单全在自由人里', g.mode === 'fun' && fun.length === rows.length && fun.every((p) => p.teamId === null && p.contractYears === 0))
const normal = createNewGame(club('EDG'), '审计', 7)
check('普通开档：没有复出选手', normal.mode === undefined && !Object.values(normal.players).some((p) => p.comeback))
check('历史档不能开娱乐模式', !Object.values(createNewGame(club('EDG'), '审计', 7, undefined, { fun: rows, year: 2025 }).players).some((p) => p.comeback))

const tenz = by(g, 'TenZ')
{
  // TenZ: last season 2024, two years without a team, 24, streams — mechanics barely rusted, team play most
  const row = rows.find((r) => r.ign === 'TenZ')!
  const rust = tenz.comeback!.rust
  check('TenZ 生锈：配合类每项 −4，枪法反应只 −1', rust.teamwork === 4 && rust.communication === 4 && rust.utility === 4 && (rust.aim ?? 0) === 1 && (rust.reaction ?? 0) === 1,
    JSON.stringify(rust))
  const restored = { ...tenz, attrs: { ...tenz.attrs } } as Player
  for (const [k, v] of Object.entries(rust)) restored.attrs[k as keyof Player['attrs']] += v ?? 0
  const back = recomputeOverall(restored)
  check('TenZ 找回状态后回到最后一季的水平（24 岁没有年龄衰退）', back === row.overall, `${back} vs ${row.overall}`)
  check('TenZ 上限 = 巅峰 + 年轻余量', tenz.potential === Math.max(back, row.peak ?? back) + headroomFor(tenz.age), `${tenz.potential}`)
  check('TenZ 复出时比巅峰低，也不是一个废人', tenz.overall < back && tenz.overall >= back - 4, `${tenz.overall} → ${back}`)
}
{
  const sacy = by(g, 'Sacy')
  check('Sacy 28 岁：过了 27 岁，反应有永久衰退', sacy.attrs.reaction < rows.find((r) => r.ign === 'Sacy')!.attrs.reaction - (sacy.comeback!.rust.reaction ?? 0))
  const tarik = by(g, 'tarik')
  check('tarik 没打过职业队：没有锈，上限给 2 点学团队配合', tarik.comeback!.rustStart === 0 && tarik.potential === tarik.overall + 2, `${tarik.overall}/${tarik.potential}`)
  const tt = by(g, 'TryTryz')
  check('TryTryz 2023 年后没打：按三年算锈', tt.comeback!.rustStart > 0 && Math.max(...Object.values(tt.comeback!.rust).map(Number)) <= 2 * RUST_YEARS_MAX)
  check('人气抬高要价', expectedSalary(tenz, 1) > 0 && FAME_WAGE[3] > FAME_WAGE[0])
}

// ---- signing one, and the weeks after
{
  const g2 = fresh(11)
  const t = by(g2, 'TenZ')
  const repBefore = g2.teams[g2.myTeam].reputation
  const salary = expectedSalary(t, 1)
  const ok = doTransfer(g2, t, g2.myTeam, 0, defaultContract(salary, 2))
  check('签下 TenZ', ok && t.teamId === g2.myTeam, ok ? '' : 'doTransfer refused')
  const start = t.overall
  const weeks: number[] = []
  for (let d = 0; d < 7 * 14; d++) { pin(g2); advanceDay(g2, { autoResolveDrawDecisions: true }); if (g2.day % 7 === 0) weeks.push(Math.round(rustRecovered(t) * 100)) }
  check('入队后每周找回状态，十四周内全部回来', weeks.length >= 12 && weeks[weeks.length - 1] === 100 && weeks.every((v, i) => !i || v >= weeks[i - 1]),
    weeks.join(' '))
  check('找回状态后能力回升', t.overall > start, `${start} → ${t.overall}`)
  check('他在队时俱乐部声望慢慢上涨', g2.teams[g2.myTeam].reputation > repBefore, `${repBefore.toFixed(1)} → ${g2.teams[g2.myTeam].reputation.toFixed(1)}`)
  const offerTenz = streamOffer(g2, t.id)
  const plain = squadOf(g2, g2.myTeam).filter((p) => !p.comeback).sort((a, b) => b.overall - a.overall)[0]
  const offerPlain = plain ? streamOffer(g2, plain.id) : null
  check('顶流主播的直播合同比队里能力更高的普通选手值钱', !!offerTenz && (!offerPlain || offerTenz.fee > offerPlain.fee),
    `TenZ ${offerTenz?.fee} vs ${plain?.ign} ${offerPlain?.fee}`)
  const s = unpackState(packState(g2))
  check('存档往返：复出状态和模式都在', s.mode === 'fun' && JSON.stringify(s.players[t.id].comeback) === JSON.stringify(t.comeback))
}

// ---- two seasons: the AI never signs them, and nobody in the pool retires again
{
  const g3 = fresh(23, 'FUR')
  const before = new Set(Object.values(g3.players).filter((p) => p.comeback).map((p) => p.id))
  let aiSigned = 0, gone = 0, short = 0
  const y0 = g3.year
  while (g3.year < y0 + 2) {
    pin(g3)
    advanceDay(g3, { autoResolveDrawDecisions: true })
    if (g3.day % 7 === 0) {
      for (const id of before) {
        const p = g3.players[id]
        if (!p) { gone++; before.delete(id); continue }
        if (p.teamId && p.teamId !== g3.myTeam) aiSigned++
      }
    }
  }
  for (const t of Object.values(g3.teams)) if (t.id !== g3.myTeam && squadOf(g3, t.id).length < 5) short++
  check('两个赛季里 AI 俱乐部一个都没签', aiSigned === 0, `${aiSigned}`)
  check('没签约的不会再退役一次', gone === 0, `${gone} 人消失`)
  check('AI 俱乐部照样凑得齐五人', short === 0, `${short} 支不足五人`)
}

console.log(bad ? `\n${bad} 项不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
