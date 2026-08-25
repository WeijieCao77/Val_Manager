/**
 * The save pipeline, end to end, including the player's riddle.
 *
 * A group-chat report read: "保存的是最新版本 导出的是老版本 在继续上次存档里
 * 最新版本消失了 但是…我有保存新版本". Decoded, that was three defects
 * stacked: manual slots were write-only (保存 and 删除 existed, 读取 did not,
 * anywhere), importing an old backup silently overwrote a newer autosave on
 * the first commit, and a save whose index write failed existed in storage
 * while never appearing in the list.
 */
import { createNewGame, WORLD_TEAMS } from '../src/engine/world'
import { advanceDay, setupSeason } from '../src/engine/season'
import { Rng } from '../src/engine/rng'

// save.ts talks to localStorage; give node one
const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if ((globalThis as never as { __quota?: boolean }).__quota) {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    store.set(k, v)
  },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}
const { saveGame, loadGame, listSaves, exportSave, importSave, autosave,
        loadAutosave, protectAutosaveFrom } = await import('../src/engine/save')

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const mk = (seed: number) => {
  const g = createNewGame(WORLD_TEAMS.find((t) => t.tag === 'TYL')!.id, '审计', seed)
  setupSeason(g)
  return g
}

// ---- export → import roundtrip, then the imported game must actually play
{
  const g = mk(1)
  const rng = new Rng(2)
  for (let i = 0; i < 30; i++) advanceDay(g, rng)
  const back = importSave(exportSave(g))
  check('a roundtripped save keeps its place',
    back.day === g.day && back.year === g.year &&
    Object.keys(back.players).length === Object.keys(g.players).length,
    `day ${back.day}, ${Object.keys(back.players).length} players`)
  let guard = 0
  let threw = ''
  try {
    while (guard++ < 60) advanceDay(back, rng)
  } catch (e) { threw = (e as Error).message }
  check('and plays on for two months without throwing', threw === '', threw)
}

// ---- an old export, missing every field added since, must still load and play
{
  const g = mk(3)
  const raw = JSON.parse(exportSave(g)) as { state: Record<string, unknown> }
  const st = raw.state as never as Record<string, unknown>
  // everything optional the engine has grown since the first release
  for (const k of ['enquiries', 'jobOffers', 'jobApplications', 'staffOffers',
    'staffApproaches', 'sponsorTalks', 'gigs', 'ventures', 'staff', 'bonds',
    'activity', 'drill', 'drillLock', 'pitchCooldown', 'managerContract',
    'objective', 'actions', 'commercialDays']) delete st[k]
  for (const p of Object.values(st.players as Record<string, Record<string, unknown>>)) {
    for (const k of ['roles', 'rolePro', 'flex', 'traits', 'contract', 'trust',
      'grievance', 'stream', 'marks', 'listedOn', 'payAskedOn', 'rumourOn',
      'stageBonus', 'joined', 'rounds', 'agentPool', 'xp']) delete p[k]
  }
  let threw = ''
  let old: ReturnType<typeof importSave> | null = null
  try { old = importSave(JSON.stringify(raw)) } catch (e) { threw = (e as Error).message }
  check('a first-release save still imports', !!old && threw === '', threw)
  if (old) {
    const rng = new Rng(4)
    let guard = 0
    try {
      while (guard++ < 90) advanceDay(old, rng)
    } catch (e) { threw = (e as Error).message }
    check('and survives a quarter of a season', threw === '', threw)
  }
}

// ---- the write-only slot: saved, listed, loadable
{
  store.clear()
  const g = mk(5)
  saveGame('我的存档', g)
  const listed = listSaves().some((m) => m.slot === '我的存档')
  const loaded = loadGame('我的存档')
  check('a manual slot is listed and loads back', listed && loaded?.day === g.day)
}

// ---- the invisible save: data written, index write lost — the list must heal
{
  store.clear()
  const g = mk(6)
  saveGame('孤儿存档', g)
  store.delete('valmanager:index')
  const healed = listSaves()
  check('a save the index forgot is found again',
    healed.some((m) => m.slot === '孤儿存档'), healed.map((m) => m.slot).join(' '))
  check('and still loads', loadGame('孤儿存档')?.year === g.year)
}

// ---- the import clobber: an old file must not eat a newer autosave
{
  store.clear()
  const newer = mk(7)
  const rng = new Rng(8)
  for (let i = 0; i < 50; i++) advanceDay(newer, rng)
  autosave(newer)
  const oldFile = mk(7)               // day 0 — an old backup of the same career
  const rescued = protectAutosaveFrom(oldFile)
  check('importing an old file rescues the newer autosave first',
    rescued != null && loadGame(rescued!)?.day === newer.day, `→「${rescued}」`)
  const same = protectAutosaveFrom(newer)
  check('importing something no older rescues nothing', same === null)
}

// ---- a full write failure has to say so, not half-succeed
{
  store.clear()
  const g = mk(9)
  ;(globalThis as never as { __quota: boolean }).__quota = true
  let threw = false
  try { autosave(g) } catch { threw = true }
  ;(globalThis as never as { __quota: boolean }).__quota = false
  check('a quota failure surfaces instead of pretending', threw)
  check('and leaves no half-written autosave', loadAutosave() === null)
}

process.exit(bad ? 1 : 0)
