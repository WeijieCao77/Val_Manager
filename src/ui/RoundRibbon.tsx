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
  rounds, mineIsA, compact,
}: { rounds: RoundLog[]; mineIsA: boolean; compact?: boolean }) {
  if (!rounds.length) return null

  const w = compact ? 7 : 13
  const gap = 1
  // two lanes: mine on top, theirs below, so a run is visible as a solid block
  // on one side rather than as an alternation of two colours in one strip
  const laneH = compact ? 9 : 16
  const capH = compact ? 2 : 3
  const mid = capH + 2
  const width = rounds.length * (w + gap)
  const height = mid + laneH * 2 + (compact ? 1 : 11)

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
                  y={mid + (mineWon ? laneH / 2 : laneH + laneH / 2) + 3}
                  light
                />
              )}
            </g>
          )
        })}

        {/* half-time divider */}
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
              key={`n${i}`} x={i * (w + gap) + w / 2} y={mid + laneH * 2 + 9}
              fill="var(--faint)" fontSize={8} textAnchor="middle"
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
      return <polygon points={`${x},${y - 3} ${x + 2.6},${y + 1.5} ${x - 2.6},${y + 1.5}`} fill={c} />
    case 'defuse':
      return <rect x={x - 2.2} y={y - 2.2} width={4.4} height={4.4} fill={c} rx={0.6} />
    case 'time':
      return <rect x={x - 3} y={y - 0.7} width={6} height={1.4} fill={c} rx={0.7} />
    default: // elimination
      return <circle cx={x} cy={y} r={2} fill={c} />
  }
}

export function RibbonLegend({ mine, theirs }: { mine: string; theirs: string }) {
  return (
    <div className="row wrap tiny" style={{ gap: 12, color: 'var(--faint)' }}>
      <span className="row" style={{ gap: 5 }}>
        <i style={{ width: 9, height: 9, background: 'var(--accent)', borderRadius: 1, display: 'inline-block' }} />
        上排 {mine} · 下排 {theirs}，<b>亮起来的一侧是拿下这回合的一方</b>
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
