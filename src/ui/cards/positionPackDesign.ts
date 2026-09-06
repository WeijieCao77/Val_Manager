import type { CSSProperties } from 'react'
import type { Role } from '../../engine/types'

/** The reward's position is explicit: a player may play more than one role. */
export type PackPosition = Extract<Role, '决斗者' | '控场' | '先锋' | '哨卫'>
export const PACK_POSITIONS: PackPosition[] = ['决斗者', '控场', '先锋', '哨卫']

// Vector silhouettes matching the supplied reference (controller, duelist,
// initiator, sentinel). Shared by SVG card backs and the pouch's printed map.
export const POSITION_PACKS = {
  决斗者: {
    label: '决斗', english: 'DUELIST', band: '#a63834', ink: '#773530',
    light: '#edb6a2', backTop: '#713c36', backBottom: '#341c20',
    tagline: '突破防线，打开局面', footer: '为第一场交锋而来',
    paths: [
      'M30 17.5A52 52 0 0 1 90 17.5L60 47Z',
      'M17.5 30A52 52 0 0 0 17.5 90L47 60Z',
      'M102.5 30A52 52 0 0 1 102.5 90L73 60Z',
      'M30 102.5A52 52 0 0 0 90 102.5L60 73Z',
    ],
  },
  控场: {
    label: '控场', english: 'CONTROLLER', band: '#444f89', ink: '#3e456e',
    light: '#bcc7ed', backTop: '#414c73', backBottom: '#1c233e',
    tagline: '掌握视野，主导战局', footer: '让战场按你的节奏展开',
    paths: [
      'M8 62A52 52 0 0 1 112 62L60 20Z',
      'M13 81L60 41L107 81Q103 90 96 96L60 66L24 96Q17 90 13 81Z',
      'M39 107L60 90L81 107A52 52 0 0 1 39 107Z',
    ],
  },
  先锋: {
    label: '先锋', english: 'INITIATOR', band: '#9b6a2e', ink: '#795526',
    light: '#e9cd94', backTop: '#6a522f', backBottom: '#31291e',
    tagline: '探明前路，为队友开道', footer: '每一次进攻，都有你的铺垫',
    paths: [
      'M42 11L66 50H24L61 112A52 52 0 0 1 42 11Z',
      'M61 8A52 52 0 0 1 79 109L55 68H96Z',
    ],
  },
  哨卫: {
    label: '哨位', english: 'SENTINEL', band: '#276e71', ink: '#2b595d',
    light: '#a8d7cf', backTop: '#315f61', backBottom: '#173237',
    tagline: '守住阵地，稳住胜局', footer: '你在，防线就在',
    paths: [
      'M22 25A52 52 0 0 1 98 25Z',
      'M35 43H85L60 86Z',
      'M12 38L53 112A52 52 0 0 1 12 38Z',
      'M108 38A52 52 0 0 1 67 112Z',
    ],
  },
} as const

export function positionPackStyle(position?: PackPosition): CSSProperties | undefined {
  if (!position) return undefined
  const d = POSITION_PACKS[position]
  return { '--position-band': d.band, '--position-ink': d.ink,
    '--position-light': d.light, '--position-back-top': d.backTop,
    '--position-back-bottom': d.backBottom } as CSSProperties
}
