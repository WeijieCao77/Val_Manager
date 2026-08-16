import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { GameCtx } from './ui/ctx'
import NewGame from './ui/NewGame'
import Dashboard from './ui/Dashboard'
import Squad from './ui/Squad'
import TacticsScreen from './ui/Tactics'
import TrainingScreen from './ui/Training'
import Schedule from './ui/Schedule'
import Standings from './ui/Standings'
import Transfers from './ui/Transfers'
import Finances from './ui/Finances'
import Saves from './ui/Saves'
import PlayerModal from './ui/PlayerModal'
import MatchModal from './ui/MatchModal'
import MatchLive from './ui/MatchLive'
import GameOver from './ui/GameOver'
import { autosave, hasAutosave, loadAutosave } from './engine/save'
import { dateLabel, nextFixtureFor, stageName } from './engine/season'
import { screenLocked } from './engine/agenda'
import { money } from './ui/common'
import type { Fixture, GameState } from './engine/types'

const SCREENS: { key: string; label: string; group?: string }[] = [
  { key: 'dashboard', label: '总览', group: '俱乐部' },
  { key: 'squad', label: '阵容' },
  { key: 'tactics', label: '战术' },
  { key: 'training', label: '训练' },
  { key: 'transfers', label: '转会' },
  { key: 'finance', label: '财务' },
  { key: 'schedule', label: '赛程', group: '赛事' },
  { key: 'standings', label: '积分榜' },
  { key: 'saves', label: '存档', group: '系统' },
]

export default function App() {
  const gameRef = useRef<GameState | null>(null)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [screen, setScreen] = useState('dashboard')
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [live, setLive] = useState<Fixture | null>(null)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    setBooted(true)
  }, [])

  const commit = useCallback(() => {
    bump()
    if (gameRef.current) {
      try {
        autosave(gameRef.current)
      } catch {
        /* storage full or unavailable — the game keeps running in memory */
      }
    }
  }, [])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 3200)
  }, [])

  const start = useCallback((g: GameState) => {
    gameRef.current = g
    setScreen('dashboard')
    commit()
  }, [commit])

  const ctxValue = useMemo(
    () => ({
      game: gameRef.current!,
      commit,
      toast,
      openPlayer: setPlayerId,
      openMatch: setFixture,
      playLive: setLive,
      go: setScreen,
    }),
    // gameRef is stable; bump() drives re-renders, so recompute on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, toast, gameRef.current, screen],
  )

  if (!booted) return null

  const game = gameRef.current
  if (!game) {
    return <NewGame onStart={start} canContinue={hasAutosave()} onContinue={() => {
      const g = loadAutosave()
      if (g) start(g)
      else toast('没有找到自动存档。')
    }} />
  }

  const myTeam = game.teams[game.myTeam]
  const next = nextFixtureFor(game, game.myTeam)

  const Screen = ({
    dashboard: Dashboard,
    squad: Squad,
    tactics: TacticsScreen,
    training: TrainingScreen,
    schedule: Schedule,
    standings: Standings,
    transfers: Transfers,
    finance: Finances,
    saves: Saves,
  } as Record<string, ComponentType>)[screen] ?? Dashboard

  return (
    <GameCtx.Provider value={ctxValue}>
      <div className="app">
        <header className="topbar">
          <div className="brand">VAL<span>MANAGER</span></div>
          <div className="chip" title="所属俱乐部">
            <b>{myTeam?.name}</b>
            <span className={`tag ${myTeam?.tier === 1 ? 't1' : 't2'}`}>
              {myTeam?.tier === 1 ? 'VCT' : 'CHAL'}
            </span>
          </div>
          <div className="chip">{dateLabel(game)}</div>
          <div className="chip">{stageName(game.stage)}</div>
          <div className="spacer" />
          <div className="chip" title="可用资金">💰 <b>{money(game.finances.balance)}</b></div>
          <div className="chip" title="董事会信任度">
            🏛 <b>{Math.round(game.boardConfidence)}%</b>
          </div>
          {next && (
            <div className="chip small muted">
              下一场：{game.teams[next.teamA === game.myTeam ? next.teamB : next.teamA]?.name}
            </div>
          )}
        </header>

        <div className="body">
          <nav className="nav">
            {SCREENS.map((s) => {
              const lock = screenLocked(s.key, game)
              return (
                <div key={s.key}>
                  {s.group && <div className="nav-group">{s.group}</div>}
                  <button
                    className={`${screen === s.key ? 'active' : ''}${lock ? ' locked' : ''}`}
                    title={lock ?? ''}
                    onClick={() => setScreen(s.key)}
                  >
                    {s.label}{lock ? ' 🔒' : ''}
                  </button>
                </div>
              )
            })}
          </nav>

          <main className="main">
            <Screen />
          </main>
        </div>

        {playerId && (
          <PlayerModal playerId={playerId} onClose={() => setPlayerId(null)} />
        )}
        {fixture && <MatchModal fixture={fixture} onClose={() => setFixture(null)} />}
        {live && (
          <MatchLive
            key={live.id}
            fixture={live}
            onDone={(watched) => {
              setLive(null)
              // watching already showed the match; skipping just leaves a banner
              if (watched) setFixture(live)
            }}
          />
        )}
        {game.gameOver && (
          <GameOver onRestart={() => { gameRef.current = null; bump() }} />
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </GameCtx.Provider>
  )
}
