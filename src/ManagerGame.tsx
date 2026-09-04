import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
import MidReview from './ui/MidReview'
import RetireCard from './ui/RetireCard'
import { autosave, claimAutosave, hasAutosave, loadAutosave, loadGame, packState } from './engine/save'
import { dateLabel, nextRealFixtureFor, nextScrimFor, stageName } from './engine/season'
import { actionsForTurn, actionsLeft } from './engine/actions'
import Tutorial, { tutorialSeen } from './ui/Tutorial'
import { screenLocked } from './engine/agenda'
import { money, Crest } from './ui/common'
import type { Fixture, GameState } from './engine/types'
import { countScreen, track } from './engine/telemetry'
import Achievements from './ui/Achievements'
import Credit from './ui/Credit'
import Support from './ui/Support'
import Changelog from './ui/Changelog'
import Rules from './ui/Rules'
import Unlocked, { toItems } from './ui/Unlocked'
import type { UnlockItem } from './ui/Unlocked'
import { whenUnlocked } from './engine/profile'
import { ENDINGS } from './engine/endings'
import Dossier from './ui/Dossier'
import ThemeToggle from './ui/ThemeToggle'
import { upcomingInternational } from './engine/qualify'

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

/**
 * The career, whole: every screen, every modal, the engine and the world data
 * behind them. Split out of the shell so `/` and `/cards` never download any
 * of it — see App.tsx, which owns the URL and lazy-loads this.
 */
