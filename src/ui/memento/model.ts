import type { Card } from '../../engine/cards'
import { DOSSIER, faceUrl } from '../../engine/dossier'
import type { GameState } from '../../engine/types'

export interface MementoData {
  collection?: { card: Card; level: number }[]
  selectedCardIds?: string[]
  cardImages?: string[]
  kind: 'manager' | 'cards'
  teamTag?: string
  members: { name: string; face?: string | null; rarity?: string; rating?: number; level?: number }[]
  mode: string
  name: string
  journey: string
  stats: { label: string; value: string }[]
  lineup: string[]
  coach?: string
  memory: string
}

export function managerMemento(game: GameState): MementoData {
  const team = game.teams[game.myTeam]
  return {
    kind: 'manager', teamTag: team?.tag ?? 'MY TEAM',
    members: (team?.starters ?? []).slice(0, 5).map(id => {
      const d = DOSSIER.players[id] ?? DOSSIER.hist?.[id]
      return { name: game.players[id]?.ign ?? '未记录选手', face: d?.img ? faceUrl(d.img, d.v) : null }
    }),
    mode: '电竞经理', name: game.managerName || game.manager?.name || '经理',
    journey: `${team?.name ?? '我的俱乐部'} · ${game.year} 赛季`,
    stats: [
      { label: '生涯游戏天数', value: String(Math.max(0, game.day)) },
      { label: '冠军荣誉', value: String(game.honours.length) },
      { label: '当前赛季', value: String(game.year) },
      { label: '俱乐部阵容', value: `${team?.roster.length ?? 0} 人` },
    ],
    lineup: (team?.starters ?? []).slice(0, 5).map(id => game.players[id]?.ign ?? '未记录选手'),
    coach: team?.coach?.name,
    memory: game.honours.length ? `最近的荣誉：${game.honours[game.honours.length - 1].year} ${game.honours[game.honours.length - 1].title}` : '从第一次排出首发开始，这段故事就属于你。',
  }
}
