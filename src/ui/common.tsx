import type { ReactNode } from 'react'
import { roleColor } from '../engine/player'
import { scoutedPotential } from '../engine/manager'
import { analystEdge } from '../engine/staff'
import type { GameState, Player, Role, Trait } from '../engine/types'

export const money = (n: number): string => {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

export const moneyFull = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`

export function OvrBadge({ value }: { value: number }) {
  const cls = value >= 88 ? 'elite' : value >= 78 ? 'good' : value >= 68 ? 'ok' : ''
  return <span className={`ovr ${cls}`}>{value}</span>
}

export function RoleTag({ role }: { role: Role }) {
  return <span className="role" style={{ background: roleColor(role) }}>{role}</span>
}

/** Primary role plus any second role the player actually covers. */
export function Roles({ p }: { p: Player }) {
  const list = p.roles?.length ? p.roles : [p.role]
  return (
    <span className="row" style={{ gap: 3 }}>
      <RoleTag role={list[0]} />
      {list.slice(1).map((r) => (
        <span
          key={r}
          className="role"
          style={{ background: 'transparent', color: roleColor(r), boxShadow: `inset 0 0 0 1px ${roleColor(r)}` }}
          title={`兼任 ${r}`}
        >
          {r}
        </span>
      ))}
    </span>
  )
}

export function Bar({ value, max = 100, color }: { value: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const c = color ?? (pct >= 75 ? 'var(--win)' : pct >= 45 ? 'var(--warn)' : 'var(--loss)')
  return (
    <div className="bar">
      <i style={{ width: `${pct}%`, background: c }} />
    </div>
  )
}

/** Potential, blurred to whatever the manager's scouting can actually read. */
export function Potential({ p, game }: { p: Player; game: GameState }) {
  const s = scoutedPotential(game.manager, p.id, p.potential, analystEdge(game, 'potential'))
  return (
    <span
      className={s.exact ? 'mono' : 'mono faint'}
      title={s.exact ? '你的「眼光」足够，潜力值可以看准' : `你的「眼光」有限，只能判断在 ${s.text} 之间`}
    >
      {s.text}
    </span>
  )
}

/**
 * A club, written the way you would actually write it.
 *
 * Everything showed the legal name — "EDward Gaming", "KeepBest Gaming" — which
 * is how nobody refers to them and which wrecks dense tables. Lists use the tag
 * with the full name on hover; `full` is for the places that warrant it: match
 * headers, news, contract screens.
 */
export function Club({
  id, game, full = false,
}: { id: string | null | undefined; game: GameState; full?: boolean }) {
  const t = id ? game.teams[id] : null
  if (!t) return <span className="muted">自由人</span>
  return <span title={full ? t.tag : t.name}>{full ? t.name : t.tag}</span>
}

/** Does this query match the club by tag or by full name? */
export function clubMatches(t: { name: string; tag: string } | undefined, q: string): boolean {
  if (!t) return false
  const s = q.toLowerCase()
  return t.tag.toLowerCase().includes(s) || t.name.toLowerCase().includes(s)
}

export function Panel({
  title, children, actions, flush, className,
}: {
  title?: string; children: ReactNode; actions?: ReactNode
  flush?: boolean; className?: string
}) {
  return (
    <div className={`panel${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          <div className="spacer" />
          {actions}
        </div>
      )}
      <div className={`panel-body${flush ? ' flush' : ''}`}>{children}</div>
    </div>
  )
}

export function Stat({ k, v, small }: { k: string; v: ReactNode; small?: boolean }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className={`v${small ? ' sm' : ''}`}>{v}</span>
    </div>
  )
}

