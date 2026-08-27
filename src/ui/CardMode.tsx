import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { CardCtx } from './cards/ctx'
import Packs from './cards/Packs'
import Collection from './cards/Collection'
import SquadScreen from './cards/Squad'
import Ladder from './cards/Ladder'
import Cup from './cards/Cup'
import AccountScreen, { copyText } from './cards/Account'
import Dossier from './Dossier'
import Credit from './Credit'
import {
  createAccount, flushAccount, fetchDay, loadAccount, rememberId, rememberedId, saveAccount,
  serverNow,
} from '../engine/account'
import {
  DIVISIONS, STAMINA_MAX, primeStamina, refreshDaily, staminaIn, staminaNow, starsFor,
} from '../engine/gacha'
import type { GachaState } from '../engine/gacha'
import { track } from '../engine/telemetry'

/** "1:23" — how long until the next 体力 lands. */
const mmss = (ms: number): string => {
  const m = Math.max(0, Math.ceil(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m}分`
}

const TABS = [
  { key: 'packs', label: '抽卡' },
  { key: 'squad', label: '卡组' },
  { key: 'collection', label: '收藏' },
  { key: 'ladder', label: '天梯' },
  { key: 'cup', label: '杯赛' },
  { key: 'dossier', label: '资料库' },
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
  const [today, setToday] = useState('')
  const [cloud, setCloud] = useState(false)
  const [booting, setBooting] = useState(true)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [dossierId, setDossierId] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  const [now, setNow] = useState(() => serverNow())
  const mainRef = useRef<HTMLDivElement>(null)

  // the 体力 meter refills on a clock, so the screens need one that moves
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
        setToday(day.today)
        setCloud(day.cloud)
        setBooting(false)
        return
      }
      const r = await loadAccount(id)
      if (!alive) return
      setToday(r.today)
      if (r.ok) {
        gRef.current = r.state
        setCloud(r.cloud)
        refreshDaily(r.state, r.today)
        // a save from before the meter had a clock has no anchor; give it one
        // now, or it would read as "just spent" forever and never regenerate
        if (primeStamina(r.state, serverNow())) saveAccount(r.state, true)
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

  // a tab that goes away mid-pull should still land the pull
  useEffect(() => {
    const onHide = () => { if (gRef.current && document.visibilityState === 'hidden') flushAccount(gRef.current) }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
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
          setToday(day)
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
          <div className="brand">VAL<span>CARDS</span><em className="by">卡牌模式</em></div>
          <div className="chip" title="金币">🪙 <b>{g.coins.toLocaleString('en-US')}</b></div>
          <div
            className={`chip${staminaNow(g, now) === 0 ? ' spent' : ''}`}
            title={`每场天梯 2 点、每轮杯赛 3 点。每 2 小时回 1 点，最多存 ${STAMINA_MAX} 点。`}
          >
            ⚡ <b>{staminaNow(g, now)}/{STAMINA_MAX}</b>
            {staminaNow(g, now) < STAMINA_MAX && (
              <span className="faint" style={{ marginLeft: 5, fontSize: 11 }}>
                +1 · {mmss(staminaIn(g, now))}
              </span>
            )}
          </div>
          <div className="chip" title="段位">
            {DIVISIONS[g.ladder.div]} <b>{g.ladder.stars}/{starsFor(g.ladder.div)}★</b>
          </div>
          <div className="chip small muted" title="未开的卡包">
            📦 {Object.values(g.packs).reduce((s, n) => s + (n ?? 0), 0)}
          </div>
          <div className="spacer" />
          {!cloud && <div className="chip small" style={{ color: 'var(--warn)' }} title="服务器连不上，进度只在本机">仅本机</div>}
          <button className="ghost sm" onClick={() => { flushAccount(g); onExit() }}>← 回经理模式</button>
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
      <h1 className="display">卡牌模式</h1>
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
        <button className="ghost sm" onClick={onExit}>← 回经理模式</button>
      </div>
      <div style={{ marginTop: 20 }}><Credit /></div>
    </div>
  )
}
