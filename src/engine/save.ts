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

export function loadGame(slot: string): GameState | null {
  const raw = localStorage.getItem(PREFIX + slot)
  if (!raw) return null
  try {
    const state = JSON.parse(raw) as GameState
    return migrate(state)
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
  return state
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
export function protectAutosaveFrom(imported: GameState): string | null {
  try {
    const current = loadAutosave()
    if (!current) return null
    const newer = current.year > imported.year ||
      (current.year === imported.year && current.day > imported.day)
    if (!newer) return null
    const slot = `导入前备份 ${current.year}年D${current.day}`
    saveGame(slot, current)
    return slot
  } catch {
    return null
  }
}
