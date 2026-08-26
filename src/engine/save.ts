import { pruneMatchDetail } from './match'
import type { GameState } from './types'

const PREFIX = 'valmanager:save:'
const INDEX = 'valmanager:index'
export const SAVE_VERSION = 1

export interface SaveMeta {
  slot: string
  team: string
  manager: string
  year: number
  day: number
  savedAt: string
}

const readIndex = (): SaveMeta[] => {
  try {
    return JSON.parse(localStorage.getItem(INDEX) ?? '[]') as SaveMeta[]
  } catch {
    return []
  }
}

const writeIndex = (list: SaveMeta[]) => {
  localStorage.setItem(INDEX, JSON.stringify(list))
}

export function listSaves(): SaveMeta[] {
  return healIndex().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function saveGame(slot: string, state: GameState): SaveMeta {
  const meta: SaveMeta = {
    slot,
    team: state.teams[state.myTeam]?.name ?? '—',
    manager: state.managerName,
    year: state.year,
    day: state.day,
    savedAt: new Date().toISOString(),
  }
  localStorage.setItem(PREFIX + slot, JSON.stringify(state))
  // The data write is the one that can fail for size; if the small index write
  // fails after it, the save would exist but never be listed — a player wrote
  // exactly that riddle to the group chat. listSaves() self-heals the index,
  // so a failure here loses the label, never the save.
  try {
    const idx = readIndex().filter((m) => m.slot !== slot)
    idx.push(meta)
    writeIndex(idx)
  } catch { /* the data is in; the index will be rebuilt on next list */ }
  return meta
}

/**
 * Every save that actually exists, whether or not the index knows it.
 *
 * The index is a convenience, not the truth: if its write ever failed after
 * the data went in, or another tab raced it, a save would sit in storage
 * invisible to this screen forever. So the listing walks the real keys and
 * adopts any orphan it finds.
 */
function healIndex(): SaveMeta[] {
  const idx = readIndex()
  const known = new Set(idx.map((m) => m.slot))
  let changed = false
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(PREFIX)) continue
    const slot = key.slice(PREFIX.length)
    if (known.has(slot)) continue
    try {
      const st = JSON.parse(localStorage.getItem(key) ?? '') as GameState
      idx.push({
        slot,
        team: st.teams?.[st.myTeam]?.name ?? '—',
        manager: st.managerName ?? '—',
        year: st.year ?? 0,
        day: st.day ?? 0,
        savedAt: new Date(0).toISOString(),
      })
      changed = true
    } catch { /* not a save; leave it alone */ }
  }
  if (changed) {
    try { writeIndex(idx) } catch { /* listing still works from memory */ }
  }
  return idx
}

/** Where the tutorial parks the real save while its sandbox runs. */
export const TUTORIAL_SNAPSHOT = 'valmgr.tutorial.snapshot'

/**
 * Undo an abandoned tutorial.
 *
 * The trial day rewinds the clock to -1 and commits that to the autosave, then
 * rolls it back when the manager finishes or skips. A page that disappears in
 * between (a phone reclaiming the tab) used to leave the save stranded there
 * forever — every fixture in the past, every countdown nonsense. The tutorial
 * now parks the pre-trial state on disk, so a save still flagged tutorialDay
 * can simply be swapped back for it.
 */
function unwindTutorial(state: GameState): GameState {
  if (!state.tutorialDay) return state
  let parked: GameState | null = null
  try {
    const raw = localStorage.getItem(TUTORIAL_SNAPSHOT)
    if (raw) parked = JSON.parse(raw) as GameState
  } catch { /* fall through to the clamp below */ }
  try { localStorage.removeItem(TUTORIAL_SNAPSHOT) } catch { /* ignore */ }
  if (parked && parked.players && parked.teams) {
    delete (parked as { tutorialDay?: boolean }).tutorialDay
    return parked
  }
  // No parked copy (a save from before this fix, or a write that failed):
  // at least bring the clock back into the calendar so the season can run.
  delete (state as { tutorialDay?: boolean }).tutorialDay
  if (state.day < 0) state.day = 0
  for (const p of Object.values(state.players)) {
    if (p.injuredUntil < 0) p.injuredUntil = 0
  }
  return state
}

export function loadGame(slot: string): GameState | null {
  const raw = localStorage.getItem(PREFIX + slot)
  if (!raw) return null
  try {
    const state = JSON.parse(raw) as GameState
    return migrate(unwindTutorial(state))
  } catch {
    return null
  }
}

export function deleteSave(slot: string): void {
  localStorage.removeItem(PREFIX + slot)
  writeIndex(readIndex().filter((m) => m.slot !== slot))
}

/** Bring an older save forward. */
function migrate(state: GameState): GameState {
  state.version ??= SAVE_VERSION
  state.offers ??= []
  state.honours ??= []
  state.lastResults ??= []
  state.training ??= {}
  state.boardConfidence ??= 60
  for (const t of Object.values(state.teams)) {
    t.champPoints ??= 0
    t.seasonPrize ??= 0
    t.sponsors ??= []
    t.mapPrefs ??= {}
  }
  for (const p of Object.values(state.players)) {
    p.xp ??= {}
    p.agentPool ??= []
    p.injuredUntil ??= 0
  }
  repairClocks(state)
  // Old saves serialized drillVoid: true from a mechanic that no longer sets
  // it — left in place it swallowed the first seven-day drill's entire payout
  // ("跑图7天但是没有涨地图熟练度"). Nothing reads it any more; clear it so
  // an export/reimport cannot resurrect it either.
  delete (state as { drillVoid?: boolean }).drillVoid
  // saves written while physio bookings were not rebased across the new year
  // carry last-visit days from the previous season; a booking in the future
  // is impossible, so clear it
  if (state.physioOn) {
    for (const k of Object.keys(state.physioOn)) {
      if (state.physioOn[k] > state.day) delete state.physioOn[k]
    }
  }
  pruneMatchDetail(state)
  return state
}

