import { Panel } from '../common'
import { SCRIMS } from '../../data/scrims'
import type { ScrimTeam } from '../../data/scrims'

/** 群友内战: the group's own ten-person events, champion and runner-up as plain lists. */
export default function Scrims() {
  return (
    <>
      <Panel title="群友内战">
        <p className="small muted" style={{ margin: 0, lineHeight: 1.75 }}>
          群友自己办的十人内战，之后还会继续办。
        </p>
      </Panel>
      {SCRIMS.map((e) => (
        <Panel key={e.date + e.title} title={e.title} actions={<span className="tiny muted">{e.date}</span>}>
          <Team label="🏆 冠军" color="var(--warn)" team={e.champion} />
          <Team label="亚军" team={e.runnerUp} />
        </Panel>
      ))}
    </>
  )
}

function Team({ label, color, team }: { label: string; color?: string; team: ScrimTeam }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <b style={{ color }}>{label}</b>
      <div className="grid" style={{ gap: 6, marginTop: 6 }}>
        {team.players.map((p) => <Row key={p} who={p} />)}
        {team.coach && <Row who={team.coach} role="教练" />}
      </div>
    </div>
  )
}

function Row({ who, role }: { who: string; role?: string }) {
  const at = who.lastIndexOf(' #')
  const name = at < 0 ? who : who.slice(0, at)
  const tag = at < 0 ? '' : who.slice(at + 1)
  return (
    <div className="bracket-leg">
      <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
        {name} <span className="tiny faint mono">{tag}</span>
      </span>
      {role && <span className="tiny muted">{role}</span>}
    </div>
  )
}
