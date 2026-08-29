import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { GameCtx } from './ui/ctx'
import NewGame from './ui/NewGame'
import Dashboard from './ui/Dashboard'
import Squad from './ui/Squad'
import TacticsScreen from './ui/Tactics'
import TrainingScreen from './ui/Training'
import Commercial from './ui/Commercial'
import Career from './ui/Career'
import Schedule from './ui/Schedule'
import Standings from './ui/Standings'
import Transfers from './ui/Transfers'
import Finances from './ui/Finances'
import Saves from './ui/Saves'
import PlayerModal from './ui/PlayerModal'
import MatchModal from './ui/MatchModal'
import MatchLive from './ui/MatchLive'
import GameOver from './ui/GameOver'
import { autosave, claimAutosave, hasAutosave, loadAutosave, loadGame } from './engine/save'
import { dateLabel, nextRealFixtureFor, nextScrimFor, stageName } from './engine/season'
import { actionsForTurn, actionsLeft } from './engine/actions'
import Tutorial, { tutorialSeen } from './ui/Tutorial'
import { screenLocked } from './engine/agenda'
import { money, Crest } from './ui/common'
import type { Fixture, GameState } from './engine/types'
import { track } from './engine/telemetry'
import Achievements from './ui/Achievements'
import Credit from './ui/Credit'
import Support from './ui/Support'
import Changelog from './ui/Changelog'
import Unlocked, { toItems } from './ui/Unlocked'
import type { UnlockItem } from './ui/Unlocked'
import { whenUnlocked } from './engine/profile'
import { ENDINGS } from './engine/endings'
import Dossier from './ui/Dossier'

/**
 * Three places to be, and the URL is the only thing that decides which.
 *
 * `/` is the front page, `/manager` is the career and `/cards` is 开瓦包. Both
 * games are loaded lazily, so a visitor who opens the front page and reads it
 * downloads neither.
 *
 * The career used to be at `/`, which is the URL everybody already has. It
 * still works: the front page is what they land on, and the career card on it
 * offers 「继续上次存档」 when there is one, so a returning player is one click
 * from exactly where they were rather than being told their game is gone.
 */
const CardMode = lazy(() => import('./ui/CardMode'))
const Home = lazy(() => import('./ui/Home'))

type Mode = 'home' | 'career' | 'cards'
const PATHS: Record<Mode, string> = { home: '/', career: '/manager', cards: '/cards' }

const modeOf = (): Mode => {
  if (typeof location === 'undefined') return 'home'
  const p = location.pathname.replace(/\/+$/, '')
  if (p.endsWith('/cards')) return 'cards'
  if (p.endsWith('/manager')) return 'career'
  return 'home'
}

const SCREENS: { key: string; label: string; group?: string }[] = [
  { key: 'dashboard', label: '总览', group: '俱乐部' },
  { key: 'squad', label: '阵容' },
  { key: 'tactics', label: '战术' },
  { key: 'training', label: '训练' },
  { key: 'transfers', label: '转会', group: '经营' },
  { key: 'commercial', label: '商务' },
  { key: 'finance', label: '财务' },
  { key: 'schedule', label: '赛程', group: '赛事' },
  { key: 'standings', label: '积分榜' },
  { key: 'career', label: '经理', group: '生涯' },
  { key: 'awards', label: '成就' },
  { key: 'dossier', label: '资料库' },
  { key: 'saves', label: '存档', group: '系统' },
]