export default function ManagerGame({ onHome }: { onHome: () => void }) {
  const gameRef = useRef<GameState | null>(null)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [screen, setScreen] = useState('dashboard')
  // which screens people open, and which one they were on when they left
  const mainRef = useRef<HTMLElement>(null)
  const goScreen = (k: string) => {
    countScreen(k)
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
  const sizeSentRef = useRef(false)
  // 'behind' = another tab is ahead; 'failed' = the write itself threw;
  // 'shrunk' = it threw, old match detail was dropped, and the write went in
  const [saveWarn, setSaveWarn] = useState<'behind' | 'failed' | 'shrunk' | null>(null)
  // The banner can be closed. It comes back if the reason changes — a new
  // kind of failure is new information — but a player who has read it and
  // exported a file does not need it over every screen until the write
  // works again, which on a full phone can be never.
  const [warnHidden, setWarnHidden] = useState<'behind' | 'failed' | 'shrunk' | null>(null)

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
        const how = autosave(gameRef.current)
        if (how === 'behind') setSaveWarn('behind')
        else if (how === 'shrunk') {
          // it fitted on the second attempt, so the career is safe — but the
          // player is now missing scoreboards and deserves to know why
          setSaveWarn('shrunk')
          // Reported as a SIZE event, not an error. It was an error row at
          // first and it read as one — 「autosave: shrunk」 sitting in 前端报错
          // next to the failure it prevented. This is the rescue working: the
          // write went in and the career is intact.
          sizeSentRef.current = true
          track('save_size', {
            shrunk: 1,
            kb: Math.round(packState(gameRef.current).length / 1024),
            day: gameRef.current.day,
            year: gameRef.current.year,
          })
        } else {
          // a shrink stays on screen for the session: the write works again,
          // but they are still at the ceiling and the advice still applies
          setSaveWarn((cur) => (cur === 'shrunk' ? cur : null))
          // Once a session, how big this career actually is. Every previous
          // round of this was diagnosed from the size of the saves that had
          // already FAILED, which is the tail and not the distribution — and
          // the number that says whether a fix worked is this one.
          if (!sizeSentRef.current) {
            sizeSentRef.current = true
            track('save_size', {
              kb: Math.round(packState(gameRef.current).length / 1024),
              day: gameRef.current.day,
              year: gameRef.current.year,
            })
          }
        }
      } catch (err) {
        // The game keeps running in memory, but the player's progress is no
        // longer being written. A toast said this once and vanished; somebody
        // played four more seasons past it and lost all of them, so it is a
        // banner now and it stays until the writing works again.
        track('error', {
          msg: `autosave: ${err instanceof Error ? err.name : 'unknown'}`,
          day: gameRef.current.day,
          // the packed length, because that is what localStorage was handed
          kb: warnedSaveRef.current ? undefined
            : Math.round(packState(gameRef.current).length / 1024),
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

  const game = gameRef.current
  if (!game) {
    // Support sits outside the career shell as well as inside it: someone who
    // has not started a save yet is exactly the person reading the front page.
    return <>
      <NewGame onHome={onHome} onStart={start} canContinue={hasAutosave()} onContinue={() => {
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
  // an international we are already booked for, before its draw exists
  const up = upcomingInternational(game)
  const upFirst = up && (!next || up.day < next.day)

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
        <a className="skip-link" href="#main">跳到主内容</a>
        <header className="topbar">
          <button
            className="brand as-link"
            title="回到首页 · 猪之家出品 · 小红书/抖音 @点点点点点点点点"
            onClick={onHome}
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
          <div className="chip" title="可用资金" aria-label="可用资金"><span aria-hidden="true">💰</span> <b>{money(game.finances.balance)}</b></div>
          <div
            className={`chip actions${actionsLeft(game) === 0 ? ' spent' : ''}`}
            title={`本回合 ${actionsForTurn(game)} 点行动力（赛季中每天 2 点，空档期每周 4 点）。\n报价、问价、商务、约战、教练组、挂牌解约等对外事务各花 1 点；\n首发、战术、训练安排不花点数。`}
          >
            <span aria-hidden="true">⚡</span> 行动力
            <b style={{ marginLeft: 4 }}>{actionsLeft(game)}/{actionsForTurn(game)}</b>
          </div>
          <div className="chip" title="董事会信任度" aria-label="董事会信任度">
            <span aria-hidden="true">🏛</span> <b>{Math.round(game.boardConfidence)}%</b>
          </div>
          {scrim && (
            <div className="chip small muted" title="已约训练赛">
              <span aria-hidden="true">🎯</span> {scrim.day - game.day <= 0 ? '今天' : `${scrim.day - game.day}天后`}训练赛
            </div>
          )}
          {upFirst ? (
            <div className="chip small muted" title={`${up.name}：${up.how}。对阵要等四个赛区都打完才抽。`}>
              下一场：{up.name}
              <span className="faint"> · 约{up.day - game.day}天后 · 对手待定</span>
            </div>
          ) : next && (
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
            {/* The ground switch lives at the foot of the rail, where a
                sidebar keeps its settings, rather than in the HUD — the bar
                is full of numbers a decision needs, and at 1280px a long club
                name already used the last of its room. */}
            <div className="nav-foot">
              <ThemeToggle compact />
            </div>
          </nav>

          <main className="main" id="main" ref={mainRef}>
            {/* rendered directly rather than through the map above: an arrow in
                that object would be a new component type on every render, and
                the dossier would lose its search box mid-word */}
            {screen === 'dossier'
              ? <Dossier playerId={dossierId} onOpen={setDossierId} />
              : <Screen />}
            <Credit />
          </main>
        </div>

        {saveWarn && warnHidden !== saveWarn && (
          <div className="save-warn" role="alert">
            <button
              className="sm ghost save-warn-x" aria-label="关闭提示"
              onClick={() => setWarnHidden(saveWarn)}
            >✕</button>
            <b>{saveWarn === 'shrunk' ? '⚠ 存储空间满了，已精简存档' : '⚠ 进度没有被保存'}</b>
            <span>
              {saveWarn === 'behind'
                ? '另一个标签页里有更靠后的存档，为了不覆盖它，这一页暂时不写入。'
                  + '请关掉其它的游戏标签页，然后刷新这一页。'
                : saveWarn === 'shrunk'
                  ? '浏览器的存储空间满了。为了继续保存，旧比赛的计分板和回合记录已经清掉——'
                    + '生涯本身（阵容、合同、荣誉、成就）一点没少，之后的进度照常写入。'
                    + '想彻底腾地方，可以去「存档」页删掉用不上的手动存档。'
                  : '浏览器拒绝了写入（多半是存储空间满了）。'
                    + '现在的进度只存在这个页面里——请去「存档」页导出成文件，'
                    + '并删掉用不上的手动存档腾地方。导出之后可以关掉这条提示；写入恢复时它会自己消失。'}
            </span>
          </div>
        )}
        <Unlocked
          queue={unlocks}
          onNext={() => setUnlocks((q) => q.slice(1))}
          onClearAll={() => setUnlocks([])}
        />
        <Rules raised />
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
        {(() => {
          // one farewell at a time: my own players and the sport's stars,
          // shown once each, oldest first, never during a match or a verdict
          if (live || game.gameOver || game.midReview) return null
          const note = (game.retireFeed ?? []).find((n) => !n.seen && (n.clubId === game.myTeam || n.star))
          if (!note) return null
          return (
            <RetireCard
              note={note}
              onClose={() => { note.seen = true; commit() }}
            />
          )
        })()}
        {game.midReview && !game.gameOver && <MidReview />}
        {game.gameOver && (
          <GameOver onRestart={() => { gameRef.current = null; bump() }} />
        )}
        {tour && !game.gameOver && (
          <Tutorial screen={screen} go={goScreen} playerOpen={!!playerId} onDone={() => setTour(false)} />
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </GameCtx.Provider>
  )
}
