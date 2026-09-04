import { Rng, hashStr } from './rng'
import type { GameState } from './types'

/**
 * Where the internationals are played.
 *
 * Three of these a year, drawn from the cities the circuit has actually
 * visited, none twice in a season and none the same as the year before —
 * 「每个大师赛可以加一个随机不重复的」举办地. Pure in seed and year, so the
 * poster can name the city before the event exists and the event agrees
 * with it when it does.
 */
const HOST_CITIES = [
  '雷克雅未克', '柏林', '哥本哈根', '东京', '马德里', '上海', '曼谷', '多伦多', '圣地亚哥', '伦敦',
  '伊斯坦布尔', '洛杉矶', '首尔', '巴黎', '圣保罗', '新加坡', '悉尼', '吉隆坡', '雅加达', '墨西哥城',
  '迪拜', '华沙', '慕尼黑', '里约热内卢',
]
type EventKey = 'masters1' | 'masters2' | 'champions'

export function hostCities(seed: number, year: number): Record<EventKey, string> {
  let prev: string[] = []
  let cur: string[] = []
  for (let y = 2026; y <= year; y++) {
    const rng = new Rng(hashStr(`host:${seed}:${y}`))
    const pool = HOST_CITIES.filter((c) => !prev.includes(c))
    cur = []
    for (let i = 0; i < 3; i++) {
      const left = pool.filter((c) => !cur.includes(c))
      cur.push(left[rng.int(0, left.length - 1)])
    }
    prev = cur
  }
  return { masters1: cur[0], masters2: cur[1], champions: cur[2] }
}

export const hostCity = (state: GameState, key: EventKey): string => hostCities(state.seed, state.year)[key]

