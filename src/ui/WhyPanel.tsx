import type { EdgeBreakdown, MapScore } from '../engine/types'

/**
 * Why the map went the way it did.
 *
 * Losing without knowing why is the worst thing a manager game can do to you —
 * you cannot tell whether to drill the map, fix the dressing room, or stop
 * setting the pace slider to 90. These are the exact numbers the engine used
 * to decide the result, differenced against the opponent, largest gap first,
 * with the ones you can actually act on named.
 */

/**
 * `fix` may depend on our own value, because the same row can mean two very
 * different things. The IGL row read "首发里没有 IGL 罚分很重" whether or not
 * you had one — telling a manager whose caller was on the field to go and find
 * a caller. The engine writes exactly -4 there when the five contains nobody
 * with the armband, so the two cases are distinguishable.
 */
const FACTORS: {
  key: keyof EdgeBreakdown
  label: string
  fix: string | ((mine: number) => string)
}[] = [
  { key: 'base', label: '选手个人能力', fix: '这是阵容硬实力，只能靠转会和训练慢慢补' },
  { key: 'map', label: '地图熟练度', fix: '在训练里安排「跑图」练这张图，或在 BP 时避开它' },
  { key: 'chem', label: '团队默契', fix: '更衣室关系与协同/沟通属性，双排练和集训能改善' },
  {
    key: 'comp',
    label: '阵容位置搭配',
    // "look for the missing role" was the wrong advice whenever nothing was
    // missing: a squad of versatile players used to be charged for it, so the
    // panel pointed at a role list that showed no gap at all
    fix: (v) => (v < 0
      ? '首发没覆盖齐决斗者/先锋/控场/哨卫，缺哪个看阵容页的位置统计'
      : '四个位置已覆盖齐；第五人是谁都不扣分，能兼位还会小幅加分'),
  },
  {
    key: 'igl',
    label: '指挥（IGL）',
    fix: (v) => (v <= -3.9
      ? '首发里没有指挥，攻防两端各扣 4 分——把队里的 IGL 放进首发'
      : '让指挥属性更高的人来指挥，或用「教练复盘」练 IGL 的指挥'),
  },
  { key: 'coach', label: '教练与战术素养', fix: '换个战术更好的主教练，或点满「战术」天赋' },
  { key: 'utility', label: '道具运用', fix: '战术里的「道具」滑杆，以及选手的道具属性' },
  { key: 'tacticsAtk', label: '战术设置（进攻端）', fix: '赛前的节奏与侵略性滑杆' },
  { key: 'tacticsDef', label: '战术设置（防守端）', fix: '节奏与侵略性调高会削弱防守' },
]

export default function WhyPanel({ map, mineIsA }: { map: MapScore; mineIsA: boolean }) {
  if (!map.edge) {
    return (
      <div className="empty">这场比赛是在此功能上线前打的，没有记录当时的强弱分解。</div>
    )
  }
  const mine = mineIsA ? map.edge.a : map.edge.b
  const foe = mineIsA ? map.edge.b : map.edge.a

  const rows = FACTORS
    .map((f) => ({
      ...f,
      diff: (mine[f.key] as number) - (foe[f.key] as number),
      fix: typeof f.fix === 'function' ? f.fix(mine[f.key] as number) : f.fix,
    }))
    .filter((r) => Math.abs(r.diff) >= 0.15)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))

  const total = (mine.atk + mine.def) / 2 - (foe.atk + foe.def) / 2
  const worst = rows.filter((r) => r.diff < 0).slice(0, 2)

  return (
    <div>
      <div className="row wrap" style={{ gap: 10, alignItems: 'baseline', marginBottom: 10 }}>
        <b>综合实力差</b>
        <span className="mono" style={{
          fontSize: 18,
          color: total >= 0 ? 'var(--win)' : 'var(--accent)',
        }}>
          {total >= 0 ? '+' : ''}{total.toFixed(1)}
        </span>
        <span className="small muted">
          {Math.abs(total) < 1.5 ? '两队几乎势均力敌，这张图的胜负主要靠临场发挥和运气'
            : total >= 0 ? '账面上我们更强——输了说明临场没打出来' : '账面上确实处于下风'}
        </span>
      </div>

      {worst.length > 0 && (
        <p className="small" style={{ marginTop: 0 }}>
          最吃亏的是 <b style={{ color: 'var(--accent)' }}>{worst.map((w) => w.label).join(' 和 ')}</b>
          。{worst[0].fix}。
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>因素</th>
              <th className="num">我方</th>
              <th className="num">对手</th>
              <th className="num">差值</th>
              <th>怎么调整</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><b>{r.label}</b></td>
                <td className="num mono">{(mine[r.key] as number).toFixed(1)}</td>
                <td className="num mono muted">{(foe[r.key] as number).toFixed(1)}</td>
                <td className="num mono" style={{
                  color: r.diff >= 0 ? 'var(--win)' : 'var(--accent)', fontWeight: 600,
                }}>
                  {r.diff >= 0 ? '+' : ''}{r.diff.toFixed(1)}
                </td>
                <td className="tiny faint">{r.diff < 0 ? r.fix : '这一项我们占优'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny faint" style={{ marginBottom: 0 }}>
        这些就是模拟器判定胜负时用的数值本身，不是事后编的解释。数值只决定每回合的胜率，
        不直接决定结果——账面占优照样可能输，那通常意味着状态、体能或运气的问题。
      </p>
    </div>
  )
}
