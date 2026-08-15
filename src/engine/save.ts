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
  return readIndex().sort((a, b) => b.savedAt.localeCompare(a.savedAt))
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
  const idx = readIndex().filter((m) => m.slot !== slot)
  idx.push(meta)
  writeIndex(idx)
  return meta
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
