import { savePrefix } from './saveKeys'
import { assertCareerSave } from './saveShape'
import { HOME_CLUBS } from './homeClubs'

export interface CareerPreview { club: string | null; clubId: string; year: number; over: boolean }

/** Read the resume label only. Loading/migrating the actual career happens on entry. */
export function readCareerPreview(): CareerPreview | null {
  try {
    const raw = localStorage.getItem(`${savePrefix()}autosave`)
    if (!raw) return null
    let s: unknown = JSON.parse(raw)
    assertCareerSave(s)
    // A trial day resumes from its parked career just as loadGame does, but
    // reading a home-page label must never consume that recovery snapshot.
    if (s.tutorialDay) {
      const parked = localStorage.getItem('valmgr.tutorial.snapshot')
      if (parked) {
        try { const saved: unknown = JSON.parse(parked); assertCareerSave(saved); s = saved } catch { /* show current career */ }
      }
    }
    assertCareerSave(s)
    return { club: HOME_CLUBS[s.myTeam]?.name ?? s.teams[s.myTeam]?.name ?? null,
      clubId: s.myTeam, year: s.year, over: !!s.gameOver }
  } catch { return null }
}
