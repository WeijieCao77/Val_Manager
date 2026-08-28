/**
 * The map veto, run by hand.
 *
 * The engine has always done this automatically and printed the result — this
 * is the same board, handed back and forth. The manager bans and picks on his
 * turns; the AI uses exactly the judgement `runVeto` would have used, so a
 * veto you sit out and a veto you skip come to the same kind of decision.
 *
 * Comfort is shown for both sides, because that is the whole game here: you
 * ban what they are good at and you keep what you are.
 */
import { useMemo, useState } from 'react'
import { useGame } from './ctx'
import { activePool, vetoChoice, vetoOrder } from '../engine/match'
import { mapCn } from '../engine/content'
import { Rng } from '../engine/rng'
import { hashStr } from '../engine/rng'
import type { Fixture } from '../engine/types'

export default function MapVeto({
  fixture, onDone, onCancel,
}: {
  fixture: Fixture
  onDone: (maps: string[], log: string[]) => void
  onCancel: () => void
}) {
  const { game } = useGame()
  const me = game.teams[game.myTeam]
  const foeId = fixture.teamA === game.myTeam ? fixture.teamB : fixture.teamA
  const foe = game.teams[foeId]
  // our side goes first when we are the home team, exactly as runVeto orders it
  const weAreA = fixture.teamA === game.myTeam
  const order = useMemo(() => vetoOrder(fixture.bo), [fixture.bo])
  const pool = useMemo(
    () => activePool(game.seed + game.year), [game.seed, game.year])
  const rng = useMemo(
    () => new Rng(hashStr(`veto:${game.seed}:${fixture.id}`)), [game.seed, fixture.id])

  const [remaining, setRemaining] = useState<string[]>(pool)
  const [picked, setPicked] = useState<string[]>([])
  const [log, setLog] = useState<string[]>([])
  const [step, setStep] = useState(0)

  const myTurn = (weAreA ? step % 2 === 0 : step % 2 === 1)
  const action = order[step]
  const done = step >= order.length || remaining.length <= 1

  const finish = (maps: string[], rem: string[], lg: string[]) => {
    const out = maps.slice()
    let left = rem.slice()
    while (out.length < fixture.bo && left.length) {
      const d = left[rng.int(0, left.length - 1)]
      out.push(d)
      left = left.filter((m) => m !== d)
      lg = [...lg, `决胜图：${mapCn(d)}`]
    }
    onDone(out.slice(0, fixture.bo), lg)
  }

  const apply = (map: string, who: string, act: 'ban' | 'pick') => {
    const lg = [...log, act === 'ban' ? `${who} ban 掉 ${mapCn(map)}` : `${who} 选下 ${mapCn(map)}`]
    const rem = remaining.filter((m) => m !== map)
    const pk = act === 'pick' ? [...picked, map] : picked
    const next = step + 1
    setLog(lg); setRemaining(rem); setPicked(pk); setStep(next)
    if (next >= order.length || rem.length <= 1) finish(pk, rem, lg)
    return { lg, rem, pk, next }
  }

  // the AI takes its turn as soon as it is its turn
  const aiTurn = () => {
    const act = order[step]
    const map = vetoChoice(game, foeId, game.myTeam, act, remaining, rng)
    apply(map, foe.name, act)
  }

  const rows = remaining.map((m) => ({
    map: m,
    mine: Math.round(me.mapPrefs[m] ?? 50),
    theirs: Math.round(foe.mapPrefs[m] ?? 50),
  })).sort((a, b) => b.mine - a.mine)

  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>
        本赛季图池 7 张，{fixture.bo === 3 ? 'BO3：各 ban 一张，各选一张，再各 ban 一张，剩下的是决胜图'
          : fixture.bo === 5 ? 'BO5：各 ban 一张，然后轮流选图' : 'BO1：轮流 ban 到只剩一张'}。
        <b>ban 掉对手擅长的，留下自己擅长的。</b>
      </p>

      <div className="row" style={{ gap: 10, marginBottom: 10, alignItems: 'baseline' }}>
        <span className="tag" style={{ borderColor: 'var(--accent-line)', color: 'var(--accent)' }}>
          {me.tag} 熟练度
        </span>
        <span className="tag">{foe.tag} 熟练度</span>
        <div style={{ flex: 1 }} />
        {!done && (
          <b style={{ color: myTurn ? 'var(--accent)' : 'var(--muted)' }}>
            {myTurn ? `轮到你${action === 'ban' ? ' ban 图' : ' 选图'}` : `等待 ${foe.name}…`}
          </b>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>地图</th>
              <th className="num">我方</th>
              <th className="num">对手</th>
              <th className="sticky-act" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.map}>
                <td><b>{mapCn(r.map)}</b> <span className="tiny faint">{r.map}</span></td>
                <td className="num mono" style={{ color: r.mine >= r.theirs ? 'var(--win)' : undefined }}>
                  {r.mine}
                </td>
                <td className="num mono muted">{r.theirs}</td>
                <td className="sticky-act">
                  <button
                    className={`sm${action === 'pick' ? ' primary' : ''}`}
                    disabled={!myTurn || done}
                    onClick={() => apply(r.map, me.name, action)}
                  >
                    {action === 'ban' ? 'ban' : '选'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {log.length > 0 && (
        <p className="tiny faint" style={{ marginTop: 10 }}>{log.join(' → ')}</p>
      )}

      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        {!myTurn && !done && (
          <button className="primary sm" onClick={aiTurn}>让 {foe.tag} 出手 ›</button>
        )}
        <div style={{ flex: 1 }} />
        <button className="sm ghost" onClick={onCancel}>取消，用自动 BP</button>
      </div>
    </>
  )
}
