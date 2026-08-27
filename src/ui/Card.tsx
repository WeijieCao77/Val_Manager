import { useState } from 'react'
import { ATTR_CN } from '../engine/types'
import { RARITY_CN, ratingAt } from '../engine/cards'
import type { Card, PlayerCard, CoachCard } from '../engine/cards'
import { isCoachCard, isPlayerCard } from '../engine/cards'

/** Country name for the tooltip; the flag itself is the emoji below. */
const NAT_CN: Record<string, string> = {
  cn: '中国', kr: '韩国', us: '美国', tr: '土耳其', br: '巴西', ru: '俄罗斯',
  tw: '中国台湾', pl: '波兰', cl: '智利', ca: '加拿大', ph: '菲律宾', jp: '日本',
  ar: '阿根廷', gb: '英国', fr: '法国', es: '西班牙', de: '德国', se: '瑞典',
  dk: '丹麦', fi: '芬兰', no: '挪威', nl: '荷兰', be: '比利时', pt: '葡萄牙',
  it: '意大利', ua: '乌克兰', lv: '拉脱维亚', lt: '立陶宛', ee: '爱沙尼亚',
  cz: '捷克', sk: '斯洛伐克', hu: '匈牙利', ro: '罗马尼亚', bg: '保加利亚',
  rs: '塞尔维亚', hr: '克罗地亚', gr: '希腊', il: '以色列', sa: '沙特',
  ae: '阿联酋', eg: '埃及', ma: '摩洛哥', za: '南非', au: '澳大利亚',
  nz: '新西兰', id: '印度尼西亚', my: '马来西亚', sg: '新加坡', th: '泰国',
  vn: '越南', in: '印度', mn: '蒙古', kh: '柬埔寨', hk: '中国香港', mo: '中国澳门',
  mx: '墨西哥', co: '哥伦比亚', pe: '秘鲁', uy: '乌拉圭', ve: '委内瑞拉',
  ch: '瑞士', at: '奥地利', ie: '爱尔兰', is: '冰岛', by: '白俄罗斯', kz: '哈萨克斯坦',
}

/**
 * Whether this browser draws flag emoji at all.
 *
 * Windows Chrome does not — it renders a regional-indicator pair as two letter
 * boxes, so a card that leans on the emoji shows a grey rectangle where the
 * nationality should be, and a large part of this game's audience is on
 * Windows. Measured once: a supported flag is drawn as one glyph and is
 * narrower than the two letters side by side.
 */
const flagsRender = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d')
    if (!c) return false
    c.font = '32px sans-serif'
    const pair = c.measureText('\u{1F1E8}\u{1F1F3}').width
    const single = c.measureText('\u{1F1E8}').width
    return pair < single * 1.9
  } catch { return false }
})()

/**
 * The nationality mark: a real flag where the platform has one, the country
 * code where it does not. Never a blank box — a card with an empty flag slot
 * looks broken, and the code is a perfectly good answer.
 */
export function flagEmoji(nat: string | null | undefined): string {
  if (!nat || nat.length !== 2) return '🏴'
  const up = nat.toUpperCase()
  if (!flagsRender) return up
  const base = 0x1f1e6
  const a = up.charCodeAt(0) - 65
  const b = up.charCodeAt(1) - 65
  if (a < 0 || a > 25 || b < 0 || b > 25) return up
  return String.fromCodePoint(base + a, base + b)
}

export const natName = (nat: string | null | undefined): string =>
  (nat && NAT_CN[nat]) || (nat ? nat.toUpperCase() : '国籍未知')

/** The flag on a card. A code renders as a chip so it does not read as a typo. */
export function Flag({ nat }: { nat: string | null | undefined }) {
  return (
    <span className={flagsRender ? 'cf-flag' : 'cf-flag code'} title={natName(nat)}>
      {flagEmoji(nat)}
    </span>
  )
}

/**
 * The stand-in when there is no photograph.
 *
 * vlr.gg has no picture for 119 of the 518 — mostly tier-two and mostly
 * Chinese and Pacific rosters. Initials were tried first and read as a
 * placeholder for a name rather than a placeholder for a person; a plain bust
 * is what every card game does and what the eye skips over. Drawn rather than
 * loaded so it costs nothing and inherits the card's own colour.
 */
function Silhouette() {
  return (
    <svg className="cf-sil" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="23" r="11.5" />
      <path d="M32 37c-11 0-19.5 6.6-21.6 16.4A2 2 0 0 0 12.4 56h39.2a2 2 0 0 0 2-2.6C51.5 43.6 43 37 32 37Z" />
    </svg>
  )
}

/** The photograph, with the silhouette behind it for the ones vlr has none of. */
function Face({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      <img
        className="cf-photo"
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    )
  }
  return <div className="cf-photo cf-noface"><Silhouette /></div>
}

const hashOf = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface CardFaceProps {
  card: Card
  /** 0-5 — drawn as pips and folded into the rating */
  level?: number
  /** spare copies held, shown as a corner badge on the collection grid */
  dupes?: number
  size?: 'sm' | 'md' | 'lg'
  selected?: boolean
  dimmed?: boolean
  onClick?: () => void
  /** shown across the bottom instead of the attribute grid */
  footer?: string
}