export function Modal({
  title, onClose, children, wide,
}: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal"
        style={wide ? { maxWidth: 1020 } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="sm ghost" onClick={onClose}>关闭 ✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

/** Condition read-out used in squad lists. */
export function Condition({ p, day }: { p: Player; day: number }) {
  if (p.injuredUntil > day) {
    return <span className="neg tiny">⚕ 伤停 {p.injuredUntil - day}天</span>
  }
  // fatigue accumulates as a float during weekly ticks, so round for display
  const fit = Math.round(100 - p.fatigue)
  const c = fit >= 75 ? 'var(--win)' : fit >= 50 ? 'var(--warn)' : 'var(--loss)'
  return (
    <span className="row" style={{ gap: 6 }}>
      <Bar value={fit} color={c} />
      <span className="tiny mono muted">{fit}</span>
    </span>
  )
}

export const fmtDay = (day: number): string => {
  const d = new Date(Date.UTC(2000, 0, 1))
  d.setUTCDate(d.getUTCDate() + day)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** Characteristics derived from the player's real statistics. */
export function Traits({ traits, max }: { traits?: Trait[]; max?: number }) {
  if (!traits?.length) return null
  const list = max ? traits.slice(0, max) : traits
  return (
    <span className="row wrap" style={{ gap: 4 }}>
      {list.map((t) => (
        <span
          key={t.key}
          className="trait"
          data-good={t.good ? 'y' : 'n'}
          title={t.good ? '该项处于职业选手前列' : '该项明显低于职业平均'}
        >
          {t.label}
        </span>
      ))}
    </span>
  )
}

/** Radar that can overlay several series on the same axes, for comparison. */
export function MultiRadar({
  axes, series, size = 300,
}: {
  axes: string[]
  series: { label: string; color: string; values: number[] }[]
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 44
  const n = axes.length
  const pt = (i: number, mag: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2
    return [cx + Math.cos(a) * r * mag, cy + Math.sin(a) * r * mag]
  }
  return (
    <svg width={size} height={size} role="img" aria-label="表现对比雷达图">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <polygon
          key={g} points={axes.map((_, i) => pt(i, g).join(',')).join(' ')}
          fill="none" stroke="#263344" strokeWidth={1}
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 1)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#263344" />
      })}
      {series.map((s) => (
        <polygon
          key={s.label}
          points={s.values.map((v, i) => pt(i, Math.max(0.04, Math.min(1, v / 100))).join(',')).join(' ')}
          fill={s.color} fillOpacity={0.22} stroke={s.color} strokeWidth={2}
        />
      ))}
      {series.map((s) =>
        s.values.map((v, i) => {
          const [x, y] = pt(i, Math.max(0.04, Math.min(1, v / 100)))
          return <circle key={`${s.label}-${i}`} cx={x} cy={y} r={2.6} fill={s.color} />
        }),
      )}
      {axes.map((l, i) => {
        const [x, y] = pt(i, 1.2)
        return (
          <g key={l}>
            <text x={x} y={y - 6} fill="#7d93ab" fontSize={11} fontWeight={600}
              textAnchor="middle" dominantBaseline="middle">{l}</text>
            <text x={x} y={y + 7} fontSize={10} textAnchor="middle" dominantBaseline="middle"
              fontFamily="var(--mono)" fill={series[0]?.color ?? '#55697f'}>
              {Math.round(series[0]?.values[i] ?? 0)}
              {series[1] ? (
                <tspan fill={series[1].color}> / {Math.round(series[1].values[i])}</tspan>
              ) : null}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Simple 8-axis radar for a player's attributes. */
export function Radar({ values, labels, size = 210 }: {
  values: number[]; labels: string[]; size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 26
  const n = values.length
  const pt = (i: number, mag: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2
    return [cx + Math.cos(a) * r * mag, cy + Math.sin(a) * r * mag]
  }
  const poly = values.map((v, i) => pt(i, Math.max(0.05, v / 100)).join(',')).join(' ')

  return (
    <svg width={size} height={size} role="img" aria-label="能力雷达图">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <polygon
          key={g}
          points={values.map((_, i) => pt(i, g).join(',')).join(' ')}
          fill="none" stroke="#2b3a49" strokeWidth={1}
        />
      ))}
      {values.map((_, i) => {
        const [x, y] = pt(i, 1)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#2b3a49" strokeWidth={1} />
      })}
      <polygon points={poly} fill="rgba(255,70,85,.28)" stroke="var(--accent)" strokeWidth={2} />
      {values.map((v, i) => {
        const [x, y] = pt(i, Math.max(0.05, v / 100))
        return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--accent)" />
      })}
      {labels.map((l, i) => {
        const [x, y] = pt(i, 1.2)
        return (
          <text
            key={l} x={x} y={y} fill="#8ea2b8" fontSize={10}
            textAnchor="middle" dominantBaseline="middle"
          >
            {l}
          </text>
        )
      })}
    </svg>
  )
}
