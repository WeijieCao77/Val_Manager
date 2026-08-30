/**
 * The map veto, run by hand — now over a board of map cards.
 *
 * The engine has always done this automatically and printed the result — this
 * is the same board, handed back and forth. The manager bans and picks on his
 * turns; the AI uses exactly the judgement `runVeto` would have used, so a
 * veto you sit out and a veto you skip come to the same kind of decision.
 *
 * Every map in the pool stays on the board the whole way through, the way a
 * broadcast BP screen does: a banned card goes dark under an ✕, a picked one
 * lights up with its order, and the step strip on top says whose turn does
 * what. Comfort is shown for both sides on the card, because that is the whole
 * game here — you ban what they are good at and you keep what you are.
 */
import { useMemo, useState } from 'react'
import { useGame } from './ctx'
import { poolFor, vetoChoice, vetoOrder } from '../engine/match'
import { mapCn } from '../engine/content'
import { mapImg } from './common'
import { Rng } from '../engine/rng'
import { hashStr } from '../engine/rng'
import type { Fixture } from '../engine/types'

type Mark = { act: 'ban' | 'pick' | 'decider'; who: string; mine: boolean; n: number }

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
    () => poolFor(game), [game.seed, game.year, game.stage])
  const rng = useMemo(
    () => new Rng(hashStr(`veto:${game.seed}:${fixture.id}`)), [game.seed, fixture.id])

  const [remaining, setRemaining] = useState<string[]>(pool)
  const [picked, setPicked] = useState<string[]>([])
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [log, setLog] = useState<string[]>([])
  const [step, setStep] = useState(0)

  const myTurn = (weAreA ? step % 2 === 0 : step % 2 === 1)
  const action = order[step]
  const done = step >= order.length || remaining.length <= 1

  const finish = (maps: string[], rem: string[], lg: string[], mk: Record<string, Mark>) => {
    const out = maps.slice()
    let left = rem.slice()
    while (out.length < fixture.bo && left.length) {
      const d = left[rng.int(0, left.length - 1)]
      out.push(d)
      left = left.filter((m) => m !== d)
      lg = [...lg, `决胜图：${mapCn(d)}`]
      mk = { ...mk, [d]: { act: 'decider', who: '', mine: false, n: out.length } }
    }
    setMarks(mk)
    onDone(out.slice(0, fixture.bo), lg)
  }

  const apply = (map: string, who: string, mine: boolean, act: 'ban' | 'pick') => {
    const lg = [...log, act === 'ban' ? `${who} ban 掉 ${mapCn(map)}` : `${who} 选下 ${mapCn(map)}`]
    const rem = remaining.filter((m) => m !== map)
    const pk = act === 'pick' ? [...picked, map] : picked
    const mk = { ...marks, [map]: { act, who, mine, n: pk.length } }
    const next = step + 1
    setLog(lg); setRemaining(rem); setPicked(pk); setMarks(mk); setStep(next)
    if (next >= order.length || rem.length <= 1) finish(pk, rem, lg, mk)
  }

  // the AI takes its turn as soon as it is its turn
  const aiTurn = () => {
    const act = order[step]
    const map = vetoChoice(game, foeId, game.myTeam, act, remaining, rng)
    apply(map, foe.name, false, act)
  }

  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>
        当前图池 7 张（Stage 1 和 Stage 2 开打时会各轮换一两张），
        {fixture.bo === 3 ? 'BO3：各 ban 一张，各选一张，再各 ban 一张，剩下的是决胜图'
          : fixture.bo === 5 ? 'BO5：各 ban 一张，然后轮流选图' : 'BO1：轮流 ban 到只剩一张'}。
        <b>ban 掉对手擅长的，留下自己擅长的。</b>
      </p>

      {/* step strip: whose turn does what, current one lit */}
      <div className="row wrap" style={{ gap: 6, marginBottom: 12, alignItems: 'center' }}>
        {order.map((act, i) => {
          const mineStep = weAreA ? i % 2 === 0 : i % 2 === 1
          const state = i < step ? 'past' : i === step && !done ? 'now' : 'todo'
          return (
            <span
              key={i}
              className="tag"
              style={{
                borderColor: state === 'now' ? 'var(--accent-line)' : undefined,
                color: state === 'now' ? 'var(--accent)' : state === 'past' ? 'var(--faint)' : undefined,
                textDecoration: state === 'past' ? 'line-through' : undefined,
              }}
            >
              {mineStep ? '我方' : '对方'} {act === 'ban' ? 'BAN' : 'PICK'}
            </span>
          )
        })}
        <div style={{ flex: 1 }} />
        {!done && (
          <b style={{ color: myTurn ? 'var(--accent)' : 'var(--muted)' }}>
            {myTurn ? `轮到你${action === 'ban' ? ' ban 图' : ' 选图'}` : `等待 ${foe.name}…`}
          </b>
        )}
      </div>

      <div
        style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
        }}
      >
        {pool.map((m) => {
          const mark = marks[m]
          const banned = mark?.act === 'ban'
          const chosen = mark?.act === 'pick' || mark?.act === 'decider'
          const clickable = !mark && myTurn && !done
          return (
            <button
              key={m}
              disabled={!clickable}
              onClick={() => apply(m, me.name, true, action)}
              title={clickable ? `${action === 'ban' ? 'ban 掉' : '选下'} ${mapCn(m)}` : undefined}
              style={{
                all: 'unset', cursor: clickable ? 'pointer' : 'default',
                borderRadius: 8, overflow: 'hidden', position: 'relative',
                border: chosen
                  ? '2px solid var(--accent)'
                  : '1px solid ' + (clickable ? 'var(--accent-line)' : '#2a3644'),
                opacity: banned ? 0.55 : 1,
                background: '#131c26',
              }}
            >
              <div style={{ position: 'relative' }}>
                <img
                  src={mapImg(m)} alt="" loading="lazy"
                  style={{
                    width: '100%', aspectRatio: '560 / 123', objectFit: 'cover', display: 'block',
                    filter: banned ? 'grayscale(1) brightness(.55)' : undefined,
                  }}
                />
                {banned && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                      fontSize: 26, fontWeight: 700, color: 'rgba(255,255,255,.82)',
                    }}
                  >
                    ✕
                  </span>
                )}
                {chosen && (
                  <span
                    className="tag t1"
                    style={{ position: 'absolute', top: 4, right: 4 }}
                  >
                    第 {mark.n} 图
                  </span>
                )}
              </div>
              <div className="row" style={{ padding: '6px 8px', gap: 6, alignItems: 'baseline' }}>
                <b className="small">{mapCn(m)}</b>
                <span className="tiny faint">{m}</span>
                <div style={{ flex: 1 }} />
                <span
                  className="tiny mono"
                  title={`${me.tag} 熟练度 / ${foe.tag} 熟练度`}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  <b style={{
                    color: (me.mapPrefs[m] ?? 50) >= (foe.mapPrefs[m] ?? 50)
                      ? 'var(--win)' : 'var(--warn)',
                  }}>
                    {Math.round(me.mapPrefs[m] ?? 50)}
                  </b>
                  <span className="faint"> : </span>
                  <span className="muted">{Math.round(foe.mapPrefs[m] ?? 50)}</span>
                </span>
              </div>
              {mark && (
                <div className="tiny faint" style={{ padding: '0 8px 6px' }}>
                  {mark.act === 'ban' ? `${mark.mine ? '我方' : '对方'} ban`
                    : mark.act === 'decider' ? '决胜图'
                    : `${mark.mine ? '我方' : '对方'}选下`}
                </div>
              )}
            </button>
          )
        })}
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
