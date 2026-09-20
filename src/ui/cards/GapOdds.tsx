/**
 * What a point of 阵容分 is worth, and where the points come from.
 *
 * The percentages are the measured ones for the curve in engine/balance.ts
 * (BALANCE_VERSION 3, analysis/balance_v3/) — change the curve and these go
 * with it. check_balance_v3 holds the engine inside a fence round each.
 */
export const GAP_ODDS: { gap: number; bo3: number; bo5: number }[] = [
  { gap: 1, bo3: 54, bo5: 54 },
  { gap: 2, bo3: 57, bo5: 60 },
  { gap: 3, bo3: 60, bo5: 64 },
  { gap: 5, bo3: 71, bo5: 75 },
  { gap: 8, bo3: 87, bo5: 93 },
  { gap: 10, bo3: 93, bo5: 97 },
]

export function GapOdds({ open = false }: { open?: boolean }) {
  return (
    <details className="tiny muted" open={open} style={{ lineHeight: 1.75 }}>
      <summary>阵容分怎么来，差几分是多少胜率</summary>
      <p style={{ margin: '6px 0' }}>
        天梯、好友房、杯赛<b>只比双方阵容分</b>，不看卡的颜色。高分一方更容易赢，分差越大越稳；低分一方始终有机会。
      </p>
      <table className="gap-odds">
        <thead>
          <tr><th>高出</th>{GAP_ODDS.map((r) => <th key={r.gap}>{r.gap} 分</th>)}</tr>
        </thead>
        <tbody>
          <tr><td>BO3</td>{GAP_ODDS.map((r) => <td key={r.gap}>{r.bo3}%</td>)}</tr>
          <tr><td>BO5</td>{GAP_ODDS.map((r) => <td key={r.gap}>{r.bo5}%</td>)}</tr>
        </tbody>
      </table>
      <p style={{ margin: '6px 0' }}>
        <b>选手升级</b>：每级这张卡评分 +1，阵容分 +0.2；五人都 +5 共 +5 分。<br />
        <b>教练</b>：战术、培养、激励越高，全队加得越多；教练每升一级阵容分 +0.2，+5 共 +1 分。<br />
        <b>默契</b>：每 10 点 +1 分。<b>错位</b>：一人 −1.2 分。<b>没有指挥</b>：−3 分。
      </p>
      <p style={{ margin: '6px 0 0' }}>
        <b>彩卡是纪念卡</b>，评分高，但不保证赢：阵容分相同，彩卡阵容和金卡阵容胜率一样。
      </p>
    </details>
  )
}
