import type { EdgeBreakdown, MapScore, Role } from '../engine/types'
import { useGame } from './ctx'

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
  // comp's advice is filled in from the lineup that actually played — see
  // compFix below. Reading it off the number was how the panel came to tell
  // XLG to find a missing role when all four were covered.
  { key: 'comp', label: '阵容位置搭配', fix: '' },
  {
    key: 'igl',
    label: '指挥（IGL）',
    fix: (v) => (v <= -3.9
      ? '首发里没有指挥，攻防两端各扣 4 分——把队里的 IGL 放进首发'
      : '让指挥属性更高的人来指挥，或用「教练复盘」练 IGL 的指挥'),
  },
  {
    key: 'shortHanded',
    label: '人数不足',
    fix: '首发凑不齐五人，每缺一人都是压倒性的劣势——先把阵容补到五人',
  },
  { key: 'coach', label: '教练与战术素养', fix: '换个战术更好的主教练，或点满「战术」天赋' },
  { key: 'utility', label: '道具运用', fix: '战术里的「道具」滑杆，以及选手的道具属性；双控场阵容从这一项拿得最多' },
  { key: 'tacticsAtk', label: '战术设置（进攻端）', fix: '这张图的节奏与侵略性滑杆——双决斗阵容往右拉才吃得到' },
  { key: 'tacticsDef', label: '战术设置（防守端）', fix: '节奏与侵略性调高会削弱防守；双哨卫阵容往左拉才厚' },
  { key: 'style', label: '阵容风格', fix: '双决斗偏攻、双哨卫偏守、双控场两头都吃——在预案里换一套五个英雄' },
  { key: 'matchup', label: '针对对手', fix: '对双哨卫放慢节奏、对双决斗别把侵略性拉满、对双控场道具拉高——赛前预案里能看到对手的阵容' },
  { key: 'familiarity', label: '阵容熟练度', fix: '同一套五个英雄多打几场、跑图时练它；临时换阵容会从零开始' },
]

const CORE_ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']

export default function WhyPanel({ map, mineIsA }: { map: MapScore; mineIsA: boolean }) {
  const { game } = useGame()
  if (!map.edge) {
    return (
      <div className="empty">这场比赛是在此功能上线前打的，没有记录当时的强弱分解。</div>
    )
  }
  const mine = mineIsA ? map.edge.a : map.edge.b
  const foe = mineIsA ? map.edge.b : map.edge.a

  // Which roles the five that played actually covered, rather than guessing
  // from the score: matches played before the composition rule was fixed still
  // carry a negative number that no missing role explains.
  const played = Object.keys(map.lines ?? {})
    .map((id) => game.players[id])
    .filter((p) => p && p.teamId === game.myTeam)
  const covered = new Set(played.flatMap((p) => p.roles ?? [p.role]))
  const gaps = played.length ? CORE_ROLES.filter((r) => !covered.has(r)) : []
  const compFix = gaps.length
    ? `首发缺 ${gaps.join('、')}——把能打这些位置的人放进首发`
    : '四个位置已覆盖齐，这一项没有可补的；第五人是谁都不扣分，能兼位还会小幅加分'

  // the newer rows are absent on maps played before they existed; absent is
  // zero, not a hole in the table
  const at = (side: EdgeBreakdown, k: keyof EdgeBreakdown): number => (side[k] as number | undefined) ?? 0
  const rows = FACTORS
    .map((f) => ({
      ...f,
      diff: at(mine, f.key) - at(foe, f.key),
      fix: f.key === 'comp' ? compFix
        : typeof f.fix === 'function' ? f.fix(at(mine, f.key)) : f.fix,
    }))
    .filter((r) => Math.abs(r.diff) >= 0.15)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))

  const total = (mine.atk + mine.def) / 2 - (foe.atk + foe.def) / 2
  const worst = rows.filter((r) => r.diff < 0).slice(0, 2)

  // The summary line assumed a defeat — it read "输了说明临场没打出来" over a
  // map we had just won 13-11. Paper strength and the actual result are two
  // different facts, and the interesting cases are the ones where they
  // disagree, so say which happened before explaining it.
  const myScore = mineIsA ? map.scoreA : map.scoreB
  const foeScore = mineIsA ? map.scoreB : map.scoreA
  const won = myScore > foeScore
  const verdict = Math.abs(total) < 1.5
    ? (won
      ? '两队几乎势均力敌，这张图能拿下靠的是临场发挥'
      : '两队几乎势均力敌，这张图的胜负主要靠临场发挥和运气')
    : total >= 0
      ? (won
        ? '账面上我们更强，这张图也照着实力拿下了'
        : '账面上我们更强——这张图却输了，说明临场没打出来')
      : (won
        ? '账面上处于下风，这张图是硬啃下来的'
        : '账面上确实处于下风')

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
        <span className="small muted">{verdict}</span>
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
              <th className="sticky-name at-left">因素</th>
              <th className="num">我方</th>
              <th className="num">对手</th>
              <th className="num">差值</th>
              <th>怎么调整</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="sticky-name at-left"><b>{r.label}</b></td>
                <td className="num mono">{at(mine, r.key).toFixed(1)}</td>
                <td className="num mono muted">{at(foe, r.key).toFixed(1)}</td>
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
