/**
 * What plays under the game.
 *
 * Riot's own VALORANT releases, which their fan-content policy lets a
 * non-commercial project like this one use. The files live in public/music
 * as 160k mp3s — small enough for a phone, and the server hands them out in
 * byte ranges so Safari will play them at all.
 *
 * Order is play order. `file` is relative to the site root and carries a
 * version so a replaced file is a new URL under the week-long cache.
 */
export interface Track {
  id: string
  title: string
  artist: string
  file: string
}

export const TRACKS: Track[] = [
  { id: 'die-for-you', title: 'Die For You', artist: 'VALORANT · Grabbitz', file: 'music/die-for-you.mp3?v=1' },
]
