/**
 * The published rates.
 *
 * Every number on this page is measured, not typed: it opens thirty thousand
 * of each pack with the same `openPack` the game uses and counts what comes
 * out. Nothing here can drift out of step with the packs, because there is no
 * second copy of the numbers to drift.
 *
 * It shows the base rates beside the measured ones on purpose. They differ —
 * sometimes by a lot — and a disclosure that quietly published the smaller of
 * the two would be the kind of thing a player works out for themselves and
 * stops trusting you over. The mechanics that move them are named underneath.
 *
 * There is no page any more — the tab was the tenth on a phone, and nobody
 * leaves a pack they just opened to go and read a table somewhere else. These
 * two pieces are what the floating 概率 button shows, one tap from wherever
 * the player is, which is the only moment anybody actually wants them.
 */
import { useEffect, useState } from 'react'
import { measureOdds, type PackOdds } from '../../engine/odds'
import { HARD_PITY, MYTHIC_FLOOR, SOFT_PITY } from '../../engine/gacha'

const METALS = [
  { key: 'mythic', label: '彩卡', cls: 'r-mythic' },
  { key: 'gold', label: '金卡', cls: 'r-gold' },
  { key: 'silver', label: '银卡', cls: 'r-silver' },
  { key: 'bronze', label: '铜卡', cls: 'r-bronze' },
] as const

const pct = (n: number) => `${(n * 100).toFixed(n < 0.001 ? 3 : 2)}%`
/** "about one in N packs", which is the form people actually think in */
const oneIn = (n: number) => (n > 0 ? `约 ${Math.round(1 / n).toLocaleString()} 包一张` : '—')

/** One pack's table. Thirty thousand packs are opened once, on mount. */
export function OddsTables() {
  const [rows, setRows] = useState<PackOdds[] | null>(null)

  // A moment of work, off the first paint so the tab opens immediately.
  useEffect(() => {
    const t = setTimeout(() => setRows(measureOdds()), 30)
    return () => clearTimeout(t)
  }, [])

  if (!rows) return <p className="small faint">正在开三万包…</p>

  return (
    <>
      {rows.map((r) => (
        <div key={r.kind} className="odds-pack">
          <div className="odds-head">
            <b>{r.name}</b>
            <span className="tiny muted">
              每包 {r.draws} 张 · {r.shop ? `${r.cost.toLocaleString()} 金币` : '非卖品，靠升段／夺冠／连签七天'}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>稀有度</th>
                  <th className="num">每张卡的概率</th>
                  <th className="num">每包至少一张</th>
                  <th className="num">基础值</th>
                </tr>
              </thead>
              <tbody>
                {METALS.map((m) => {
                  const per = r.perCard[m.key]
                  const pack = r.perPack[m.key]
                  const base = r.base[m.key]
                  if (m.key === 'mythic' && per === 0 && base === 0) {
                    return (
                      <tr key={m.key}>
                        <td><span className={`tag ${m.cls}`}>{m.label}</span></td>
                        <td className="num faint" colSpan={3}>这种包不出彩卡</td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={m.key}>
                      <td><span className={`tag ${m.cls}`}>{m.label}</span></td>
                      <td className="num mono">{pct(per)}</td>
                      <td className="num mono">
                        {pct(pack)}
                        {m.key !== 'bronze' && (
                          <em className="tiny faint" style={{ marginLeft: 6, fontStyle: 'normal' }}>
                            {oneIn(pack)}
                          </em>
                        )}
                      </td>
                      <td className="num mono faint">{pct(base)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  )
}

/** Why the measured column is not the配置表 column. */
export function OddsWhy() {
  return (
    <>
      <ul className="odds-why">
        <li>
          <b>金卡保底</b>：连续 {SOFT_PITY} 抽没出金卡之后，概率每抽递增，
          第 {HARD_PITY} 抽必出。所以实际金卡率总是高于基础值——基础值越低，
          保底触发得越频繁，抬升也越明显。
        </li>
        <li>
          <b>彩卡保底</b>：连续 {MYTHIC_FLOOR.toLocaleString()} 抽没出彩卡就必出一张。
          这条才是决定彩卡稀有度的主要因素——单看基础值会严重低估，
          所以上面公示的是含保底的实测值。教练包不出彩卡，也不计入这个进度。
        </li>
        <li>
          <b>保底进度挂在账号上</b>，不是挂在卡包上。换一种包开，进度不会重置。
        </li>
        <li>
          <b>选拔包保底银卡、十连包保底金卡</b>：如果一包里最好的那张没达到承诺，
          会被提升上去。所以选拔包的银卡实测高于基础值，
          而十连包的银卡实测<i>低于</i>基础值——被升成金卡了。
        </li>
      </ul>
      <p className="tiny faint" style={{ marginBottom: 0 }}>
        彩卡是二十一张「某个夜晚」的纪念卡，本来就设计成中不了的东西。
        它稀有不是为了让你多花钱——这个游戏不卖任何东西。
      </p>
    </>
  )
}
