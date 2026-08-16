import type { RoundLog } from '../engine/types'

/**
 * The round-by-round ribbon from a VCT broadcast scoreboard.
 *
 * Every round is one cell. The fill says who took it, the cap on top says which
 * side they were playing, and the mark underneath says how it ended. Read across
 * and you get the shape of the map — the half switch, a pistol swing, the run
 * that decided it — which a 13-7 scoreline alone never shows.
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
  const capH = compact ? 2 : 4
  const mid = capH + 3
  const labelW = compact || !mineTag ? 0 : 54
  const width = rounds.length * (w + gap) + labelW
  const height = mid + laneH * 2 + (compact ? 1 : 14)

  const MINE = 'var(--accent)'
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
          // which side *my* team played this round
          const iAttacked = mineIsA ? r.aAttack : !r.aAttack
          return (
            <g key={i}>
              {/* side cap: attack is warm, defence is cool — my side's view */}
              <rect
                x={x} y={0} width={w} height={capH}
                fill={iAttacked ? 'var(--warn)' : '#5fa8d3'} rx={0.5}
              />
              {/* my lane */}
              <rect
                x={x} y={mid} width={w} height={laneH - 1}
                fill={mineWon ? MINE : IDLE} rx={1}
              />
              {/* their lane */}
              <rect
                x={x} y={mid + laneH} width={w} height={laneH - 1}
                fill={mineWon ? IDLE : MINE} rx={1}
              />
              {!compact && (
                <EndMark
                  end={r.end}
                  x={x + w / 2}
                  y={mid + (mineWon ? laneH / 2 : laneH + laneH / 2) + 4}
                  light
                />
              )}
            </g>
          )
        })}

        {/* half-time divider */}
        {labelW > 0 && (
          <g fontFamily="var(--mono)" fontSize={13} fontWeight={700}>
            <text
              x={rounds.length * (w + gap) + 7} y={mid + laneH / 2 + 5}
              fill="var(--accent)"
            >
              {mineTag}
            </text>
            <text
              x={rounds.length * (w + gap) + 7} y={mid + laneH + laneH / 2 + 5}
              fill="var(--accent)"
            >
              {theirTag}
            </text>
          </g>
        )}

        {halfAt > 0 && (
          <line
            x1={halfAt * (w + gap) - gap / 2} y1={0}
            x2={halfAt * (w + gap) - gap / 2} y2={mid + laneH * 2}
            stroke="var(--text)" strokeWidth={1} opacity={0.55}
          />
        )}

        {!compact && rounds.map((r, i) =>
          r.n % 4 === 0 ? (
            <text
              key={`n${i}`} x={i * (w + gap) + w / 2} y={mid + laneH * 2 + 12}
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

function EndMark({ end, x, y, light }: { end: RoundLog['end']; x: number; y: number; light: boolean }) {
  const c = light ? 'rgba(255,255,255,.85)' : 'rgba(236,232,225,.5)'
  switch (end) {
    case 'spike': // detonation
      return <polygon points={`${x},${y - 4.2} ${x + 3.6},${y + 2.1} ${x - 3.6},${y + 2.1}`} fill={c} />
    case 'defuse':
      return <rect x={x - 3} y={y - 3} width={6} height={6} fill={c} rx={0.8} />
    case 'time':
      return <rect x={x - 4.2} y={y - 1} width={8.4} height={2} fill={c} rx={1} />
    default: // elimination
      return <circle cx={x} cy={y} r={2.8} fill={c} />
  }
}

export function RibbonLegend() {
  return (
    <div className="row wrap tiny" style={{ gap: 12, color: 'var(--faint)' }}>
      <span className="row" style={{ gap: 5 }}>
        <i style={{ width: 10, height: 10, background: 'var(--accent)', borderRadius: 1, display: 'inline-block' }} />
        <b>亮起来的一侧拿下该回合</b>
      </span>
      <span className="row" style={{ gap: 5 }}>
        <i style={{ width: 9, height: 3, background: 'var(--warn)', display: 'inline-block' }} />
        进攻
      </span>
      <span className="row" style={{ gap: 5 }}>
        <i style={{ width: 9, height: 3, background: '#5fa8d3', display: 'inline-block' }} />
        防守
      </span>
      <span>● 团灭</span>
      <span>▲ 引爆</span>
      <span>■ 拆包</span>
      <span>▬ 时间</span>
    </div>
  )
}
