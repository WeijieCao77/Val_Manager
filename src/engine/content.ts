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
  ace: (p: string, m: string) => `${p} 在 ${m} 打出 1v5 ACE，全场沸腾！`,
  clutch: (p: string, n: number) => `${p} 完成 1v${n} 残局处理，硬生生把这回合抢了回来。`,
  firstBlood: (p: string) => `${p} 开局直接拿下先手击杀，节奏起飞。`,
  eco: (t: string) => `${t} 用一把手枪局打崩了对面的经济，读秒阶段直接连下两分。`,
  comeback: (t: string, from: number) => `${t} 从 ${from} 分的坑里爬了出来，追分成功。`,
  thrifty: (t: string) => `${t} 残局翻盘，省下一整轮买枪钱。`,
  overtime: () => `常规回合战平，比赛进入加时。`,
}

export const INJURIES = [
  { note: '手腕劳损', days: [7, 21] },
  { note: '腱鞘炎复发', days: [10, 28] },
  { note: '颈椎不适', days: [5, 14] },
  { note: '重感冒', days: [3, 8] },
  { note: '心理疲劳 / 需要休息', days: [7, 18] },
  { note: '肩部拉伤', days: [9, 24] },
]
