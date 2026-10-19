import { useState } from 'react'
import type { CardFaceProps } from '../Card'
import type { PlayerCard } from '../../engine/cards'
import { LOS_ANGELES_META, LOS_ANGELES_TOTAL, losAngelesFace } from '../../engine/losangeles2023'
import { natCountry } from '../../engine/nat'
import './losAngeles2023.css'

export type LosAngelesRarity = 'gold' | 'silver' | 'bronze'
export interface LosAngelesPlayer {
  ign: string
  team: string
  nation: string
  number: string
  photo?: string
  rating?: number
  acs?: number
  kd?: number
  maps?: number
  /** under the number: the card's role and level (as the 曼谷 face shows them); 总评 when absent */
  label?: string
  /** trained past +5 (进修): a small arrow after the label */
  evolved?: boolean
  /** the team's caller: an IGL tag after the team */
  igl?: boolean
  /** how the photo sits on the art: 'soft' (the player over his frame softened into the sunset) or 'raw' (the frame as shot, the first version's window) */
  photoStyle?: string
}
const tiers = { gold: '金卡', silver: '银卡', bronze: '铜卡' }

export function LosAngelesEmblem() { return <img className="la-emblem" src="/events/los-angeles-2023/horizon-mark-v3.svg" alt="" aria-hidden="true" /> }
function Perspective() {
  return <svg className="la-perspective" viewBox="0 0 400 560" preserveAspectRatio="none" aria-hidden="true"><g>{[[0, 0], [120, 0], [280, 0], [400, 0], [400, 170], [400, 440], [400, 560], [240, 560], [80, 560], [0, 560], [0, 410], [0, 140]].map(([x, y], i) => <path key={i} d={`M${x} ${y} 266 289`} />)}<path d="M55 60H345V485H55ZM126 147H318V407H126ZM187 218H291V345H187" /></g></svg>
}
function Scene() { return <><div className="la-sunset" /><Perspective /></> }

/** Codex's 洛杉矶 2023 face (逐日 / ONE MORE): the artwork, the photo and the type are separate layers. */
export function LosAngelesCard({ player, rarity = 'gold', blank = false, footer }: { player: LosAngelesPlayer; rarity?: LosAngelesRarity; blank?: boolean; footer?: string }) {
  const [failed, setFailed] = useState<string>()
  const showPhoto = !blank && player.photo && failed !== player.photo
  return <article className={`la-card la-front la-${rarity}`} aria-label={`${player.ign} 洛杉矶 2023 ${tiers[rarity]}`}>
    <Scene /><div className="la-year" aria-hidden="true">23</div>
    <header className="la-front-header"><span>CHAMPIONS<br /><b>LOS ANGELES</b></span><LosAngelesEmblem /></header>
    <div className={`la-photo la-photo-${player.photoStyle ?? 'raw'}`}>{showPhoto ? <img src={player.photo} alt={player.ign} onError={() => setFailed(player.photo)} /> : <div className="la-placeholder">PLAYER PORTRAIT<span>选手照片预留</span></div>}</div>
    <span className="la-vertical">ONE MORE / 再进一步</span>
    <div className="la-front-shade" />
    <div className="la-rating"><b>{player.rating ?? '—'}</b><span>{player.label ?? '总评'}{player.evolved && <i className="evo-mark" title="进修过">↑</i>}</span></div>
    <div className="la-player">
      <div className="la-team"><b>{player.team}{player.igl && <em className="la-igl" title="指挥">IGL</em>}</b><span>{player.nation} / 2023</span></div>
      <h2>{player.ign}</h2>
      <div className="la-stats"><span>ACS <b>{player.acs ?? '—'}</b></span><span>K/D <b>{player.kd?.toFixed(2) ?? '—'}</b></span><span>MAPS <b>{player.maps ?? '—'}</b></span></div>
      <footer><span>{footer ?? '06—26 AUG / LOS ANGELES'}</span><span>{player.number}</span></footer>
    </div>
  </article>
}

const pad = (n: number) => String(n).padStart(3, '0')

/**
 * The game's card face for a 洛杉矶 2023 card: Codex's design with the card's own
 * numbers, the level beside the role, and the states every face has — selected,
 * dimmed, tappable, a spare count.
 */
