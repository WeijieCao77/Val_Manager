import type { CSSProperties, ReactNode } from 'react'
import type { Squad } from '../../engine/cards'
import { squadTeamIdentity, teamBackdrop } from '../../engine/teamIdentity'

export default function TeamBoard({ squad, children }: { squad: Squad; children?: ReactNode }) {
  const team = squadTeamIdentity(squad)
  if (!team) return <>{children}</>
  return <section className={`team-board${team.era ? ' team-board-era' : ''}`} style={{ '--team-color': team.color, backgroundImage: `url("${teamBackdrop(team.color, team.era)}")` } as CSSProperties} aria-label={`${team.name} 完整战队阵容`}>
    {team.crest && <img className="team-board-watermark" src={team.crest} alt="" aria-hidden="true" />}
    <header className="team-board-title">{team.crest && <img src={team.crest} alt={`${team.tag} 队标`} />}<div><span>{team.era ? `同期阵容 · ${team.era.label}` : '完整战队阵容 · 6/6'}</span><h3>{team.name}</h3><p>{team.era ? '五位选手同一时期并肩作战。' : '五位选手，一位教练，同一面旗帜。'}</p></div><b>{team.tag}</b></header>
    <div className="team-board-content">{children}</div>
  </section>
}
