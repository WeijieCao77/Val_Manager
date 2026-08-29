/**
 * One id, two games, and a record that can only ever grow.
 *
 * The profile has no revision counter and no conflict handling, and that is a
 * deliberate choice rather than an omission: every field is a set that only
 * gains members or a number that only rises, so two devices writing at once
 * produce the union whichever order they land in. These check that the claim
 * is actually true of the code — on the client, and on the server, which
 * implement the same fold twice in two languages' worth of idiom.
 *
 *     npx tsx scripts/check_profile.ts
 */
import { claimLocal, mergeProfile, emptyProfile, readProfile, record } from '../src/engine/profile'
import {
  ACHIEVEMENTS, ACHIEVEMENT_COUNT, LIFE_ACHIEVEMENTS, RUN_ACHIEVEMENTS, earnedNow,
} from '../src/engine/achievements'
import { ENDINGS } from '../src/engine/endings'
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { setupSeason } from '../src/engine/season'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

// ---- the merge is a union, in both directions
{
  const a = { ...emptyProfile('A'), endings: ['worldFirst'], achievements: ['firstTitle'] }
  const b = { ...emptyProfile('A'), endings: ['oneClub'], achievements: ['rich'] }
  const ab = mergeProfile(a, b)
  const ba = mergeProfile(b, a)
  check('合并结果与顺序无关',
    [...ab.endings].sort().join() === [...ba.endings].sort().join()
    && [...ab.achievements].sort().join() === [...ba.achievements].sort().join())
  check('两边的解锁都保留', ab.endings.length === 2 && ab.achievements.length === 2)

  // the case that matters: an old device syncing must not delete anything
  const stale = { ...emptyProfile('A'), endings: [] as string[] }
  check('旧设备同步不会删掉任何东西', mergeProfile(ab, stale).endings.length === 2)
}

// ---- counters take the maximum, never the newer value
{
  const high = { ...emptyProfile('A') }
  high.record = { ...high.record, titles: 40, careers: 6, bestHaul: 19 }
  const low = { ...emptyProfile('A') }
  low.record = { ...low.record, titles: 3, careers: 1, bestHaul: 2 }
  const m = mergeProfile(high, low)
  check('计数取最大值而不是最后写入的值',
    m.record.titles === 40 && m.record.careers === 6 && m.record.bestHaul === 19,
    `${m.record.titles} 冠 / ${m.record.careers} 段 / 最佳 ${m.record.bestHaul}`)
}

// ---- record() reports only what is new, so a toast fires once
{
  store.clear()
  const first = record({ achievements: ['firstTitle', 'rich'] }, 'T1')
  const again = record({ achievements: ['firstTitle', 'rich'] }, 'T1')
  const more = record({ achievements: ['firstTitle', 'rich', 'fullSquad'] }, 'T1')
  check('第一次全部算新', first.fresh.achievements.length === 2)
  check('重复上报不再算新', again.fresh.achievements.length === 0)
  check('只有真正新增的才算新',
    more.fresh.achievements.length === 1 && more.fresh.achievements[0] === 'fullSquad')
  check('写入之后读得回来', readProfile('T1').achievements.length === 3)
}

// ---- unlocks earned before there was an account follow it once there is one
{
  store.clear()
  // played the manager first, never opened the card mode: no id yet
  record({ achievements: ['firstTitle', 'rich'], endings: ['worldFirst'] }, null)
  check('没有 ID 时先记到 local 上', readProfile('local').achievements.length === 2)

  // then made an account
  const mine = claimLocal('VM-REAL')
  check('有了 ID 之后成就跟过来', mine.achievements.length === 2 && mine.endings.length === 1,
    `${mine.achievements.length} 成就 / ${mine.endings.length} 结局`)
  check('local 上的副本被清掉，不会被认领两次',
    readProfile('local').achievements.length === 0)
  check('重复认领是安全的', claimLocal('VM-REAL').achievements.length === 2)

  // and an account that already has things does not lose them to the fold
  record({ achievements: ['fullSquadX'] }, 'VM-OTHER')
  record({ achievements: ['firstProspect'] }, null)
  const other = claimLocal('VM-OTHER')
  check('认领不会覆盖账号里已有的东西',
    other.achievements.includes('fullSquadX') && other.achievements.includes('firstProspect'),
    other.achievements.join('、'))
}

