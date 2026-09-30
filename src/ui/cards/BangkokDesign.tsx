import { useState } from 'react'
import type { CardFaceProps } from '../Card'
import type { PlayerCard } from '../../engine/cards'
import { BANGKOK_META, BANGKOK_TOTAL } from '../../engine/bangkok2025'
import './bangkok2025.css'

export type BangkokRarity = 'gold' | 'silver' | 'bronze'
export interface BangkokPlayer {
  ign: string
  team: string
  nation: string
  number: string
  photo?: string
  photoPosition?: string
  photoOffsetX?: number
  rating?: number
  acs?: number
  kd?: number
  maps?: number
  /** under the number: the card's role in the game (the 首尔 face shows it there too); 总评 when absent */
  label?: string
}
const tiers = { gold: '金卡', silver: '银卡', bronze: '铜卡' }

/** Event artwork and photo are separate layers; no image-generated text or player likenesses. */
export function BangkokCard({ player, rarity = 'gold', blank = false, footer }: { player: BangkokPlayer; rarity?: BangkokRarity; blank?: boolean; footer?: string }) {
  const [failedPhoto, setFailedPhoto] = useState<string>()
  const showPhoto = !blank && player.photo && failedPhoto !== player.photo
  return <article className={`bk25-card bk25-${rarity}`} aria-label={`${player.ign} 曼谷 2025 ${tiers[rarity]}${blank ? '照片留空模板' : ''}`}>
    <div className="bk25-front-ground" aria-hidden="true" />
    <div className="bk25-inner" aria-hidden="true" />
    <header className="bk25-card-header"><div>MASTERS<strong>BANGKOK <i>25</i></strong></div><span className="bk25-edition">{tiers[rarity]}<br />赛事系列</span></header>
    <div className={`bk25-photo ${showPhoto ? '' : 'is-empty'}`}>
      {showPhoto ? <img src={player.photo} alt={player.ign} style={{ objectPosition: player.photoPosition ?? '50% 30%', transform: player.photoOffsetX ? `translateX(${player.photoOffsetX}%)` : undefined }} onError={() => setFailedPhoto(player.photo)} /> : <div className="bk25-photo-guide"><svg viewBox="0 0 100 120" aria-hidden="true"><circle cx="50" cy="36" r="19" /><path d="M12 115V96a38 38 0 0 1 76 0v19" /></svg><span>选手照片预留</span><small>独立照片层 · 支持替换</small></div>}
    </div>
    <div className="bk25-portrait-atmosphere" aria-hidden="true" />
    <div className="bk25-corner-lotus" aria-hidden="true" />
    <div className="bk25-rating"><strong>{player.rating ?? '—'}</strong><span>{player.label ?? '总评'}</span></div>
    <span className="bk25-side">DAWN OF THE DUELIST</span>
    <div className="bk25-player-info"><div className="bk25-team"><b>{player.team}</b><span>{player.nation} / 2025</span></div><strong className="bk25-ign">{player.ign}</strong>
      <div className="bk25-stats"><span><b>{player.acs ?? '—'}</b>ACS</span><span><b>{player.kd?.toFixed(2) ?? '—'}</b>K/D</span><span><b>{player.maps ?? '—'}</b>MAPS</span></div>
      <footer><span>{footer ?? '20 FEB — 02 MAR'}</span><b>{player.number}</b></footer>
    </div>
  </article>
}

const pad = (n: number) => String(n).padStart(3, '0')

/**
 * The game's card face for a 曼谷 2025 card: Codex's design with the card's
 * own numbers, the level beside the role (as the 首尔 face shows it), and the
 * states every face has — selected, dimmed, tappable, a spare count.
 */
export function BangkokFace({ card, level = 0, dupes = 0, selected, dimmed, onClick, footer }: CardFaceProps & { card: PlayerCard }) {
  const e = card.bangkok!
  const player: BangkokPlayer = {
    ign: card.ign, team: card.clubTag ?? '', nation: (card.nat ?? '').toUpperCase(), number: `${pad(e.number)} / ${pad(BANGKOK_TOTAL)}`,
    photo: card.face ?? undefined, photoPosition: '50% 30%', rating: card.rating, acs: e.acs, kd: e.kd, maps: e.maps,
    label: `${card.role.slice(0, 2)}${level > 0 ? ` +${level}` : ''}`,
  }
  return <div className={`bk25-face${selected ? ' sel' : ''}${dimmed ? ' dim' : ''}${onClick ? ' tap' : ''}`}
    onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={ev => { if (onClick && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onClick() } }}
    title={`${card.ign} · ${card.clubTag} · 曼谷 2025 · 游戏能力 ${card.rating}${level > 0 ? `（+${level}）` : ''}`}>
    <BangkokCard player={player} rarity={card.rarity === 'gold' || card.rarity === 'silver' ? card.rarity : 'bronze'} footer={footer} />
    {dupes > 0 && <span className="bk25-dupes">×{dupes + 1}</span>}
  </div>
}

export function BangkokSources() {
  return <details className="bk25-sources"><summary>赛事资料与设计说明</summary><p>收录本届实际登场的 {BANGKOK_TOTAL} 位选手，编号固定为 001–{pad(BANGKOK_TOTAL)}，队名按当届（DRX）。英雄和 ACS / K/D / 地图数采用当届记录。卡面大号能力值为游戏数值，和首尔系列同一套换算：后面的轮次权重更高，指挥和先锋位另有加分，出场很少的替补酌情减分。头像为 Riot Games 在曼谷大师赛 Features Day 拍摄的照片。</p><p><a href={BANGKOK_META.eventSource} target="_blank" rel="noreferrer">Riot 官方赛事介绍</a> · <a href={BANGKOK_META.rosterSource} target="_blank" rel="noreferrer">VLR 当届登场名单与数据</a> · <a href="https://www.flickr.com/photos/valorantesports/" target="_blank" rel="noreferrer">Riot Games 赛事相册（头像）</a></p><p>曼谷纪念系列为本项目的收藏卡设计，赛事标识及选手资料来自对应权利方。</p></details>
}

export function BangkokCardBack() {
  return <article className="bk25-card bk25-back" aria-label="曼谷大师赛 2025 统一卡背">
    <div className="bk25-art" aria-hidden="true" /><div className="bk25-inner" aria-hidden="true" />
    <header>VALORANT CHAMPIONS TOUR<span>2025</span></header>
    <div className="bk25-back-title"><small>MASTERS</small><strong>BANGKOK</strong></div>
    <div className="bk25-back-bottom"><b>DAWN OF<br />THE DUELIST</b><span>曼谷大师赛 · 2025</span><small>20 FEB — 02 MAR · THAILAND</small></div>
  </article>
}

export function BangkokPackArtwork() {
  return <article className="bk25-pack" aria-label="曼谷大师赛 2025 虹彩莲花卡包">
    <div className="bk25-art" aria-hidden="true" /><div className="bk25-pack-fold" aria-hidden="true" />
    <div className="bk25-seal" aria-hidden="true" /><div className="bk25-seal bottom" aria-hidden="true" />
    <header><span>VALORANT CHAMPIONS TOUR</span><b>2025</b></header>
    <div className="bk25-pack-title"><span>MASTERS</span><strong>BANGKOK</strong><small>曼谷大师赛</small></div>
    <div className="bk25-pack-bottom"><strong>DAWN OF<br />THE DUELIST</strong><div><span>赛事选手收藏卡</span><b>3 <small>CARDS</small></b></div></div>
  </article>
}