export function LosAngelesFace({ card, level = 0, evolved = false, dupes = 0, selected, dimmed, onClick, footer }: CardFaceProps & { card: PlayerCard; evolved?: boolean }) {
  const e = card.losAngeles!
  const player: LosAngelesPlayer = {
    ign: card.ign, team: card.clubTag ?? '', // 中国台湾 / 中国香港 / 中国澳门 read CN, as the flags do (nat.ts FLAG_AS)
    nation: (natCountry(card.nat) ?? '').toUpperCase(), number: `${pad(e.number)} / ${pad(LOS_ANGELES_TOTAL)}`,
    photo: card.face ?? undefined, rating: card.rating, acs: e.acs, kd: e.kd, maps: e.maps,
    label: `${card.role.slice(0, 2)}${level > 0 ? ` +${level}` : ''}`, evolved, igl: card.isIgl,
    photoStyle: (losAngelesFace(e.vlrId) as { style?: string } | undefined)?.style,
  }
  return <div className={`la-face${selected ? ' sel' : ''}${dimmed ? ' dim' : ''}${onClick ? ' tap' : ''}`}
    onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
    onKeyDown={ev => { if (onClick && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onClick() } }}
    title={`${card.ign} · ${card.clubTag} · 洛杉矶 2023 · 游戏能力 ${card.rating}${level > 0 ? `（+${level}）` : ''}`}>
    <LosAngelesCard player={player} rarity={card.rarity === 'gold' || card.rarity === 'silver' ? card.rarity : 'bronze'} footer={footer} />
    {dupes > 0 && <span className="la-dupes">×{dupes + 1}</span>}
  </div>
}

export function LosAngelesSources() {
  return <details className="la-sources"><summary>赛事资料与设计说明</summary><p>收录本届实际登场的 {LOS_ANGELES_TOTAL} 位选手，编号固定为 001–{pad(LOS_ANGELES_TOTAL)}，队名按当届（DRX、Giants）。英雄和 ACS / K/D / 地图数采用当届记录。卡面大号能力值为游戏数值，和首尔、曼谷系列同一套换算：后面的轮次权重更高，指挥和先锋位另有加分，赛事 MVP Demon1 另加 5。头像为 Riot Games 在洛杉矶冠军赛 Features Day 拍摄的照片（T1 没有参加 Features Day，用的是 8 月 5 日小组赛场馆的照片）。</p><p><a href={LOS_ANGELES_META.eventSource} target="_blank" rel="noreferrer">Riot 官方赛事介绍</a> · <a href={LOS_ANGELES_META.rosterSource} target="_blank" rel="noreferrer">VLR 当届登场名单与数据</a> · <a href="https://www.flickr.com/photos/valorantesports/" target="_blank" rel="noreferrer">Riot Games 赛事相册（头像）</a></p><p>ONE MORE 为当届官方主题；「逐日」、落日光弧标记和洛杉矶落日底图为本项目的收藏卡设计，赛事标识及选手资料来自对应权利方。</p></details>
}

export function LosAngelesBack() {
  return <article className="la-card la-back" aria-label="洛杉矶冠军赛统一卡背"><Scene /><header><span>CHAMPIONS / 2023</span><LosAngelesEmblem /></header><div className="la-back-type"><span>ONE</span><span>MORE<span className="la-period">.</span></span></div><div className="la-back-location">LOS<br />ANGELES<span>34°03′ N / 118°15′ W</span></div><div className="la-back-bottom"><b>逐日 · 洛杉矶</b><span>06—26 AUGUST 2023</span><small>WORLD CHAMPIONSHIP / COLLECTOR SERIES</small></div></article>
}

export function LosAngelesPack() {
  return <article className="la-pack" aria-label="洛杉矶冠军赛逐日卡包"><Scene /><div className="la-seal" /><div className="la-seal la-seal-bottom" /><header><LosAngelesEmblem /><span>WORLD<br />CHAMPIONSHIP</span><b>2023</b></header><div className="la-pack-title"><span>CHAMPIONS</span><h2>LOS<br /><i>ANGELES</i></h2></div><div className="la-pack-campaign">ONE MORE ↗</div><div className="la-pack-bottom"><div><span>SUNSET EDITION / 逐日</span><strong>洛杉矶全球冠军赛</strong></div><b>3<small>CARDS</small></b></div><div className="la-pack-sheen" /></article>
}