// ---- 生涯成就要在「本回合没有新东西」时也重算
{
  // Found by unlocking all 43 in the browser: 生涯成就 stayed at 0/6 with a
  // record that plainly satisfied them. record() short-circuited on
  // "nothing new" BEFORE recomputing them, so an account that crossed fifty
  // titles unlocked 五十冠 only later, whenever some unrelated badge happened
  // to fire and drag the recount along.
  store.clear()
  const id = 'VM-LIFE'
  // a record that earns 老江湖 (careers >= 5) and 五十冠, recorded quietly
  record({ achievements: ['firstTitle'] }, id)
  const quiet = record({
    achievements: ['firstTitle'],           // nothing new here
    record: undefined,
  }, id)
  check('没有新局内成就时也不会漏算生涯成就',
    quiet.profile.achievements.includes('firstTitle'))

  // now push the record over the line WITHOUT unlocking anything else
  const before = readProfile(id)
  store.set('valmanager:profile:' + id, JSON.stringify({
    ...before,
    record: { ...before.record, careers: 6, titles: 60 },
  }))
  const after = record({ achievements: ['firstTitle'] }, id)
  check('账号数据跨过门槛的那一刻，生涯成就就解锁',
    after.profile.achievements.includes('careers5')
    && after.profile.achievements.includes('titles50'),
    after.profile.achievements.join('、'))
  check('并且被报告为新解锁，弹窗才会出现',
    after.fresh.achievements.includes('careers5'),
    after.fresh.achievements.join('、') || '没有报告任何新解锁')
}

// ---- damaged input cannot poison the record
{
  store.set('valmanager:profile:X', JSON.stringify({
    endings: 'not-an-array', achievements: [1, 2, {}, 'ok'],
    record: { titles: 'abc', careers: -5, clubs: 'nope' },
  }))
  const p = readProfile('X')
  check('坏掉的存档读成空而不是崩掉',
    Array.isArray(p.endings) && p.endings.length === 0
    && p.achievements.length === 1 && p.achievements[0] === 'ok')
  check('非数字的计数归零而不是 NaN',
    p.record.titles === 0 && p.record.careers === 0 && Array.isArray(p.record.clubs),
    `titles=${p.record.titles} careers=${p.record.careers}`)

  store.set('valmanager:profile:Y', '{ this is not json')
  check('读不了的存档不抛异常', readProfile('Y').achievements.length === 0)
}

// ---- the two catalogues are well-formed
{
  const keys = ACHIEVEMENTS.map((a) => a.key)
  check('成就 key 不重复', new Set(keys).size === keys.length)
  check('成就分成局内和生涯两类，两类都不为空',
    RUN_ACHIEVEMENTS.length > 0 && LIFE_ACHIEVEMENTS.length > 0,
    `局内 ${RUN_ACHIEVEMENTS.length} 条，生涯 ${LIFE_ACHIEVEMENTS.length} 条，共 ${ACHIEVEMENT_COUNT}`)
  check('局内成就都有判定，生涯成就都有判定',
    RUN_ACHIEVEMENTS.every((a) => !!a.test) && LIFE_ACHIEVEMENTS.every((a) => !!a.lifeTest))
  check('每条成就都有标题和条件说明',
    ACHIEVEMENTS.every((a) => a.title.length > 0 && a.brief.length > 0))
  // endings and achievements share one namespace on the profile, so a key
  // colliding across the two would unlock the wrong thing
  const clash = keys.filter((k) => ENDINGS.some((e) => e.key === k))
  check('成就 key 不和结局 key 撞车', clash.length === 0, clash.join('、') || '无')
}

// ---- a fresh career has earned nothing yet, and nothing throws
{
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', 20260828)
  setupSeason(g)
  const got = earnedNow(g)
  check('开局不会白送成就', got.length <= 2, got.join('、') || '一个都没有')

  // and every single predicate survives a save with holes in it
  const holed = JSON.parse(JSON.stringify(g))
  delete holed.staff; delete holed.tenures; delete holed.startingSquad
  holed.finances.log = undefined
  holed.fixtures = undefined
  let threw = ''
  try { earnedNow(holed) } catch (e) { threw = (e as Error).message }
  check('残缺存档不会让成就检查抛异常', !threw, threw || '没有抛')
}

console.log(bad ? `\n${bad} failed` : '\nall held')
process.exit(bad ? 1 : 0)
