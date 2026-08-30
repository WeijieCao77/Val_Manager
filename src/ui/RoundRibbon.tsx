import type { RoundLog } from '../engine/types'

/**
 * The round-by-round strip, drawn the way vlr.gg draws one.
 *
 * Two lanes — my club on top, theirs below. Every round is one column; the
 * winner's cell fills in the colour of the side they took it on (attack warm,
 * defence cool) and carries the icon of how it ended — skull for killing
 * everyone, the spike for a detonation, cutters for a defuse, a clock for
 * time. The loser's cell stays dark. Read across and you get the shape of the
 * map — the half switch, a pistol swing, the run that decided it — which a
 * 13-7 scoreline alone never shows.
 */
export default function RoundRibbon({
  rounds, mineIsA, compact, mineTag, theirTag,
}: {
  rounds: RoundLog[]; mineIsA: boolean; compact?: boolean
  /** short club names, drawn against their own lane */
  mineTag?: string; theirTag?: string
}) {
  if (!rounds.length) return null

  const w = compact ? 8 : 20
  const gap = compact ? 1 : 2
  // two lanes: mine on top, theirs below, so a run is visible as a solid block
  // on one side rather than as an alternation of two colours in one strip
  const laneH = compact ? 10 : 24
  const labelW = compact || !mineTag ? 0 : 54
  const width = rounds.length * (w + gap) + labelW
  const height = laneH * 2 + (compact ? 1 : 15)

  const IDLE = '#1b2836'

  // where the sides switch: after round 12, then every OT round pair
  const halfAt = rounds.findIndex((r) => r.n === 13)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width={width} height={height} role="img"
        aria-label={`回合走势：共 ${rounds.length} 回合`}
        style={{ display: 'block' }}
      >
        {rounds.map((r, i) => {
          const mineWon = (r.winner === 'A') === mineIsA
          const x = i * (w + gap)
          // the side the WINNER was playing colours the cell, as vlr does
          const winnerAttacked = r.winner === 'A' ? r.aAttack : !r.aAttack
          const c = winnerAttacked ? 'var(--warn)' : '#5fa8d3'
          const winY = mineWon ? 0 : laneH
          return (
            <g key={i}>
              {/* my lane */}
              <rect
                x={x} y={0} width={w} height={laneH - 1}
                fill={mineWon ? c : IDLE} rx={compact ? 1 : 2}
              />
              {/* their lane */}
              <rect
                x={x} y={laneH} width={w} height={laneH - 1}
                fill={mineWon ? IDLE : c} rx={compact ? 1 : 2}
              />
              {!compact && (
                <EndMark end={r.end} x={x + w / 2} y={winY + (laneH - 1) / 2} />
              )}
            </g>
          )
        })}

        {labelW > 0 && (
          <g fontFamily="var(--mono)" fontSize={13} fontWeight={700}>
            <text
              x={rounds.length * (w + gap) + 7} y={laneH / 2 + 5}
              fill="var(--accent)"
            >
              {mineTag}
            </text>
            <text
              x={rounds.length * (w + gap) + 7} y={laneH + laneH / 2 + 5}
              fill="var(--accent)"
            >
              {theirTag}
            </text>
          </g>
        )}

        {/* half-time divider */}
        {halfAt > 0 && (
          <line
            x1={halfAt * (w + gap) - gap / 2} y1={0}
            x2={halfAt * (w + gap) - gap / 2} y2={laneH * 2}
            stroke="var(--text)" strokeWidth={1} opacity={0.55}
          />
        )}

        {!compact && rounds.map((r, i) =>
          r.n % 4 === 0 ? (
            <text
              key={`n${i}`} x={i * (w + gap) + w / 2} y={laneH * 2 + 12}
              fill="var(--faint)" fontSize={10} textAnchor="middle"
              fontFamily="var(--mono)"
            >
              {r.n}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  )
}

/**
 * How the round ended, drawn at (x, y) in white on the winner's cell.
 *
 * The same four marks vlr prints: skull, spike, cutters, clock. Primitive
 * shapes rather than traced artwork — at 20×24 a cell only has room for a
 * silhouette anyway.
 */
function EndMark({ end, x, y }: { end: RoundLog['end']; x: number; y: number }) {
  const c = 'rgba(255,255,255,.92)'
  switch (end) {
    case 'spike': // detonation: the spike — a slim urn with prongs on top
      return (
        <g stroke={c} strokeWidth={1.2} strokeLinecap="round">
          <path
            d={`M ${x - 3},${y - 1.5} Q ${x},${y - 4} ${x + 3},${y - 1.5} L ${x + 2.2},${y + 4} L ${x - 2.2},${y + 4} Z`}
            fill={c} stroke="none"
          />
          <line x1={x - 2.6} y1={y - 3.4} x2={x - 1.6} y2={y - 1.8} />
          <line x1={x} y1={y - 4.4} x2={x} y2={y - 2.4} />
          <line x1={x + 2.6} y1={y - 3.4} x2={x + 1.6} y2={y - 1.8} />
        </g>
      )
    case 'defuse': // cutters: crossed handles, open jaw
      return (
        <g stroke={c} strokeWidth={1.5} strokeLinecap="round">
          <line x1={x - 3} y1={y + 4} x2={x + 2.4} y2={y - 3.2} />
          <line x1={x + 3} y1={y + 4} x2={x - 2.4} y2={y - 3.2} />
          <circle cx={x} cy={y + 0.8} r={1.3} fill={c} stroke="none" />
        </g>
      )
    case 'time': // the clock ran out
      return (
        <g stroke={c} strokeWidth={1.2} fill="none" strokeLinecap="round">
          <circle cx={x} cy={y} r={4} />
          <path d={`M ${x},${y - 2.2} L ${x},${y} L ${x + 1.8},${y + 1}`} />
        </g>
      )
    default: // elimination: skull
      return (
        <g fill={c}>
          <circle cx={x} cy={y - 0.8} r={3.6} />
          <rect x={x - 2.1} y={y + 1.4} width={4.2} height={2.6} rx={0.7} />
          <circle cx={x - 1.5} cy={y - 1.2} r={1.05} fill="#20303f" />
          <circle cx={x + 1.5} cy={y - 1.2} r={1.05} fill="#20303f" />
          <rect x={x - 0.5} y={y + 0.6} width={1} height={1.4} fill="#20303f" rx={0.4} />
        </g>
      )
  }
}

const sample = (end: RoundLog['end'], attack: boolean) => (
  <svg width={16} height={16} style={{ display: 'block' }}>
    <rect
      x={0} y={0} width={16} height={16} rx={2}
      fill={attack ? 'var(--warn)' : '#5fa8d3'}
    />
    <EndMark end={end} x={8} y={8} />
  </svg>
)

export function RibbonLegend() {
  return (
    <div className="row wrap tiny" style={{ gap: 12, color: 'var(--faint)', alignItems: 'center' }}>
      <span className="row" style={{ gap: 5, alignItems: 'center' }}>
        <i style={{ width: 12, height: 12, background: 'var(--warn)', borderRadius: 2, display: 'inline-block' }} />
        进攻方拿下
      </span>
      <span className="row" style={{ gap: 5, alignItems: 'center' }}>
        <i style={{ width: 12, height: 12, background: '#5fa8d3', borderRadius: 2, display: 'inline-block' }} />
        防守方拿下
      </span>
      <span className="row" style={{ gap: 5, alignItems: 'center' }}>{sample('elim', true)} 团灭</span>
      <span className="row" style={{ gap: 5, alignItems: 'center' }}>{sample('spike', true)} 引爆</span>
      <span className="row" style={{ gap: 5, alignItems: 'center' }}>{sample('defuse', false)} 拆包</span>
      <span className="row" style={{ gap: 5, alignItems: 'center' }}>{sample('time', false)} 时间</span>
    </div>
  )
}
