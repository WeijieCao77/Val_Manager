import { useState } from 'react'
import type { CardFaceProps } from '../Card'
import { RARITY_CN } from '../../engine/cards'
import type { PlayerCard } from '../../engine/cards'
import { SEOUL_META } from '../../engine/seoul2024'
import './seoul2024.css'

export const SEOUL_MARK = '/events/seoul-2024/champions.png'
export function SeoulMark({ className = '' }: { className?: string }) {
  return <img className={`seoul-mark ${className}`} src={SEOUL_MARK} alt="VALORANT Champions" />
}
export function SeoulCard({ card, level = 0, dupes = 0, size = 'md', selected, dimmed, onClick, footer }: CardFaceProps & { card: PlayerCard }) {
  const [failed, setFailed] = useState(false)
  const entry = card.seoul!
  return <div className={`cardface sc24 s-${size} sc24-${card.rarity}${selected ? ' sel' : ''}${dimmed ? ' dim' : ''}${onClick ? ' tap' : ''}`}
    onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}
    title={`${card.ign} · ${card.clubTag} · 首尔 2024 · 游戏能力 ${Math.min(99, card.rating + level)}`}>
    <div className="sc24-rays" aria-hidden="true" />
    <div className="sc24-head"><span>CHAMPIONS<br /><b>SEOUL 2024</b></span><SeoulMark /></div>
    <span className="sc24-side">{card.clubTag} / {entry.nat.toUpperCase()} / {RARITY_CN[card.rarity]}</span>
    <div className="sc24-portrait">{card.face && !failed ? <img src={card.face} alt={card.ign} loading="lazy" onError={() => setFailed(true)} /> : <span>{card.ign.slice(0, 2)}</span>}</div>
    <div className="sc24-rating"><b>{Math.min(99, card.rating + level)}</b><small>{card.role.slice(0, 2)}{level > 0 ? ` +${level}` : ''}</small></div>
    <div className="sc24-info"><span className="sc24-team">{card.clubTag}<i>{card.clubTag === 'EDG' ? 'WORLD CHAMPION' : 'SEOUL CONTENDER'}</i></span>
      <strong className="sc24-ign">{card.ign}</strong>
      <div className="sc24-stats"><span><b>{entry.acs}</b>ACS</span><span><b>{entry.kd.toFixed(2)}</b>K/D</span><span><b>{entry.maps}</b>MAPS</span></div>
      <div className="sc24-foot"><span>{footer ?? '01—25 AUG · 2024'}</span><b>{String(entry.number).padStart(3, '0')} / 080</b></div>
    </div>
    {dupes > 0 && <span className="sc24-dupes">×{dupes + 1}</span>}
  </div>
}
export function SeoulCardBack() {
  return <div className="cardback sc24-back">
    <div className="sc24-rays" aria-hidden="true" /><span className="sc24-back-top">VALORANT CHAMPIONS TOUR</span>
    <span className="sc24-orbit" aria-hidden="true" /><SeoulMark />
    <div className="sc24-back-title">CHAMPIONS<strong>SEOUL</strong><span>2024</span></div>
    <div className="sc24-back-bottom">首尔全球冠军赛<small>01—25 AUGUST · KOREA</small></div>
  </div>
}
export function SeoulPackArtwork() {
  return <div className="sc24-pack-art" aria-label="首尔 2024 黑金超新星卡包">
    <div className="sc24-pack-seal" /><span className="sc24-pack-edition">CHAMPIONS TOUR / 2024</span>
    <div className="sc24-rays" aria-hidden="true" /><SeoulMark />
    <div className="sc24-pack-title">CHAMPIONS<strong>SEOUL</strong><span>首尔全球冠军赛</span></div>
    <div className="sc24-pack-bottom"><span>SUPERNOVA<br /><b>赛事选手收藏卡</b></span><strong>3<small>CARDS</small></strong></div>
    <div className="sc24-pack-seal bottom" />
  </div>
}
export function SeoulSources() {
  return <details className="sc24-sources"><summary>赛事资料与设计说明</summary><p>收录本届实际登场的 80 位选手，编号固定为 001–080。队名、英雄和 ACS / K/D / 地图数采用当届记录。卡面大号能力值为游戏数值，由本届数据换算，后面的轮次权重更高，指挥和先锋位另有加分。头像为 Riot Games 在首尔冠军赛 Features Day 拍摄的照片。</p><p><a href={SEOUL_META.eventSource} target="_blank" rel="noreferrer">Riot 官方赛事介绍与视觉</a> · <a href={SEOUL_META.rosterSource} target="_blank" rel="noreferrer">VLR 当届登场名单与数据</a> · <a href="/events/seoul-2024/qualified-teams.jpg" target="_blank" rel="noreferrer">官方参赛队海报</a> · <a href="https://www.flickr.com/photos/valorantesports/" target="_blank" rel="noreferrer">Riot Games 赛事相册（头像）</a></p><p>首尔纪念系列为本项目的收藏卡设计，赛事标识及选手资料来自对应权利方。</p></details>
}
