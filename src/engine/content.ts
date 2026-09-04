import type { Role } from './types'

/**
 * Every map VALORANT has shipped to competitive, taken from vlr.gg's own map
 * filter. `activePool()` deals seven of these per season and rotates one or
 * two at the Stage 1 and Stage 2 boundaries, as Riot does.
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

/**
 * Official Chinese map names.
 *
 * The English name stays the key everywhere — it is what `mapPrefs` is stored
 * under in every existing save, what vlr.gg calls them, and what the broadcast
 * says — so this is a display layer, not a rename. `mapCn` is what screens
 * print.
 */
export const MAP_CN: Record<string, string> = {
  Ascent: '亚海悬城', Bind: '源工重镇', Breeze: '微风岛屿', Corrode: '盐海矿镇',
  Fracture: '裂变峡谷', Haven: '隐世修所', Icebox: '森寒冬港', Lotus: '莲华古城',
  Pearl: '深海明珠', Split: '霓虹町', Summit: '天枢云阙', Sunset: '日落之城',
  Abyss: '幽邃地窟',
}

/** A map as the manager reads it: Chinese, falling back to whatever we were given. */
export const mapCn = (m: string): string => MAP_CN[m] ?? m

/**
 * Official Chinese agent names, from the same translator as MAP_CN.
 *
 * Fetched by scripts/fetch_valorant_assets.ts from valorant-api.com's zh-CN
 * data — the script cross-checks the thirteen map names against MAP_CN before
 * trusting these, so 钛狐 really is what the national server calls Tejo. The
 * English name stays the key everywhere, exactly as with maps.
 */
export const AGENT_CN: Record<string, string> = {
  Astra: '星礈', Breach: '铁臂', Brimstone: '炼狱', Chamber: '尚勃勒',
  Clove: '暮蝶', Cypher: '零', Deadlock: '钢锁', Fade: '黑梦',
  Gekko: '盖可', Harbor: '海神', Iso: '壹决', Jett: '捷风',
  'KAY/O': 'K/O', Killjoy: '奇乐', Neon: '霓虹', Omen: '幽影',
  Phoenix: '不死鸟', Raze: '雷兹', Reyna: '芮娜', Sage: '贤者',
  Skye: '斯凯', Sova: '猎枭', Tejo: '钛狐', Viper: '蝰蛇',
  Vyse: '维斯', Waylay: '幻棱', Yoru: '夜露',
}

/**
 * The agent's canonical name from whatever spelling the data carried.
 *
 * vlr.gg files a player's agents as slugs — 'cypher', 'kayo' — and every
 * player with real data reached the game that way. The icon files, the
 * Chinese names and the composition tables are all keyed by the proper name,
 * so on a case-sensitive server the icons were broken, the names came out in
 * English, and the match engine found no player who had ever played anything.
 * Null for something that is not an agent at all ('veto' was a column).
 */
const AGENT_BY_KEY = new Map(Object.keys(AGENT_CN).map((a) => [a.toLowerCase().replace(/[^a-z]/g, ''), a]))
export const canonAgent = (a: string): string | null =>
  AGENT_BY_KEY.get(String(a).toLowerCase().replace(/[^a-z]/g, '')) ?? null
/** A pool cleaned the same way: canonical, deduplicated, junk dropped. */
export const canonAgents = (list: readonly string[]): string[] => {
  const out: string[] = []
  for (const a of list) {
    const c = canonAgent(a)
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

/** An agent as the manager reads it. */
export const agentCn = (a: string): string => AGENT_CN[a] ?? AGENT_CN[canonAgent(a) ?? ''] ?? a

/**
 * Which job an agent is actually picked for.
 *
 * Derived from AGENTS rather than written twice, and 自由人 is skipped on
 * purpose — that key is a grab-bag of agents other roles already own, not a
 * fifth role an agent can belong to.
 */
export const AGENT_ROLE: Record<string, Role> = Object.fromEntries(
  (Object.entries(AGENTS) as [Role, string[]][])
    .filter(([role]) => role !== '自由人')
    .flatMap(([role, list]) => list.map((a) => [a, role] as const)),
) as Record<string, Role>

/**
 * What each map is usually played with, best-known first.
 *
 * A composition table, not a roster: these are agents, so nothing here has to
 * be a real person. Ordered by how routinely the agent shows up on that map in
 * professional play, and used two ways — to fill a lineup automatically with
 * something sensible, and to tell the manager when a hand-made pick is
 * unusual for the map.
 */
export const MAP_META: Record<string, string[]> = {
  Ascent: ['Jett', 'KAY/O', 'Omen', 'Killjoy', 'Sova', 'Gekko', 'Cypher', 'Iso'],
  Bind: ['Raze', 'Skye', 'Brimstone', 'Cypher', 'Gekko', 'Viper', 'Fade', 'Yoru'],
  Breeze: ['Jett', 'Sova', 'Viper', 'Cypher', 'Gekko', 'Harbor', 'Chamber', 'Fade'],
  Corrode: ['Raze', 'Tejo', 'Omen', 'Killjoy', 'Sova', 'Clove', 'Vyse', 'Neon'],
  Fracture: ['Neon', 'Breach', 'Brimstone', 'Killjoy', 'Fade', 'Viper', 'Vyse', 'Raze'],
  Haven: ['Jett', 'Breach', 'Omen', 'Killjoy', 'Sova', 'Astra', 'Cypher', 'Fade'],
  Icebox: ['Jett', 'Sova', 'Viper', 'Killjoy', 'Harbor', 'Gekko', 'Sage', 'Raze'],
  Lotus: ['Raze', 'Fade', 'Omen', 'Killjoy', 'Skye', 'Viper', 'Cypher', 'Neon'],
  Pearl: ['Neon', 'Fade', 'Astra', 'Killjoy', 'Sova', 'Harbor', 'Cypher', 'Jett'],
  Split: ['Raze', 'Skye', 'Omen', 'Cypher', 'Breach', 'Astra', 'Sage', 'Jett'],
  Summit: ['Jett', 'Sova', 'Omen', 'Cypher', 'Tejo', 'Clove', 'Killjoy', 'Raze'],
  Sunset: ['Raze', 'Breach', 'Omen', 'Cypher', 'Skye', 'Clove', 'Sage', 'Jett'],
  Abyss: ['Neon', 'Tejo', 'Clove', 'Vyse', 'Sova', 'Omen', 'Killjoy', 'Waylay'],
}

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
