import { useState, type CSSProperties } from 'react'
import type { PlayerCard } from '../../engine/cards'
import { ATTR_CN } from '../../engine/types'
import type { CardFaceProps } from '../Card'
import './afterglow.css'
import './afterglowMythic.css'

/**
 * 余晖: the retired series' faces, on the 480×672 (5:7) canvas the 曼谷 cards
 * use. The design is the one previewed on /cards/retired/stats (Codex's
 * Afterglow), cut down to what the game's cards carry: no coach variant —
 * non-active coach cards are not part of this release (owner, 2026-10-10).
 */
const ART = `${import.meta.env.BASE_URL}events/afterglow/ember-art.webp`
const METAL = { gold: '金卡', silver: '银卡', bronze: '铜卡' } as const
const FACE_ATTRS = ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork'] as const

function Mark({ className = '' }: { className?: string }) {
  return <img className={`ag-mark ${className}`} src={ART} alt="" aria-hidden="true" />
}

function Normal({ card, label }: { card: PlayerCard; label: string }) {
  const [failed, setFailed] = useState<string>()
  const finish = card.rarity === 'gold' || card.rarity === 'silver' ? card.rarity : 'bronze'
  const g = card.afterglow!
  const photo = card.face && failed !== card.face ? card.face : null
  return <article className={`ag-card ag-${finish}`} aria-label={`${card.ign} 余晖${METAL[finish]} ${card.rating}`}>
    <div className="ag-frame" aria-hidden="true" />
    <header className="ag-card-head"><span>AFTERGLOW<small>余晖 · 生涯典藏</small></span><Mark /></header>
    <div className="ag-portrait-halo" aria-hidden="true" />
    <div className="ag-portrait">{photo ? <img src={photo} alt={card.ign} onError={() => setFailed(photo)} /> : <div className="ag-placeholder"><span>◇</span><small>选手肖像</small></div>}</div>
    <div className="ag-rating"><b>{card.rating}</b><span>{label}</span></div>
    <span className="ag-card-side">THE LIGHT STAYS WITH US</span>
    <div className="ag-nameplate">
      <div className="ag-player-meta"><span>{card.clubTag}</span><span>{g.span}</span></div>
      <strong>{card.ign}</strong><div className="ag-card-rule" />
      <footer><span>生涯珍藏 <i>{METAL[finish]}</i></span><b>{g.number}</b></footer>
    </div>
  </article>
}

function Mythic({ card, label }: { card: PlayerCard; label: string }) {
  const [failed, setFailed] = useState(false)
  const g = card.afterglow!
  return <article className="ag-mythic" style={{ '--mythic-accent': g.accent, '--mythic-tint': g.tint } as CSSProperties} aria-label={`${card.ign} 余晖彩卡 ${card.rating}`}>
    <div className="ag-mythic-border" aria-hidden="true" /><div className="ag-mythic-orbit" aria-hidden="true" />
    <header className="ag-mythic-header"><span>AFTERGLOW<small>余晖 · 退役生涯彩卡</small></span><Mark /></header>
    <span className="ag-mythic-year">{card.legend?.year}</span>
    <div className="ag-mythic-portrait">{card.face && !failed ? <img src={card.face} alt={card.ign} style={{ objectPosition: g.crop }} onError={() => setFailed(true)} /> : <span>{card.ign}</span>}</div>
    <div className="ag-mythic-rating"><b>{card.rating}</b><span>{label}</span><i>已退役</i></div>
    <span className="ag-mythic-side">{g.result} / {card.clubTag}</span>
    <div className="ag-mythic-info">
      <div className="ag-mythic-theme"><span>{g.city}</span><b>{card.clubTag}</b></div>
      <strong className="ag-mythic-ign">{card.ign}</strong>
      <p className="ag-mythic-event">{card.legend?.title}</p>
      <div className="ag-mythic-stats">{FACE_ATTRS.map((k) => <span key={k}><b>{card.attrs[k]}</b><small>{ATTR_CN[k]}</small></span>)}</div>
      <footer><span>生涯珍藏 / 彩卡</span><span>{g.number}</span></footer>
    </div>
  </article>
}

/** A retired card in the game: the face plus what every card face does (select, dim, tap, spares). */
export function RetiredFace({ card, level = 0, evolved = false, dupes = 0, selected, dimmed, onClick, footer }: CardFaceProps & { card: PlayerCard; evolved?: boolean }) {
  const label = `${card.role}${card.isIgl ? ' · 指挥' : ''}${level > 0 ? ` +${level}` : ''}${evolved ? ' 进修' : ''}`
  return <div className={`ag-face${selected ? ' sel' : ''}${dimmed ? ' dim' : ''}${onClick ? ' tap' : ''}`}
    onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={(ev) => { if (onClick && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onClick() } }}
    title={`${card.ign} · ${card.clubTag} · 退役 · 游戏能力 ${card.rating}${level > 0 ? `（+${level}）` : ''}`}>
    {card.rarity === 'mythic' ? <Mythic card={card} label={label} /> : <Normal card={card} label={label} />}
    {footer && <span className="ag-footer">{footer}</span>}
    {dupes > 0 && <span className="ag-dupes">×{dupes + 1}</span>}
  </div>
}

export function RetiredCardBack() {
  return <article className="ag-card ag-back" aria-label="余晖系列卡背">
    <div className="ag-frame" aria-hidden="true" /><header>生 涯 典 藏</header><Mark />
    <div className="ag-back-title"><span>AFTERGLOW</span><strong>余晖</strong><i>离场之后，光仍在。</i></div>
    <footer>开瓦包 <span>退役选手系列</span></footer>
  </article>
}

/** The 退役选手包 when the 3D pouch cannot draw (the renderer's fallback): Codex's Afterglow pack, this release's words. */
export function RetiredPackArtwork({ count = 3 }: { count?: number }) {
  return <article className="ag-pack" aria-label="退役选手包">
    <div className="ag-pack-seal" /><div className="ag-pack-seal ag-bottom" /><div className="ag-pack-fold" aria-hidden="true" />
    <header>开瓦包 <span>生涯典藏</span></header>
    <div className="ag-pack-title"><strong>AFTERGLOW</strong><span>余 晖</span></div><Mark />
    <div className="ag-pack-foot"><p>离场之后，光仍在。</p><div><span>退役选手收藏卡</span><b>{count}<small> 张 / 包</small></b></div></div>
  </article>
}
