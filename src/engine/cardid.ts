/**
 * Which card account this browser last used.
 *
 * Two lines that read and write one localStorage key, in their own file for
 * one reason: they were in account.ts, which imports the whole card game —
 * gacha, arena, the daily challenge — and through the challenge, the world's
 * 518 players. The front page calls `rememberedId` to decide whether to show
 * an account chip, and was downloading all of that to do it.
 */
const ID_KEY = 'valmanager:card:id'

export const rememberedId = (): string | null => {
  try { return localStorage.getItem(ID_KEY) } catch { return null }
}

export const rememberId = (id: string | null): void => {
  try {
    if (id) localStorage.setItem(ID_KEY, id)
    else localStorage.removeItem(ID_KEY)
  } catch { /* private mode; the id is still in memory for this session */ }
}

/** 「VM-4V6D-••••-W777」 — enough to recognise your own id, not enough to use it. */
export const maskId = (id: string): string => `${id.slice(0, 7)}-••••-${id.slice(-4)}`
