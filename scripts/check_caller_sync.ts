/**
 * A career already under way picks up the world's caller corrections.
 *
 * 「NS 的 IGL 不是 Francis 是 Rb，TEC 加 lucas，T1 加 stax」 was applied to
 * the world on 2026-09-05 and reached new careers only: a save carries its
 * own players. syncCallersWithWorld runs when a career is opened. This
 * builds a career, rewinds its flags to the old data by hand, and opens it.
 */
import { createNewGame, syncCallersWithWorld, appointIgl, CALLER_STAMP } from '../src/engine/world'
import { WORLD_TEAMS } from '../src/engine/teams'
import { setupSeason } from '../src/engine/season'
import { squadOf, callerOf } from '../src/engine/roster'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}
const byIgn = (g: ReturnType<typeof createNewGame>, ign: string) => Object.values(g.players).find((p) => p.ign === ign)!
const tagOf = (g: ReturnType<typeof createNewGame>, id: string | null | undefined) => (id ? g.teams[id]?.tag : '—')

// ---- an AI-managed NS, TEC and T1: the save on the old data
{
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'PRX')!.id, '审计经理', 20260905)
  setupSeason(g)
  const francis = byIgn(g, 'Francis'), rb = byIgn(g, 'Rb'), lucas = byIgn(g, 'lucas'), stax = byIgn(g, 'stax')
  // rewind: Francis calls at NS, Rb / lucas / stax are not flagged
  francis.isIgl = true; francis.iglSource = 'verified'; g.teams[francis.teamId!].igl = francis.id
  for (const p of [rb, lucas, stax]) { p.isIgl = false; p.iglSource = undefined }
  g.callerSync = undefined
  // an AI club with an inferred stand-in, and the data adds a real caller to it
  const tec = g.teams[lucas.teamId!]
  const haodong = byIgn(g, 'Haodong')
  haodong.isIgl = false; haodong.iglSource = undefined
  const standIn = squadOf(g, tec.id).find((p) => p.id !== lucas.id && p.id !== haodong.id)!
  standIn.isIgl = true; standIn.iglSource = 'inferred'; tec.igl = standIn.id
  // a man who moved clubs in the save keeps being an IGL by trade
  const t1 = g.teams[stax.teamId!]
  const newClub = Object.values(g.teams).find((t) => t.id !== t1.id && t.id !== g.myTeam && t.tier === 1)!
  t1.roster = t1.roster.filter((id) => id !== stax.id); t1.starters = t1.starters.filter((id) => id !== stax.id)
  newClub.roster.push(stax.id); stax.teamId = newClub.id

  const notes = syncCallersWithWorld(g)
  console.log('  ' + notes.join('，'))
  check('Francis is no longer NS\'s caller', !francis.isIgl)
  check('Rb is, and NS calls through him', rb.isIgl && rb.iglSource === 'verified' && callerOf(g, rb.teamId!)?.id === rb.id, `NS caller ${callerOf(g, rb.teamId!)?.ign} (${tagOf(g, rb.teamId)})`)
  check('lucas and Haodong are flagged at TEC and the stand-in stepped back',
    lucas.isIgl && haodong.isIgl && !standIn.isIgl && [lucas.id, haodong.id].includes(tec.igl!),
    `TEC main ${g.players[tec.igl!]?.ign}, stand-in ${standIn.ign} ${standIn.isIgl}`)
  check('stax is flagged at the club he moved to', stax.isIgl && stax.teamId === newClub.id && callerOf(g, newClub.id)?.isIgl === true)
  check('the save is stamped and a second open changes nothing', g.callerSync === CALLER_STAMP && syncCallersWithWorld(g).length === 0)
  check('the news says what changed', g.news.some((n) => n.text.includes('指挥名单按最新数据更新') && n.text.includes('Rb')))
}

// ---- the manager's own club is his to arrange
{
  const ns = WORLD_TEAMS.find((t) => t.tag === 'NS')!
  const g = createNewGame(ns.id, '审计经理', 20260905)
  setupSeason(g)
  const francis = byIgn(g, 'Francis'), rb = byIgn(g, 'Rb')
  // the old data: Francis verified caller of our club; the manager also appointed a third man himself
  francis.isIgl = true; francis.iglSource = 'verified'
  rb.isIgl = false; rb.iglSource = undefined
  g.teams[g.myTeam].igl = francis.id
  const third = squadOf(g, g.myTeam).find((p) => p.id !== francis.id && p.id !== rb.id)!
  console.log('  ' + appointIgl(g, third.id))
  g.callerSync = undefined
  syncCallersWithWorld(g)
  check('the manager\'s appointee stays the main caller', g.teams[g.myTeam].igl === third.id && third.iglSource === 'appointed')
  check('Francis keeps his flag at the manager\'s club — not the sync\'s call to make', francis.isIgl)
  check('Rb arrives as a deputy', rb.isIgl && callerOf(g, g.myTeam)?.id === third.id)
}
console.log(bad ? `\n${bad} problem(s)` : '\nall good')
process.exit(bad ? 1 : 0)
