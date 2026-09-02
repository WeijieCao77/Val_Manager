import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame } from './ctx'
import { Crest, Modal, OvrBadge, Roles } from './common'
import RoundRibbon, { RibbonLegend } from './RoundRibbon'
import TacticSliders from './TacticSliders'
import MapVeto from './MapVeto'
import MapPlan from './MapPlan'
import { MatchSim } from '../engine/match'
import { mapCn } from '../engine/content'
import type { Side } from '../engine/match'
import { commitFixture, fixtureRng } from '../engine/season'
import type { Fixture } from '../engine/types'
import { track } from '../engine/telemetry'

type Phase = 'choose' | 'bp' | 'watching' | 'timeout' | 'done'

const TICK_MS = 420

/**
 * Playing out one of the manager's own matches.
 *
 * Skipping runs the same MatchSim straight to the end, so watching costs you
 * nothing but time and gains you the two tactical timeouts a real team gets.
 */
export default function MatchLive({
  fixture, onDone,
}: { fixture: Fixture; onDone: (watched: boolean) => void }) {
  const { game, commit, toast } = useGame()
  const simRef = useRef<MatchSim | null>(null)
  const [, bump] = useState(0)
  const [phase, setPhase] = useState<Phase>('choose')
  const rerender = useCallback(() => bump((x) => x + 1), [])

  if (!simRef.current) {
    simRef.current = new MatchSim(game, fixture.teamA, fixture.teamB, fixture.bo, fixtureRng(game, fixture), fixture.scrim)
  }
  const sim = simRef.current
  const mySide: Side | null = sim.sideOf(game.myTeam)
  const a = game.teams[fixture.teamA]
  const b = game.teams[fixture.teamB]

  const finishUp = useCallback((watched: boolean) => {
    const result = sim.finish()
    // Watching is the showpiece — the round ribbon, live timeouts, hundreds of
    // lines of it. Whether anyone actually uses it, or skips to the score every
    // time, decides whether that investment is worth continuing.
    track(watched ? 'match_watched' : 'match_skipped', {
      day: game.day, stage: game.stage, bo: fixture.bo,
      won: fixture.teamA === game.myTeam
        ? result.mapsWonA > result.mapsWonB
        : result.mapsWonB > result.mapsWonA,
      scrim: fixture.comp === 'scrim',
    })
    // finishing a match can conclude the whole competition; those lines belong
    // to the manager, not to the floor
    const notes: string[] = []
    commitFixture(game, fixture, result, notes)
    for (const n of notes) toast(n)
    commit()
    setPhase('done')
    onDone(watched)
  }, [sim, game, fixture, commit, onDone])

  // 观战 and 跳过剩余 render at the same spot on a phone, so a double-tap on
  // 观战 would start the watch and instantly skip it. A skip in the first
  // moments of watching cannot be a considered choice; swallow it.
  const watchedAt = useRef(0)
  const skip = useCallback(() => {
    if (watchedAt.current && Date.now() - watchedAt.current < 1200) return
    // finish whatever is in flight, then run the rest out
    if (sim.current) {
      sim.current.runOut()
      sim.closeMap()
    }
    while (!sim.decided && sim.nextMap()) {
      sim.current!.runOut()
      sim.closeMap()
    }
    finishUp(false)
  }, [sim, finishUp])

  const step = useCallback(() => {
    const m = sim.current
    if (!m) {
      if (!sim.nextMap()) {
        finishUp(true)
        return
      }
      rerender()
      return
    }
    if (m.over) {
      sim.closeMap()
      if (sim.decided || !sim.nextMap()) finishUp(true)
      rerender()
      return
    }
    m.playRound()
    rerender()
  }, [sim, finishUp, rerender])

  useEffect(() => {
    if (phase !== 'watching') return
    const id = window.setInterval(step, TICK_MS)
    return () => window.clearInterval(id)
  }, [phase, step])

  const map = sim.current
  const canTimeout = !!mySide && !!map && map.canTimeout(mySide)

  const callTimeout = (kind: 'rush' | 'steady' | 'focus', playerId?: string) => {
    if (!mySide || !map) return
    if (map.callTimeout(mySide, { kind, playerId })) {
      const label = kind === 'rush' ? '强攻' : kind === 'steady' ? '稳守' : '打核心'
      toast(`暂停已用：${label}（持续 3 回合）`)
      setPhase('watching')
      rerender()
    }
  }

  // ---------------------------------------------------------------- choose
  if (phase === 'bp') {
    return (
      <Modal title={`赛前 BP · BO${fixture.bo}`} onClose={() => setPhase('choose')} onBgClose={() => {}}>
        <MapVeto
          fixture={fixture}
          onCancel={() => setPhase('choose')}
          onDone={(maps, log) => {
            game.vetoPlan = { fixtureId: fixture.id, maps, log }
            // the sim decided its maps when it was built; rebuild it now that
            // the manager has decided them instead. Nothing has been played.
            game.agentPicks = undefined
            simRef.current = new MatchSim(
              game, fixture.teamA, fixture.teamB, fixture.bo,
              fixtureRng(game, fixture), fixture.scrim,
            )
            commit()
            setPhase('choose')
          }}
        />
      </Modal>
    )
  }

  if (phase === 'choose') {
    return (
      <Modal title={`${game.comps[fixture.comp]?.name ?? fixture.comp} · BO${fixture.bo}`} onClose={skip} onBgClose={() => {}}>
        <div className="score-line">
          <div className="t a" title={a?.name}><Crest id={fixture.teamA} size={30} /><span>{a?.tag}</span></div>
          <div className="s muted" style={{ fontSize: 22 }}>VS</div>
          <div className="t" title={b?.name}><Crest id={fixture.teamB} size={30} /><span>{b?.tag}</span></div>
        </div>
        <p className="center small muted" style={{ marginTop: -6 }}>
          {fixture.label.replace(/^KO:\d+:/, '')}
        </p>
        {!fixture.scrim && (
          <div className="panel" style={{ marginTop: 14 }}>
            <div className="panel-head">
              <h2>地图 · {simRef.current!.maps.map(mapCn).join(' / ')}</h2>
              <div className="spacer" style={{ flex: 1 }} />
              <button className="sm" onClick={() => setPhase('bp')}>手动 BP</button>
            </div>
            <div className="panel-body">
              <p className="tiny faint" style={{ margin: 0 }}>
                {game.vetoPlan
                  ? `你亲自 BP 的结果：${simRef.current!.vetoLog.join('，')}`
                  : '双方按各自的地图熟练度自动 BP 完成了。想亲自 ban 图就点右上角。'}
              </p>
            </div>
          </div>
        )}

        {/* one plan per map: the five agents and the four dials together,
            with the opponent's likely shape beside them. Anything changed
            here is tonight's sheet and the map's new default. */}
        <div className="panel own" style={{ marginTop: 12 }}>
          <div className="panel-head">
            <h2>各图预案 · 英雄与战术</h2>
            <div className="spacer" style={{ flex: 1 }} />
            <span className="tiny faint">改了就记住，下次这张图直接用</span>
          </div>
          <div className="panel-body">
            <MapPlan
              maps={simRef.current!.maps} mode="match"
              opp={fixture.teamA === game.myTeam ? fixture.teamB : fixture.teamA}
            />
          </div>
        </div>

        <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 18 }}>
          <button className="primary" onClick={() => { watchedAt.current = Date.now(); setPhase('watching') }}>
            观战（可用 2 次暂停）
          </button>
          <button onClick={skip}>快进到结果</button>
        </div>
        <p className="tiny faint center" style={{ marginTop: 14, marginBottom: 0 }}>
          观战与快进结果相同；观战每张图 2 次暂停，加时各加 1 次。
        </p>
      </Modal>
    )
  }

  if (phase === 'done') return null

  // ---------------------------------------------------------------- watching
  const mineIsA = fixture.teamA === game.myTeam
  const scoreA = map ? map.a : sim.wonA
  const scoreB = map ? map.b : sim.wonB

  // `round` counts rounds completed, so it reads 0 in the moment before the
  // first one is played — and "第 0 回合" is not a thing that exists
  const roundNo = Math.max(1, map?.round ?? 1)

  return (
    <Modal wide title={`${map ? mapCn(map.map) : '换图中'} · 第 ${roundNo} 回合`} onClose={skip} onBgClose={() => {}}>
      <div className="row" style={{ gap: 8, justifyContent: 'center', marginBottom: 6 }}>
        {sim.played.map((m, i) => (
          <span key={i} className="tag">
            {mapCn(m.map)} {m.scoreA}-{m.scoreB}
          </span>
        ))}
        <span className="tag t1">大比分 {sim.wonA} - {sim.wonB}</span>
      </div>

      <div className="score-line" style={{ padding: '10px 0' }}>
        <div className={`t a ${scoreA > scoreB ? 'win' : ''}`} title={a?.name}>
          <Crest id={fixture.teamA} size={26} /><span>{a?.tag}</span></div>
        <div className="s">{scoreA} : {scoreB}</div>
        <div className={`t ${scoreB > scoreA ? 'win' : ''}`} title={b?.name}>
          <Crest id={fixture.teamB} size={26} /><span>{b?.tag}</span></div>
      </div>

      {map && map.rounds.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <RoundRibbon
            rounds={map.rounds} mineIsA={mineIsA}
            mineTag={(mineIsA ? a : b)?.tag} theirTag={(mineIsA ? b : a)?.tag}
          />
          <div style={{ marginTop: 8 }}>
            <RibbonLegend />
          </div>
        </div>
      )}

      {phase === 'timeout' && map && mySide ? (
        <div className="panel own">
          <div className="panel-head"><h2>暂停 · 剩余 {map.timeouts[mySide]} 次</h2></div>
          <div className="panel-body">
            <p className="small muted" style={{ marginTop: 0 }}>选择接下来 3 个回合的打法：</p>
            <div className="row wrap" style={{ gap: 8, marginBottom: 14 }}>
              <button onClick={() => callTimeout('rush')}>
                强攻 <span className="tiny faint">进攻端更强，但更容易被打穿</span>
              </button>
              <button onClick={() => callTimeout('steady')}>
                稳守 <span className="tiny faint">减少伤亡与波动，适合领先或缺钱</span>
              </button>
            </div>
            {(() => {
              // The dials for THIS map were read when it started and cannot
              // change under a round in progress; what a timeout can still set
              // is the next map's. Per map now, so it is that map's own
              // setting being edited, not a general one.
              const nextMap = sim.maps[sim.mapIndex + 1]
              return nextMap ? (
                <>
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    下一张图 <b>{mapCn(nextMap)}</b> 的战术（本图的已经定了，改不了）：
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <TacticSliders game={game} commit={commit} compact map={nextMap} />
                  </div>
                </>
              ) : (
                <p className="tiny faint" style={{ marginTop: 0 }}>
                  这是最后一张图，滑杆改不了本图——用上面的强攻／稳守。
                </p>
              )
            })()}

            <div className="small muted" style={{ marginBottom: 6 }}>或者围绕一名选手打：</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {(mySide === 'a' ? map.A : map.B).players.map((p) => (
                <button key={p.id} className="sm" onClick={() => callTimeout('focus', p.id)}>
                  {p.ign} <OvrBadge value={p.overall} />
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              {/* 「取消」 read as "discard my slider changes" — it never did.
                  The sliders commit on every drag, and the timeout is only
                  spent by the three calls above, so leaving costs nothing. */}
              <button className="ghost sm" onClick={() => setPhase('watching')}>直接继续比赛</button>
              <p className="tiny faint" style={{ marginTop: 6, marginBottom: 0 }}>
                滑杆拖动即保存；只有选了强攻／稳守／围绕选手，才会用掉一次暂停。
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
          <button
            className="primary"
            disabled={!canTimeout}
            onClick={() => setPhase('timeout')}
          >
            叫暂停{map && mySide ? `（${map.timeouts[mySide]}）` : ''}
          </button>
          <button onClick={skip}>跳过剩余</button>
        </div>
      )}

      {map && mySide && map.calls[mySide] && (
        <p className="center small" style={{ color: 'var(--accent)', marginBottom: 0 }}>
          战术生效中：
          {map.calls[mySide]!.kind === 'rush' ? '强攻'
            : map.calls[mySide]!.kind === 'steady' ? '稳守'
            : `围绕 ${game.players[map.calls[mySide]!.playerId!]?.ign} 打`}
          （剩 {map.calls[mySide]!.roundsLeft} 回合）
        </p>
      )}

      {map && (
        <div className="row wrap tiny faint" style={{ gap: 10, justifyContent: 'center', marginTop: 10 }}>
          {(mySide === 'a' ? map.A : map.B).players.map((p) => (
            <span key={p.id} className="row" style={{ gap: 4 }}>
              <Roles p={p} /><span>{p.ign}</span>
            </span>
          ))}
        </div>
      )}
    </Modal>
  )
}
