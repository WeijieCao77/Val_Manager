/**
 * 彩蛋卡: one-off joke cards about something that happened on stage.
 *
 * Still the real man — the card is built on his own record (photo, flag, club,
 * positions), only the numbers are the joke. Never dealt by a pack and not part
 * of the 全图鉴: the owner hands them out from the dashboard (发卡, by card id),
 * and after that they trade, upgrade and come apart like any other card.
 */
import type { Attrs } from './types'
import type { PlayerCard, Rarity } from './cards'

export interface EggInfo {
  /** the card's own art, a full 5:7 face */
  art: string
  /** 「回溯大师」 */
  title: string
  /** what happened, short */
  note: string
  /** a word under an attribute, for the ones that are the joke */
  captions: Partial<Record<keyof Attrs, string>>
}

type EggRow = {
  id: string; playerId: string; rating: number; rarity: Rarity; attrs: Attrs
  art: string; artV: string; title: string; note: string; captions: EggInfo['captions']
}

const EGGS: EggRow[] = [
  {
    // 2026 上海冠军赛 LOUD 对 Vitality 第二张图：LOUD 输掉一回合，比分没到 3:0，回到了 2:0 (owner, 2026-10-16)
    id: 'egg:lukxo-rewind', playerId: 'P41', rating: 32, rarity: 'bronze',
    attrs: { aim: 3, reaction: 2, awareness: 3, utility: 32, clutch: 2, teamwork: 3, communication: 99, igl: 99 },
    art: 'events/egg/lukxo-rewind.webp', artV: '1',
    title: '回溯大师',
    note: '2026 上海冠军赛，LOUD 对 Vitality 第二张图：LOUD 丢了一回合，比分没变成 3:0，而是回到了 2:0。',
    captions: { communication: '跟裁判', igl: '改局势', utility: '3→2' },
  },
]

const artUrl = (path: string, v: string): string => {
  const base = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'
  return `${base}${path}?v=${v}`
}

/** Each egg on top of the man's own card; one whose man is not in `base` is left out. */
export function buildEggCards(base: PlayerCard[]): PlayerCard[] {
  const byPlayer = new Map(base.map((c) => [c.playerId, c]))
  return EGGS.flatMap((e) => {
    const him = byPlayer.get(e.playerId)
    if (!him) return []
    return [{
      ...him, id: e.id, event: 'egg' as const, legend: undefined, former: undefined,
      attrs: e.attrs, rating: e.rating, rarity: e.rarity,
      egg: { art: artUrl(e.art, e.artV), title: e.title, note: e.note, captions: e.captions },
    }]
  })
}