/**
 * Straighten timers that a pre-fix rollover left a season in the future.
 *
 * The rollover used to zero the calendar without moving anything scheduled on
 * it, so saves that crossed a season boundary before the rebase shipped carry
 * bids answered in "304 天", sponsors replying next year, and injuries a
 * season long. The rebase only runs at the moment of rollover, which such a
 * save has already passed — so the repair happens here, on load, by clamping
 * anything beyond its horizon down to a few days out. The normal pipeline
 * then resolves it with its normal words.
 */
function repairClocks(state: GameState): void {
  const d = state.day
  const clamp = (v: number | undefined, horizon: number, to: number): number | undefined =>
    v != null && v > d + horizon ? d + to : v
  for (const o of state.offers) {
    if (o.status === 'pending') o.respondOn = clamp(o.respondOn, 15, 2)
  }
  for (const e of state.enquiries ?? []) if (!e.answer) e.replyOn = clamp(e.replyOn, 8, 2)!
  for (const t of state.sponsorTalks ?? []) if (!t.answer) t.replyOn = clamp(t.replyOn, 6, 1)!
  for (const o of state.staffOffers ?? []) if (!o.answer) o.replyOn = clamp(o.replyOn, 12, 2)!
  for (const a of state.staffApproaches ?? []) if (!a.answer) a.replyOn = clamp(a.replyOn, 12, 2)!
  for (const j of state.jobApplications ?? []) j.replyOn = clamp(j.replyOn, 15, 2)!
  // A job offer is written with a 30-day deadline, so a horizon of 20 called
  // every healthy offer corrupt and cut it to five days — one save-and-load
  // and a manager lost 25 of the 30 days he was given to answer.
  for (const j of state.jobOffers ?? []) j.expiresOn = clamp(j.expiresOn, 45, 30)!
  for (const g of state.gigs ?? []) {
    g.expiresOn = clamp(g.expiresOn, 30, 5)!
    if (g.day > d + 40) g.day = d + 7
    if (g.windowEnd != null) g.windowEnd = clamp(g.windowEnd, 40, 10)
  }
  for (const v of state.ventures ?? []) if (v.day > d + 40) v.day = d + 7
  if (state.pitchCooldown != null && state.pitchCooldown > d + 14) state.pitchCooldown = d
  if (state.drillLock != null && state.drillLock > d + 7) state.drillLock = undefined
  for (const p of Object.values(state.players)) {
    if (p.injuredUntil > d + 45) p.injuredUntil = d + 10
    if (p.stream && p.stream.until > d + 200) p.stream.until = d + 84
  }
}

export function exportSave(state: GameState): string {
  return JSON.stringify(
    { format: 'VAL_MANAGER_SAVE', version: SAVE_VERSION, exportedAt: new Date().toISOString(), state },
    null,
    0,
  )
}

export function importSave(text: string): GameState {
  const parsed = JSON.parse(text) as { format?: string; state?: GameState }
  if (parsed.format !== 'VAL_MANAGER_SAVE' || !parsed.state) {
    throw new Error('这不是一个有效的 VAL MANAGER 存档文件。')
  }
  return migrate(parsed.state)
}

const AUTOSAVE = 'autosave'
export const autosave = (state: GameState) => saveGame(AUTOSAVE, state)
export const loadAutosave = () => loadGame(AUTOSAVE)
export const hasAutosave = () => localStorage.getItem(PREFIX + AUTOSAVE) !== null

/**
 * Importing a file must not silently eat a newer career.
 *
 * The first commit after an import writes the imported state over the
 * autosave. A player who imported an old backup while troubleshooting watched
 * their newer run vanish from 继续上次存档 — the import had overwritten it
 * before they touched anything. If the autosave on disk is further along than
 * what is being imported, it is copied to a rescue slot first.
 */
/**
 * The three things that can happen when an import is about to overwrite a
 * newer career.
 *
 * `null` — nothing to rescue. `{slot}` — the newer career is safely parked.
 * `{failed}` — there IS a newer career and we could NOT park it, almost
 * always because localStorage is full. That case used to be indistinguishable
 * from "nothing to rescue", so the import went ahead and the newer career was
 * gone with no warning at all. The caller must ask before overwriting.
 */
export function protectAutosaveFrom(
  imported: GameState,
): { slot: string; failed?: false } | { slot?: undefined; failed: true; year: number; day: number } | null {
  let current: GameState | null = null
  try {
    current = loadAutosave()
  } catch { return null }
  if (!current) return null
  const newer = current.year > imported.year ||
    (current.year === imported.year && current.day > imported.day)
  if (!newer) return null
  const slot = `导入前备份 ${current.year}年D${current.day}`
  try {
    saveGame(slot, current)
    return { slot }
  } catch {
    return { failed: true, year: current.year, day: current.day }
  }
}
