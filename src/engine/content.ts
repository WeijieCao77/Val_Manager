import type { Role } from './types'

/**
 * Every map VALORANT has shipped to competitive, taken from vlr.gg's own map
 * filter. `activePool()` rotates seven of these per season, as Riot does.
 */
export const MAPS = [
  'Ascent', 'Bind', 'Breeze', 'Corrode', 'Fracture', 'Haven', 'Icebox',
  'Lotus', 'Pearl', 'Split', 'Summit', 'Sunset', 'Abyss',
] as const
export type GameMap = (typeof MAPS)[number]

/** Agents grouped by their in-game role, matching vlr.gg's agent filter. */
export const AGENTS: Record<Role, string[]> = {
  决斗者: ['Jett', 'Raze', 'Phoenix', 'Reyna', 'Yoru', 'Neon', 'Iso', 'Waylay'],
  先锋: ['Sova', 'Breach', 'Skye', 'KAY/O', 'Fade', 'Gekko', 'Tejo'],
  控场: ['Brimstone', 'Viper', 'Omen', 'Astra', 'Harbor', 'Clove'],
  哨卫: ['Sage', 'Cypher', 'Killjoy', 'Chamber', 'Deadlock', 'Vyse'],
  自由人: ['Sova', 'KAY/O', 'Omen', 'Sage', 'Breach', 'Viper', 'Skye', 'Cypher'],
}

export const ALL_AGENTS = Array.from(new Set(Object.values(AGENTS).flat())).sort()

export const SPONSOR_NAMES = [
  'Hyperion Energy', 'Nexon Peripherals', 'Vertex Bank', 'Kaido Motors', 'BitStream',
  'Solaris Airlines', 'RedShift Gaming', 'Momentum Apparel', 'Auralink Audio', 'ZenCore PC',
  'Northgate Telecom', 'PulseWear', 'Fortis Insurance', 'Skyline Beverages',
]

/** Flavour lines used by the round narrator. */
export const HIGHLIGHT_TEMPLATES = {
  ace: (p: string, m: string) => `${p} 在 ${m} 单人五杀，全场沸腾！`,
  quad: (p: string) => `${p} 一回合带走四个，对面直接崩了。`,
  clutch: (p: string, n: number) =>
    n >= 3 ? `${p} 上演 1v${n} 残局，硬生生把这回合抢了回来。`
      : `${p} 最后一人守住 1v${n}，稳稳收下这回合。`,
  firstBlood: (p: string, n: number) => `${p} 连续 ${n} 个回合拿下首杀，突破端完全被他打开。`,
  eco: (t: string) => `${t} 手枪局打崩对面经济，读秒阶段连下两分。`,
  antiEco: (t: string, o: string) => `${t} 一把强起打穿了 ${o} 的满配，经济瞬间反转。`,
  flawless: (t: string) => `${t} 零封拿下这回合，五人零阵亡。`,
  streak: (t: string, n: number) => `${t} 连下 ${n} 回合，把比分彻底拉开。`,
  comeback: (t: string, from: number) => `${t} 从 ${from} 分的坑里爬了出来，追分成功。`,
  mapPoint: (t: string) => `${t} 在赛点上被救了回来，比赛还没结束。`,
  overtime: () => `常规回合战平，比赛进入加时。`,
}

export const INJURIES = [
  { note: '手腕劳损', days: [5, 14] },
  { note: '腱鞘炎复发', days: [7, 18] },
  { note: '颈椎不适', days: [4, 10] },
  { note: '重感冒', days: [2, 6] },
  { note: '心理疲劳 / 需要休息', days: [5, 12] },
  { note: '肩部拉伤', days: [6, 16] },
]