/**
 * One card, front side.
 *
 * The metal is a real gradient rather than a flat colour because the whole
 * emotional payload of the mode is "what came out of the pack" — a gold has to
 * look like a gold at a glance, across a grid, on a phone.
 */
export default function CardFace({
  card, level = 0, dupes = 0, size = 'md', selected, dimmed, onClick, footer,
}: CardFaceProps) {
  const rating = ratingAt(card.rating, level)
  const cls = `cardface r-${card.rarity} s-${size}`
    + (selected ? ' sel' : '') + (dimmed ? ' dim' : '') + (onClick ? ' tap' : '')
  const legend = isPlayerCard(card) ? card.legend : undefined
  const title = legend
    ? `${legend.title} · ${card.kind === 'player' ? card.ign : ''} · 彩卡 ${rating}`
    : `${card.kind === 'player' ? card.ign : card.name} · ${RARITY_CN[card.rarity]} ${rating}`
      + (level ? `（+${level}）` : '')

  const body = isPlayerCard(card)
    ? <PlayerBody card={card} size={size} footer={footer} />
    : <CoachBody card={card as CoachCard} size={size} footer={footer} />

  // A grid of彩卡 all animating in step reads as "a row of red cards", not as
  // iridescence. Each one starts somewhere else in the cycle, keyed off its own
  // id so it is the same every time you open the page.
  const holo = card.rarity === 'mythic'
    ? { animationDelay: `-${(hashOf(card.id) % 90) / 10}s` }
    : undefined

  return (
    <div
      className={cls}
      style={holo}
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
    >
      {legend && <span className="cf-star" aria-hidden="true">★</span>}
      <div className="cf-rate">
        <b>{rating}</b>
        {level > 0 && <i className="cf-plus">+{level}</i>}
        <span className="cf-kind">
          {isPlayerCard(card) ? card.role.slice(0, 2) : card.spec ? '分析' : '教练'}
        </span>
      </div>
      {dupes > 0 && <div className="cf-dupes" title={`重复 ${dupes} 张`}>×{dupes + 1}</div>}
      {body}
      {level > 0 && (
        <div className="cf-pips">
          {Array.from({ length: level }, (_, i) => <i key={i} />)}
        </div>
      )}
    </div>
  )
}

function PlayerBody({ card, size, footer }: { card: PlayerCard; size: string; footer?: string }) {
  const keys = size === 'sm'
    ? (['aim', 'awareness'] as const)
    : (['aim', 'reaction', 'awareness', 'utility', 'clutch', 'igl'] as const)
  return (
    <>
      <Face src={card.face} alt={card.ign} />
      {card.legend && <div className="cf-moment">{card.legend.short}</div>}
      <div className="cf-name">{card.ign}</div>
      {size === 'lg' && card.realName && <div className="cf-real">{card.realName}</div>}
      <div className="cf-meta">
        <Flag nat={card.nat} />
        <span className="cf-club">{card.clubTag ?? '自由人'}</span>
        {card.isIgl && <span className="cf-igl" title="指挥">IGL</span>}
      </div>
      {footer ? <div className="cf-foot">{footer}</div> : (
        <div className="cf-attrs">
          {keys.map((k) => (
            <span key={k}><i>{ATTR_CN[k].slice(0, 2)}</i><b>{card.attrs[k]}</b></span>
          ))}
        </div>
      )}
    </>
  )
}

function CoachBody({ card, size, footer }: { card: CoachCard; size: string; footer?: string }) {
  return (
    <>
      <Face src={card.face} alt={card.name} />
      <div className="cf-name">{card.name}</div>
      {size === 'lg' && card.realName && <div className="cf-real">{card.realName}</div>}
      <div className="cf-meta">
        <Flag nat={card.nat} />
        <span className="cf-club">{card.clubTag ?? '自由身'}</span>
        {card.spec && <span className="cf-igl" title="分析师">分析</span>}
      </div>
      {footer ? <div className="cf-foot">{footer}</div> : (
        <div className="cf-attrs">
          <span><i>战术</i><b>{card.tactics}</b></span>
          <span><i>培养</i><b>{card.development}</b></span>
          <span><i>激励</i><b>{card.motivation}</b></span>
        </div>
      )}
    </>
  )
}

/**
 * The back of a card, for the moment before it turns over.
 *
 * Deliberately says nothing about what is on the other side — no metal, no
 * rating, no colour that could give a gold away early. The whole value of the
 * flip is that you cannot tell yet.
 */
export function CardBack() {
  return (
    <div className="cardback">
      <div className="cb-mark">VAL</div>
      <div className="cb-sub">CARDS</div>
    </div>
  )
}

/** An empty seat in the squad builder. */
export function CardSlot({
  label, onClick, hint,
}: { label: string; onClick?: () => void; hint?: string }) {
  return (
    <div className="cardface slot s-md tap" onClick={onClick} title={hint ?? `选一名${label}`}>
      <div className="cf-slot-plus">＋</div>
      <div className="cf-slot-label">{label}</div>
    </div>
  )
}

export const cardIsCoach = isCoachCard
