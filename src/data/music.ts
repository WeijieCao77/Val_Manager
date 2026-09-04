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
  { id: 'when-the-world-ends', title: 'When the World Ends', artist: 'VALORANT · Raiden · jeonghyeon', file: 'music/when-the-world-ends.mp3?v=1' },
  { id: 'ticking-away', title: 'Ticking Away', artist: 'VALORANT · Grabbitz · bbno$', file: 'music/ticking-away.mp3?v=1' },
  { id: 'superpower', title: 'SUPERPOWER', artist: 'VALORANT · KISS OF LIFE · 段宜恩', file: 'music/superpower.mp3?v=1' },
  { id: 'la-lumiere', title: 'La Lumière', artist: 'VALORANT · WILLIM缪维霖 · 贺仙人', file: 'music/la-lumiere.mp3?v=1' },
]
