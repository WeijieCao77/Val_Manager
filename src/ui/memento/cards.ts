import { cardById, cardName } from '../../engine/cards'
import { collection, rankName } from '../../engine/gacha'
import { playLevel } from '../../engine/evolve'
import type { GachaState } from '../../engine/gacha'
import type { MementoData } from './model'

/** the five on the squad now, when they are five different owned player cards */
function startingFive(g: GachaState): string[] {
  const ids = g.squad.slots.filter((id): id is string => !!id && !!g.cards[id] && cardById(id)?.kind === 'player')
  return ids.length === 5 && new Set(ids).size === 5 ? ids : []
}

export function cardsMemento(g: GachaState): MementoData {
  const joined = /^\d{4}-\d{2}-\d{2}/.exec(g.createdAt)?.[0]
  return {
    kind: 'cards',
    collection: collection(g).filter(({ card }) => card.kind === 'player').map(({ card, owned }) => ({ card, level: playLevel(card.id, owned) })),
    selectedCardIds: startingFive(g),
    members: g.squad.slots.slice(0, 5).map(id => {
      const card = id ? cardById(id) : undefined
      return { name: card ? cardName(card) : '虚位以待', face: card?.face, rarity: card?.rarity, rating: card?.rating, level: id ? g.cards[id]?.level ?? 0 : 0 }
    }),
    mode: '开瓦包', name: g.name || '收藏家',
    journey: joined ? `故事开始于 ${joined.split('-').join('.')} ` : '我的开包与收藏之旅',
    stats: [
      { label: '累计抽卡', value: String(g.pulls) },
      { label: '当前收藏种类', value: String(Object.values(g.cards).filter(Boolean).length) },
      { label: '公开天梯胜场', value: String(g.ladder.wins) },
      { label: '当前公开天梯', value: rankName(g.ladder.div, g.ladder.stars, g.ladder.points ?? 0) },
    ],
    lineup: g.squad.slots.slice(0, 5).map(id => {
      const card = id ? cardById(id) : undefined
      return card ? cardName(card) : id ? '未记录选手' : '虚位以待'
    }),
    // the poster is the five cards picked; the squad's coach is not one of them
    coach: undefined,
    memory: '记得拆开卡包的期待，也记得一起上场的他们。',
  }
}