export default function App() {
  // The card mode is a different game with a different save, so it gets the
  // whole window rather than a screen inside the career shell. Which one you
  // are in is the URL and nothing else: /cards is the card mode, everything
  // else is the career. That way a refresh keeps you where you were, the back
  // button works, and there is exactly one way in.
  const [mode, setModeRaw] = useState<Mode>(modeOf)
  const setMode = useCallback((m: Mode) => {
    try {
      const to = PATHS[m]
      if (location.pathname !== to) history.pushState({}, '', to)
    } catch { /* file:// or a sandboxed frame; the state change still works */ }
    setModeRaw(m)
  }, [])

  // back and forward move between the three, rather than leaving the site
  useEffect(() => {
    const onPop = () => setModeRaw(modeOf())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const gameRef = useRef<GameState | null>(null)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [screen, setScreen] = useState('dashboard')
  // which screens people open, and which one they were on when they left
  const mainRef = useRef<HTMLElement>(null)
  const goScreen = (k: string) => {
    track('screen', { to: k })
    if (k !== 'dossier') setDossierId(null)
    setScreen(k)
  }
  // a new screen starts at its top — the scroller is <main>, not the window,
  // so carrying scroll over lands phones in the middle of a page they just
  // opened
  useEffect(() => { mainRef.current?.scrollTo(0, 0) }, [screen])
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [tour, setTour] = useState(() => !tutorialSeen())
  const [playerId, setPlayerId] = useState<string | null>(null)
  const [dossierId, setDossierId] = useState<string | null>(null)
  const [playerRenew, setPlayerRenew] = useState(false)
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [live, setLive] = useState<Fixture | null>(null)
  // Anything that unlocks anywhere in the career shows up here, whichever
  // screen you were on when it happened.
  const [unlocks, setUnlocks] = useState<UnlockItem[]>([])
  const [booted, setBooted] = useState(false)
  const warnedSaveRef = useRef(false)
  // 'behind' = another tab is ahead; 'failed' = the write itself threw
  const [saveWarn, setSaveWarn] = useState<'behind' | 'failed' | null>(null)

  useEffect(() => {
    setBooted(true)
  }, [])

  useEffect(() => {
    whenUnlocked((fresh) => {
      const items = toItems(fresh.achievements, fresh.endings, ENDINGS)
      // Which of the 65 actually get earned. The reachability audit proved
      // they all CAN be; this is the half it cannot answer.
      //
      // The title rides along with the key so the dashboard never has to keep
      // its own copy of sixty-five names — a second list is a list that drifts,
      // and this codebase has already shipped that bug twice.
      for (const it of items) {
        track('unlock', {
          kind: it.kind === '结局' ? 'end' : 'ach',
          key: it.key,
          name: it.title,
        })
      }
      if (items.length) setUnlocks((q) => [...q, ...items])
    })
    return () => whenUnlocked(null)
  }, [])

  const commit = useCallback(() => {
    bump()
    if (gameRef.current) {
      try {
        // 'behind' means another tab holds a career further along than this
        // one, and writing would put its progress back. Refusing is the whole
        // point, but the player has to be told — silently not saving is the
        // failure they cannot see coming.
        if (autosave(gameRef.current) === 'behind') setSaveWarn('behind')
        else setSaveWarn(null)
      } catch (err) {
        // The game keeps running in memory, but the player's progress is no
        // longer being written. A toast said this once and vanished; somebody
        // played four more seasons past it and lost all of them, so it is a
        // banner now and it stays until the writing works again.
        track('error', {
          msg: `autosave: ${err instanceof Error ? err.name : 'unknown'}`,
          day: gameRef.current.day,
          kb: warnedSaveRef.current ? undefined
            : Math.round(JSON.stringify(gameRef.current).length / 1024),
        })
        warnedSaveRef.current = true
        setSaveWarn('failed')
      }
    }
  }, [])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 3200)
  }, [])

  const start = useCallback((g: GameState) => {
    gameRef.current = g
    // Opening a save deliberately — continuing, importing, loading a slot —
    // makes this tab the one that counts, so the cross-tab guard stops
    // treating some other tab's further-along career as the truth.
    claimAutosave(g)
    setScreen('dashboard')
    commit()
  }, [commit])

  const ctxValue = useMemo(
    () => ({
      game: gameRef.current!,
      commit,
      toast,
      openPlayer: (id: string, renew = false) => { setPlayerRenew(renew); setPlayerId(id) },
      loadSlot: (slot: string) => {
        const g = loadGame(slot)
        if (g) { start(g); toast(`已读取「${slot === 'autosave' ? '自动存档' : slot}」。`) }
        else toast(`存档「${slot}」读不出来。`)
      },
      openMatch: setFixture,
      playLive: setLive,
      go: goScreen,
      startTutorial: () => setTour(true),
    }),
    // gameRef is stable; bump() drives re-renders, so recompute on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, toast, gameRef.current, screen],
  )

  if (!booted) return null
  const loading = (
    <div className="wrap" style={{ padding: 40 }}><p className="muted">载入中…</p></div>
  )
  if (mode === 'home') {
    return (
      <Suspense fallback={loading}>
        <Home onOpen={setMode} />
      </Suspense>
    )
  }
  if (mode === 'cards') {
    return (
      <Suspense fallback={loading}>
        <CardMode onExit={() => setMode('home')} />
      </Suspense>
    )
  }

  const game = gameRef.current
  if (!game) {
    // Support sits outside the career shell as well as inside it: someone who
    // has not started a save yet is exactly the person reading the front page.
    return <>
      <NewGame onHome={() => setMode('home')} onStart={start} canContinue={hasAutosave()} onContinue={() => {
      const g = loadAutosave()
      if (g) {
        // A return only means something if it is a career being picked up.
        // Reopening a tab and loading a save on day 143 with the board at 22%
        // are not the same event, and only one of them is stickiness.
        track('career_resume', {
          day: g.day, year: g.year, stage: g.stage,
          seasons: g.year - 2026,
          conf: Math.round(g.boardConfidence),
          over: !!g.gameOver,
        })
        start(g)
        } else toast('没有找到自动存档。')
      }} />
      <Changelog />
      <Support />
    </>
  }

  const myTeam = game.teams[game.myTeam]
  // the top bar tracks the next competitive match; a scrim gets its own chip
  const next = nextRealFixtureFor(game, game.myTeam)
  const scrim = nextScrimFor(game, game.myTeam)

  const Screen = ({
    dashboard: Dashboard,
    squad: Squad,
    tactics: TacticsScreen,
    training: TrainingScreen,
    schedule: Schedule,
    standings: Standings,
    transfers: Transfers,
    commercial: Commercial,
    finance: Finances,
    career: Career,
    awards: Achievements,
    saves: Saves,
  } as Record<string, ComponentType>)[screen] ?? Dashboard

  return (
    <GameCtx.Provider value={ctxValue}>
      <div className="app">
        <header className="topbar">
          <button
            className="brand as-link"
            title="回到首页 · 猪之家出品 · 小红书/抖音 @点点点点点点点点"
            onClick={() => setMode('home')}
          >
            VCT<span>电竞经理</span>
            <em className="by">猪之家出品</em>
          </button>
          <div className="chip brand-club" title="所属俱乐部">
            <Crest id={game.myTeam} size={20} />
            <b>{myTeam?.name}</b>
            <span className={`tag ${myTeam?.tier === 1 ? 't1' : 't2'}`}>
              {myTeam?.tier === 1 ? 'VCT' : 'CHAL'}
            </span>
          </div>
          <div className="chip">{dateLabel(game)}</div>
          <div className="chip">{stageName(game.stage)}</div>
          <div className="spacer" />
          <div className="chip" title="可用资金">💰 <b>{money(game.finances.balance)}</b></div>
          <div
            className={`chip actions${actionsLeft(game) === 0 ? ' spent' : ''}`}
            title={`本回合 ${actionsForTurn(game)} 点行动力（赛季中每天 2 点，空档期每周 4 点）。\n报价、问价、商务、约战、教练组、挂牌解约等对外事务各花 1 点；\n首发、战术、训练安排不花点数。`}
          >
            ⚡ 行动力
            <b style={{ marginLeft: 4 }}>{actionsLeft(game)}/{actionsForTurn(game)}</b>
          </div>
          <div className="chip" title="董事会信任度">
            🏛 <b>{Math.round(game.boardConfidence)}%</b>
          </div>
          {scrim && (
            <div className="chip small muted" title="已约训练赛">
              🎯 {scrim.day - game.day <= 0 ? '今天' : `${scrim.day - game.day}天后`}训练赛
            </div>
          )}
          {next && (
            <div className="chip small muted" title="下一场正式比赛">
              下一场：{game.teams[next.teamA === game.myTeam ? next.teamB : next.teamA]?.tag}
              <span className="faint"> · {next.day - game.day <= 0 ? '今天' : `${next.day - game.day}天后`}</span>
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
                    className={`nav-item ${screen === s.key ? 'active' : ''}${lock ? ' locked' : ''}`}
                    data-key={s.key}
                    title={lock ?? ''}
                    onClick={() => goScreen(s.key)}
                  >
                    {s.label}{lock ? ' 🔒' : ''}
                  </button>
                </div>
              )
            })}
          </nav>

          <main className="main" ref={mainRef}>
            {/* rendered directly rather than through the map above: an arrow in
                that object would be a new component type on every render, and
                the dossier would lose its search box mid-word */}
            {screen === 'dossier'
              ? <Dossier playerId={dossierId} onOpen={setDossierId} />
              : <Screen />}
            <Credit />
          </main>
        </div>

        {saveWarn && (
          <div className="save-warn" role="alert">
            <b>⚠ 进度没有被保存</b>
            <span>
              {saveWarn === 'behind'
                ? '另一个标签页里有更靠后的存档，为了不覆盖它，这一页暂时不写入。'
                  + '请关掉其它的游戏标签页，然后刷新这一页。'
                : '浏览器拒绝了写入（多半是存储空间满了）。'
                  + '现在的进度只存在这个页面里——请去「存档」页导出成文件。'}
            </span>
          </div>
        )}
        <Unlocked
          queue={unlocks}
          onNext={() => setUnlocks((q) => q.slice(1))}
          onClearAll={() => setUnlocks([])}
        />
        <Changelog raised />
        <Support raised />

        {playerId && (
          <PlayerModal
            playerId={playerId}
            startRenewing={playerRenew}
            onClose={() => { setPlayerId(null); setPlayerRenew(false) }}
          />
        )}
        {fixture && <MatchModal fixture={fixture} onClose={() => setFixture(null)} />}
        {live && (
          <MatchLive
            key={live.id}
            fixture={live}
            onDone={() => {
              setLive(null)
              // always show the result — skipping is precisely when you have
              // seen nothing, and the banner this used to rely on is long gone
              setFixture(live)
            }}
          />
        )}
        {game.gameOver && (
          <GameOver onRestart={() => { gameRef.current = null; bump() }} />
        )}
        {tour && !game.gameOver && (
          <Tutorial screen={screen} go={goScreen} onDone={() => setTour(false)} />
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </GameCtx.Provider>
  )
}
