/**
 * 全服杯的实际胜率 — what really happened, next to GapOdds' promise.
 *
 * Counted from every played series on vctgames.com's public 全服杯 schedule (17 cups, 2026-10-02 04:00 –
 * 10-03 12:00, after the 10-01 card re-rating), the owner's call: 「全服杯的胜率挺合理的，放到杯赛页面去」.
 * Raw pull and tables: analysis/cup_gap_winrates_2026-10-03.{json,md}. A snapshot, not live — refresh
 * the numbers by re-running that pull, never by hand-tuning them.
 *
 * Drawn at the box's real pixel width (not a scaled viewBox) so the labels stay legible on a phone.
 */
import { useEffect, useRef, useState } from 'react'
import { Panel } from '../common'

/** [higher score won, series] per gap */
const ROWS: { gap: string; bo3: [number, number]; bo5: [number, number] }[] = [
  { gap: '1', bo3: [275, 461], bo5: [104, 181] },
  { gap: '2', bo3: [283, 468], bo5: [114, 189] },
  { gap: '3', bo3: [280, 425], bo5: [137, 198] },
  { gap: '4', bo3: [246, 346], bo5: [112, 146] },
  { gap: '5', bo3: [220, 281], bo5: [113, 133] },
  { gap: '6–7', bo3: [420, 499], bo5: [154, 171] },
  { gap: '8–9', bo3: [290, 320], bo5: [131, 139] },
  { gap: '10+', bo3: [462, 474], bo5: [125, 129] },
]
const META = { cups: 17, series: 4894, even: 334, upsets: 1094, gapped: 4560, span: '10-02 至 10-03' }

const SERIES = [
  { key: 'bo3', name: 'BO3', color: 'var(--chart-a)' },
  { key: 'bo5', name: 'BO5', color: 'var(--chart-b)' },
] as const

const pct = ([w, n]: [number, number]) => (100 * w) / n
const Y0 = 50
const Y1 = 100
const TICKS = [50, 60, 70, 80, 90, 100]

export function LiveGapOdds() {
  const box = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setW(Math.round(el.clientWidth))
    fit()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit)
      return () => window.removeEventListener('resize', fit)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = 220
  const pad = { l: 38, r: 14, t: 14, b: 30 }
  const iw = Math.max(0, w - pad.l - pad.r)
  const ih = H - pad.t - pad.b
  const step = iw / ROWS.length
  const x = (i: number) => pad.l + step * (i + 0.5)
  const y = (p: number) => pad.t + ih * (1 - (p - Y0) / (Y1 - Y0))
  const path = (k: 'bo3' | 'bo5') => ROWS.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pct(r[k])).toFixed(1)}`).join('')
  const h = hover === null ? null : ROWS[hover]

  return (
    <Panel
      title="分差和实际胜率"
      actions={<span className="tiny muted">{META.span} · {META.cups} 届 · {META.series.toLocaleString()} 场</span>}
    >
      <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
        全服杯真实比赛里，阵容分高的一方赢了多少。分差越大越稳，但低分方也赢了{' '}
        <b style={{ color: 'var(--text)' }}>{Math.round((100 * META.upsets) / META.gapped)}%</b> 的比赛。
      </p>

      <div className="lgo-legend tiny">
        {SERIES.map((s) => (
          <span key={s.key}><i style={{ background: s.color }} />{s.name}</span>
        ))}
        <span className="faint">横轴：高出几分</span>
      </div>

      <div ref={box} className="lgo-plot" onMouseLeave={() => setHover(null)}>
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label="全服杯分差与高分方胜率折线图">
            {TICKS.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className={t === 50 ? 'lgo-base' : 'lgo-grid'} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="lgo-axis">{t}%</text>
              </g>
            ))}
            {hover !== null && <rect x={x(hover) - step / 2} y={pad.t} width={step} height={ih} className="lgo-hl" />}
            {ROWS.map((r, i) => (
              <text key={r.gap} x={x(i)} y={H - 10} textAnchor="middle" className={`lgo-axis${hover === i ? ' on' : ''}`}>{r.gap}</text>
            ))}
            {SERIES.map((s) => (
              <g key={s.key}>
                <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                {ROWS.map((r, i) => (
                  <circle key={i} cx={x(i)} cy={y(pct(r[s.key]))} r={hover === i ? 5.5 : 4}
                    fill={s.color} stroke="var(--panel)" strokeWidth={2} />
                ))}
              </g>
            ))}
            {/* hit targets: one column per gap, wider than the marks; a tap works on phones */}
            {ROWS.map((r, i) => (
              <rect key={r.gap} x={x(i) - step / 2} y={0} width={step} height={H} fill="transparent"
                onMouseEnter={() => setHover(i)} onClick={() => setHover(hover === i ? null : i)} />
            ))}
          </svg>
        )}
        {h && hover !== null && (
          <div className="lgo-tip tiny" style={{
            left: Math.min(Math.max(x(hover), 80), w - 80),
            // above the higher point, or under the lower one when there is no room above
            top: y(Math.max(pct(h.bo3), pct(h.bo5))) - 86 >= 0
              ? y(Math.max(pct(h.bo3), pct(h.bo5))) - 86
              : y(Math.min(pct(h.bo3), pct(h.bo5))) + 14,
          }}>
            <b>高出 {h.gap} 分</b>
            {SERIES.map((s) => (
              <div key={s.key}>
                <i style={{ background: s.color }} />{s.name}{' '}
                <b>{pct(h[s.key]).toFixed(1)}%</b>
                <span className="faint"> · {h[s.key][1]} 场</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="sm ghost" style={{ marginTop: 6 }} onClick={() => setTable((v) => !v)}>
        {table ? '收起数据' : '看数据'}
      </button>
      {table && (
        <div className="table-wrap" style={{ marginTop: 6 }}>
          <table>
            <thead><tr><th>高出</th><th>BO3 胜率</th><th>场数</th><th>BO5 胜率</th><th>场数</th></tr></thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.gap}>
                  <td>{r.gap} 分</td>
                  <td>{pct(r.bo3).toFixed(1)}%</td><td className="muted">{r.bo3[1]}</td>
                  <td>{pct(r.bo5).toFixed(1)}%</td><td className="muted">{r.bo5[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny faint" style={{ margin: '8px 0 0' }}>
        同分的 {META.even} 场不计。点图上的分差看具体数字。
      </p>
    </Panel>
  )
}
