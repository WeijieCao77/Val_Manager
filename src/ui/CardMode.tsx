import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { CardCtx } from './cards/ctx'
import Packs from './cards/Packs'
import Challenge from './cards/Challenge'
import Collection from './cards/Collection'
import SquadScreen from './cards/Squad'
import Ladder from './cards/Ladder'
import Cup from './cards/Cup'
import AccountScreen, { copyText } from './cards/Account'
import Dossier from './Dossier'
import Odds from './cards/Odds'
import Credit from './Credit'
import {
  createAccount, dayOf, flushAccount, fetchDay, loadAccount, rememberId, rememberedId, retryPending,
  saveAccount, serverNow, whenStale,
} from '../engine/account'
import {
  MASTER_DIV, STAMINA_COST, STAMINA_MAX, primeStamina, rankName, refreshDaily,
  staminaIn, staminaNow, staminaRate, starsOnTier, tierStars,
} from '../engine/gacha'
import type { GachaState } from '../engine/gacha'
import { track } from '../engine/telemetry'

/** "12:34" or "1:02:34" — seconds included, because a clock that does not move
 *  reads as a clock that is not running. */
const hhmmss = (ms: number): string => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  const s = t % 60
  const m = Math.floor(t / 60) % 60
  const h = Math.floor(t / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * The 体力 meter, ticking once a second.
 *
 * Its own timer rather than the shell's: the countdown has to move every second
 * to read as running, and re-rendering the whole mode that often would redraw a
 * grid of six hundred cards for the sake of one digit. When a point actually
 * lands it calls up, so the screens that gate on 体力 refresh too.
 */
function StaminaChip({ g, onTick }: { g: GachaState; onTick: () => void }) {
  const [t, setT] = useState(() => serverNow())
  const wasRef = useRef(staminaNow(g, serverNow()))
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = serverNow()
      setT(now)
      const has = staminaNow(g, now)
      if (has !== wasRef.current) {
        wasRef.current = has
        onTick()
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [g, onTick])

  const have = staminaNow(g, t)
  const left = staminaIn(g, t)
  return (
    <div
      className={`chip${have === 0 ? ' spent' : ''}`}
      title={`每场天梯 ${STAMINA_COST.ladder} 点、每轮杯赛 ${STAMINA_COST.cup} 点。`
        + `${staminaRate()}，最多存 ${STAMINA_MAX} 点。`}
    >
      ⚡ <b>{have}/{STAMINA_MAX}</b>
      {have < STAMINA_MAX && (
        <span className="faint mono" style={{ marginLeft: 5, fontSize: 11 }}>
          +1 · {hhmmss(left)}
        </span>
      )}
    </div>
  )
}

const TABS = [
  { key: 'packs', label: '抽卡' },
  { key: 'challenge', label: '挑战' },
  { key: 'squad', label: '卡组' },
  { key: 'collection', label: '收藏' },
  { key: 'ladder', label: '天梯' },
  { key: 'cup', label: '杯赛' },
  { key: 'dossier', label: '资料库' },
  { key: 'odds', label: '概率' },
  { key: 'account', label: '账号' },
]

/**
 * The card mode, top to bottom.
 *
 * Its own shell rather than another screen inside the career app: it has a
 * different save, a different identity, and a different top bar. The two modes
 * share the match engine and the world data, and nothing else.
 */
export default function CardMode({ onExit }: { onExit: () => void }) {
  const gRef = useRef<GachaState | null>(null)
  const [, bump] = useReducer((x: number) => x + 1, 0)
  const [tab, setTab] = useState('packs')

  const [cloud, setCloud] = useState(false)
  const [booting, setBooting] = useState(true)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [dossierId, setDossierId] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  const [now, setNow] = useState(() => serverNow())
  // NOT a fetched string. The date is derived from the ticking server clock,
  // so a tab left open across midnight rolls over on its own instead of
  // insisting all day that it is still yesterday — which brought the check-in
  // button back for a day already claimed and reset the quest board to the
  // wrong one. Same computation the server does, so the two always agree.
  const today = dayOf(now)
  const mainRef = useRef<HTMLDivElement>(null)

  // the 体力 meter refills on a clock and the day turns over on one, so the
  // screens need a clock that moves
  useEffect(() => {
    const t = window.setInterval(() => setNow(serverNow()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 3200)
  }, [])

  const commit = useCallback((immediate = false) => {
    bump()
    if (gRef.current) saveAccount(gRef.current, immediate)
  }, [])

  // pick up the account this browser last used, if it has one
  useEffect(() => {
    let alive = true
    void (async () => {
      const id = rememberedId()
      if (!id) {
        const day = await fetchDay()
        if (!alive) return
        setNow(serverNow())
        setCloud(day.cloud)
        setBooting(false)
        return
      }
      const r = await loadAccount(id)
      if (!alive) return
      // loadAccount has just synced the clock offset, so re-read it before
      // anything derives a date or a 体力 figure from it
      setNow(serverNow())
      if (r.ok) {
        gRef.current = r.state
        setCloud(r.cloud)
        refreshDaily(r.state, r.today)
        // loadAccount anchors from the server's `seen` where the save has no
        // anchor of its own; this only covers the offline path, where there is
        // nothing better to date it from than this moment
        if (primeStamina(r.state, serverNow())) saveAccount(r.state, true)
        // this device was holding play that never reached the server
        if (r.recovered) toast('上次有一段进度没能存上，已经从本机恢复。')
        track('card_start', {
          fresh: false, cloud: r.cloud,
          owned: Object.keys(r.state.cards).length,
          div: r.state.ladder.div,
        })
      } else {
        // the id is remembered but the server has never seen it and there is
        // no local copy either — nothing to restore, so start from the gate
        rememberId(null)
      }
      setBooting(false)
    })()
    return () => { alive = false }
  }, [])

  // When the server says this tab was holding an older copy, take its state
  // rather than argue. Nothing is lost that was not already overwritten
  // somewhere else, and the alternative is this tab clobbering it.
  useEffect(() => {
    whenStale((fresh) => {
      gRef.current = fresh
      bump()
      toast('这个账号刚在别的设备上玩过，已经同步到最新进度。')
    })
    return () => whenStale(null)
  }, [toast])

  // A tab that goes away mid-pull should still land the pull — and a tab that
  // comes back should find out whether it did. Coming back to the front and
  // getting the network back are the only two moments a save that died in the
  // background can succeed, so both are worth a retry; retryPending is a no-op
  // unless the mirror is actually still holding something.
  useEffect(() => {
    const onVis = () => {
      if (!gRef.current) return
      if (document.visibilityState === 'hidden') flushAccount(gRef.current)
      else retryPending(gRef.current)
    }
    const onOnline = () => { if (gRef.current) retryPending(gRef.current) }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  useEffect(() => { mainRef.current?.scrollTo(0, 0) }, [tab])

  const ctx = useMemo(() => ({
    g: gRef.current!,
    today,
    now,
    cloud,
    commit,
    toast,
    openDossier: (id: string) => { setDossierId(id); setTab('dossier') },
    go: setTab,
  // gRef is stable; bump() drives the re-render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [commit, toast, today, now, cloud, gRef.current, tab])

  if (booting) {
    return <div className="wrap" style={{ padding: 40 }}><p className="muted">正在读取卡牌账号…</p></div>
  }

  const g = gRef.current
  if (!g) {
    return (
      <Gate
        onExit={onExit}
        onReady={(state, isNew, isCloud, day) => {
          gRef.current = state
          setCloud(isCloud)
          setNow(serverNow())
            refreshDaily(state, day)
          primeStamina(state, serverNow())
          track('card_start', { fresh: isNew, cloud: isCloud, owned: Object.keys(state.cards).length })
          setFresh(isNew)
          setTab(isNew ? 'account' : 'packs')
          bump()
        }}
      />
    )
  }

  // Looked up, never built inline as an arrow: a component type created during
  // render is a NEW type every render, which remounts the screen and throws
  // away whatever the player had typed into it.
  const Screen = ({
    packs: Packs,
    challenge: Challenge,
    squad: SquadScreen,
    collection: Collection,
    ladder: Ladder,
    cup: Cup,
  } as Record<string, ComponentType>)[tab]

  const signOut = () => {
    rememberId(null)
    gRef.current = null
    setFresh(false)
    bump()
  }

  return (
    <CardCtx.Provider value={ctx}>
      <div className="app cardmode">
        <header className="topbar">
          {/* 开 in the accent, 瓦包 in the gold this mode uses — the same
              two-tone split the career's mark has. The English keeps the .by
              line it inherited, which is where the career puts its credit. */}
          <div className="brand">开<span>瓦包</span><em className="by">VAL CARDS</em></div>
          <div className="chip" title="金币">🪙 <b>{g.coins.toLocaleString('en-US')}</b></div>
          <StaminaChip g={g} onTick={() => setNow(serverNow())} />
          <div className="chip" title="段位">
            {/* the rung, not the division — and past 大师 the score IS the rank */}
            {rankName(g.ladder.div, g.ladder.stars, g.ladder.points ?? 0)}
            {g.ladder.div < MASTER_DIV && (
              <b>{' '}{starsOnTier(g.ladder.div, g.ladder.stars)}/{tierStars(g.ladder.div)}★</b>
            )}
          </div>
          <div className="chip small muted" title="未开的卡包">
            📦 {Object.values(g.packs).reduce((s, n) => s + (n ?? 0), 0)}
          </div>
          <div className="spacer" />
          {!cloud && <div className="chip small" style={{ color: 'var(--warn)' }} title="服务器连不上，进度只在本机">仅本机</div>}
          <button className="ghost sm" onClick={() => { flushAccount(g); onExit() }}>← 返回首页</button>
        </header>

        <nav className="cm-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`cm-tab${tab === t.key ? ' on' : ''}`}
              onClick={() => { setTab(t.key); if (t.key !== 'dossier') setDossierId(null) }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="cm-body" ref={mainRef}>
          {fresh && tab === 'account' && (
            <div className="panel" style={{ borderColor: 'var(--accent-line)', marginBottom: 14 }}>
              <div className="panel-body">
                <b style={{ color: 'var(--accent)' }}>账号已创建 —— 先把下面这串 ID 存好再玩。</b>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  没有密码也没有邮箱，这串 ID 就是全部。存好之后点「抽卡」开始。
                </p>
                <button className="primary sm" style={{ marginTop: 10 }} onClick={() => { setFresh(false); setTab('packs') }}>
                  已经存好了，去抽卡 →
                </button>
              </div>
            </div>
          )}
          {tab === 'dossier' ? <Dossier playerId={dossierId} onOpen={setDossierId} />
            : tab === 'odds' ? <Odds />
            : tab === 'account' ? <AccountScreen onSignOut={signOut} />
            : Screen ? <Screen /> : <Packs />}
          <Credit />
        </div>

        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </CardCtx.Provider>
  )
}

/** The door: make an account, or come back to one. */
function Gate({
  onReady, onExit,
}: {
  onReady: (state: GachaState, isNew: boolean, cloud: boolean, today: string) => void
  onExit: () => void
}) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [made, setMade] = useState<{ state: GachaState; cloud: boolean; today: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setBusy(true)
    setErr(null)
    const r = await createAccount(name)
    setBusy(false)
    setMade({ state: r.state, cloud: r.cloud, today: r.today })
  }

  const signIn = async () => {
    setBusy(true)
    setErr(null)
    const r = await loadAccount(id)
    setBusy(false)
    if (r.ok) {
      rememberId(r.state.id)
      onReady(r.state, false, r.cloud, r.today)
    } else {
      setErr({
        bad: 'ID 格式不对——应该是 VM- 开头、后面五组四位。',
        missing: '没有这个 ID 的记录。检查一下有没有抄错。',
        offline: '连不上服务器，而且这台设备上也没有这个账号的备份。',
      }[r.reason])
    }
  }

  if (made) {
    return (
      <div className="wrap newgame">
        <h1 className="display">记好这串 ID</h1>
        <p className="muted" style={{ lineHeight: 1.9 }}>
          它就是你的账号。<b style={{ color: 'var(--warn)' }}>没有密码，没有邮箱，丢了找不回来。</b>
          <br />截图，或者复制下来存到备忘录里。
        </p>
        <div className="acct-id" style={{ maxWidth: 460 }}>{made.state.id}</div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button
            className="primary"
            onClick={async () => {
              const ok = await copyText(made.state.id)
              setCopied(true)
              if (!ok) setErr('这个浏览器不让自动复制——请长按上面那串手动选中，或者直接截图。')
            }}
          >
            {copied ? '已复制 ✓' : '复制 ID'}
          </button>
          <button
            // Never disabled. Clipboard access fails outright in a few
            // in-app browsers, and a locked door on the only way into the
            // game is worse than a confirm box.
            onClick={() => {
              if (copied || confirm('还没复制 ID。丢了就找不回来了，确定直接进入？')) {
                onReady(made.state, true, made.cloud, made.today)
              }
            }}
          >
            存好了，进入游戏 →
          </button>
        </div>
        {err && <p className="small warn" style={{ marginTop: 10 }}>{err}</p>}
        {!made.cloud && (
          <p className="tiny warn" style={{ marginTop: 14 }}>
            服务器暂时连不上，这个账号先存在本机。等能连上时会自动上传。
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="wrap newgame">
      <h1 className="display" style={{ marginBottom: 2 }}>开瓦包</h1>
      <p className="tiny faint" style={{ letterSpacing: '.34em', margin: '0 0 16px' }}>VAL CARDS</p>
      <p className="muted" style={{ lineHeight: 1.9, maxWidth: 620 }}>
        抽真实的 VCT 选手做成的卡牌，金银铜三档，用抽到的人组一套五人阵容，
        去打真实的职业战队。<b>同队、同国籍、同赛区</b>的选手放在一起会有默契加成——
        一套默契拉满的阵容，能打赢平均分比它高四五分的全明星。
      </p>

      <div className="grid c2" style={{ maxWidth: 720, marginTop: 20, alignItems: 'start' }}>
        <div className="panel">
          <div className="panel-head"><h2>第一次玩</h2></div>
          <div className="panel-body">
            <p className="small muted" style={{ marginTop: 0 }}>
              取个名字就行。系统会给你一串 ID，那就是你的账号——记得存好。
            </p>
            <input
              placeholder="你的昵称"
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary" style={{ marginTop: 10 }} onClick={create} disabled={busy}>
              {busy ? '创建中…' : '创建账号'}
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>已经有 ID 了</h2></div>
          <div className="panel-body">
            <p className="small muted" style={{ marginTop: 0 }}>
              把之前存下来的那串填进来，收藏和段位都在。
            </p>
            <input
              placeholder="VM-XXXX-XXXX-XXXX-XXXX-XXXX"
              value={id}
              onChange={(e) => setId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void signIn() }}
              style={{ fontFamily: 'var(--mono)' }}
            />
            <button style={{ marginTop: 10 }} onClick={signIn} disabled={busy || id.trim().length < 8}>
              {busy ? '读取中…' : '登录'}
            </button>
            {err && <p className="small" style={{ color: 'var(--loss)' }}>{err}</p>}
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 22 }}>
        <button className="ghost sm" onClick={onExit}>← 返回首页</button>
      </div>
      <div style={{ marginTop: 20 }}><Credit /></div>
    </div>
  )
}
