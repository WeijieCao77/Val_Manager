import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import CardFace from '../Card'
import { Panel } from '../common'
import { collection, salvagePlan, SWEEPABLE } from '../../engine/gacha'
import SalvageConfirm from './SalvageConfirm'
import type { SalvageAsk } from './SalvageConfirm'
import { clubSets } from '../../engine/clubSets'
import { sparesOf } from '../../engine/inbox'
import { crestUrl } from '../../engine/dossier'
import { ALL_CARDS, RARITY_CN } from '../../engine/cards'
import type { Card, Rarity } from '../../engine/cards'
import CardDetail from './CardDetail'
import { CardFilters, EMPTY_FILTER, matchesFilter } from './Filters'
import type { CardFilter } from './Filters'

const coin = (n: number) => n.toLocaleString('en-US')
const SETS_OPEN = 'valmanager:card:setsOpen'

export default function Collection() {
  const { g, version, act, toast } = useCards()
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER)
  const [dupesOnly, setDupesOnly] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  // 批量分解: the grid becomes a picker, and the cards with no spare to give
  // drop out of it
  const [bulk, setBulk] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [keepUp, setKeepUp] = useState(true)
  const [busy, setBusy] = useState(false)

  const mine = useMemo(() => collection(g), [g, version])
  // the club menu is built from whatever pile is on screen: what you own, or
  // what you are still missing
  const pool = useMemo(() => (missing
    ? ALL_CARDS.filter((c) => !g.cards[c.id])
    : mine.map((x) => x.card)), [missing, mine, g.cards, version])

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase()
    const match = (c: Card) => {
      if (!text) return true
      const name = c.kind === 'player' ? `${c.ign} ${c.realName ?? ''} ${c.clubTag ?? ''}` : `${c.name} ${c.clubTag ?? ''}`
      return name.toLowerCase().includes(text)
    }
    if (missing) {
      return pool.filter((c) => match(c) && matchesFilter(c, filter))
        .sort((a, b) => b.rating - a.rating)
        .map((card) => ({ card, owned: null, rating: card.rating }))
    }
    return mine
      .filter(({ card, owned }) => (!dupesOnly || owned.dupes > 0) && (!bulk || owned.dupes > 0)
        && match(card) && matchesFilter(card, filter))
  }, [mine, pool, filter, dupesOnly, q, missing, bulk])

  // What each sweep would take, and what the hand-picked ones would. The same
  // function the server runs, so the number on the button is the number.
  const sweeps = useMemo(() => SWEEPABLE.map((rarity) => {
    const lines = salvagePlan(g, { rarities: [rarity], keepForUpgrade: keepUp })
    return {
      rarity,
      dupes: lines.reduce((n, l) => n + l.count, 0),
      coins: lines.reduce((n, l) => n + l.coins, 0),
    }
  }), [g, version, keepUp])
  const pickedPlan = useMemo(() => {
    const lines = salvagePlan(g, { cardIds: [...picked], keepForUpgrade: keepUp })
    return {
      dupes: lines.reduce((n, l) => n + l.count, 0),
      coins: lines.reduce((n, l) => n + l.coins, 0),
    }
  }, [g, version, picked, keepUp])

  // 300 is what the server will read out of one request; the grid shows 240,
  // so this only ever bites somebody picking across several filters
  const togglePick = (id: string) => setPicked((was) => {
    const next = new Set(was)
    if (next.has(id)) next.delete(id)
    else if (next.size >= 300) { toast('一次最多选 300 张，先分一批。'); return was }
    else next.add(id)
    return next
  })

  // Nothing is sold on the first tap: the sheet names every card first.
  const [ask, setAsk] = useState<SalvageAsk | null>(null)
  const runSalvage = (args: { rarities?: Rarity[]; cardIds?: string[] }, after?: () => void) => {
    if (busy) return
    const lines = salvagePlan(g, { ...args, keepForUpgrade: keepUp })
    if (!lines.length) { toast('没有可分解的重复卡。'); return }
    setAsk({
      lines,
      onConfirm: async () => {
        setBusy(true)
        const r = await act('salvage_bulk', { ...args, keepForUpgrade: keepUp })
        setBusy(false)
        setAsk(null)
        if (!r.ok) { toast(r.why); return }
        const got = r.result as { coins: number; dupes: number }
        toast(`分解 ${got.dupes} 张，+${coin(got.coins)} 金币。`)
        after?.()
      },
    })
  }

  const sets = useMemo(() => clubSets(g), [g, version])
  const doneSets = sets.filter((x) => x.done)
  const [allSets, setAllSets] = useState(false)
  // 全队收藏 sits above the cards, and on a phone a full shelf of crests was a
  // whole screen to scroll past before the first player card:
  // 「全队收藏可以折叠起来，不然收藏多了特别是手机看这档了一整个屏幕」.
  // Folded by default, and the choice is remembered per device.
  const [setsOpen, setSetsOpen] = useState(() => {
    try { return localStorage.getItem(SETS_OPEN) === '1' } catch { return false }
  })
  const toggleSets = () => setSetsOpen((v) => {
    try { localStorage.setItem(SETS_OPEN, v ? '0' : '1') } catch { /* private mode: this session only */ }
    return !v
  })

  return (
    <>
      {/* 全队收藏: every club whose player cards you hold in full. Asked for
          by the owner — 「解锁 PRX 全队、EDG 全队、NRG 全队」— and derived
          from the collection each time rather than stored, since nothing
          is paid out for it yet. Finished clubs first, then the nearest. */}
      <Panel
        title="全队收藏"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <span className="tiny muted mono">集齐 {doneSets.length}/{sets.length} 支</span>
            {setsOpen && (
              <button className="sm" onClick={() => setAllSets((v) => !v)}>{allSets ? '只看快齐的' : '看全部'}</button>
            )}
            <button
              className="sm"
              aria-expanded={setsOpen}
              aria-controls="club-sets-body"
              onClick={toggleSets}
            >
              {setsOpen ? '收起 ▲' : '展开 ▼'}
            </button>
          </div>
        }
      >
        {!setsOpen ? (
          // folded: one line, so the panel still says where you are without
          // costing a screen of scrolling to get past it
          <p className="tiny muted" style={{ margin: 0 }}>
            {doneSets.length
              ? <>已集齐 <b>{doneSets.slice(0, 6).map((x) => x.tag).join('、')}</b>{doneSets.length > 6 ? ` 等 ${doneSets.length} 支` : ''}。</>
              : '还没有集齐的队伍。'}
            {' '}点「展开」看进度。
          </p>
        ) : (
        <div id="club-sets-body">
        <p className="tiny muted" style={{ marginTop: 0 }}>
          集齐一支俱乐部在卡池里的所有选手卡（5–7 张）即可。彩卡算作同一个人。
        </p>
        <div className="club-sets">
          {(allSets ? sets : sets.filter((x) => x.done || x.owned >= Math.max(3, x.total - 2)).slice(0, 24)).map((x) => {
            const crest = crestUrl(x.clubId)
            return (
              <div key={x.clubId} className={`club-set${x.done ? ' done' : ''}`} title={x.done ? `${x.name}：已集齐` : `${x.name}：还缺 ${x.missing.join('、')}`}>
                {crest ? <span className="club-set-crest" style={{ backgroundImage: `url(${crest})` }} /> : <span className="club-set-crest" />}
                <b>{x.tag}</b>
                <span className="mono tiny">{x.owned}/{x.total}</span>
                {x.done ? <span className="club-set-mark">✓ 全队</span>
                  : <span className="tiny faint">缺 {x.missing.slice(0, 2).join('、')}{x.missing.length > 2 ? '…' : ''}</span>}
              </div>
            )
          })}
        </div>
        {!allSets && sets.filter((x) => x.done || x.owned >= Math.max(3, x.total - 2)).length === 0 && (
          <p className="empty">还没有快集齐的队，点「看全部」查看。</p>
        )}
        </div>
        )}
      </Panel>

      <Panel
        title={missing ? '还没抽到的卡' : '我的收藏'}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <span className="tiny muted mono">{rows.length} 张</span>
            {!missing && (
              <button
                className={`sm${bulk ? ' primary' : ''}`}
                aria-pressed={bulk}
                onClick={() => { setBulk((v) => !v); setPicked(new Set()) }}
              >
                {bulk ? '退出批量分解' : '批量分解'}
              </button>
            )}
            <button className="sm" onClick={() => { setMissing((v) => !v); setBulk(false) }}>
              {missing ? '看我有的' : '看还缺什么'}
            </button>
          </div>
        }
      >
        <CardFilters
          value={filter}
          onChange={setFilter}
          pool={pool}
          extra={
            <>
              <a className="tiny" href="/seoul-2024">首尔系列图鉴 ↗</a>
              {!missing && (
                <button className={`sm${dupesOnly ? ' primary' : ''}`} onClick={() => setDupesOnly((v) => !v)}>
                  有重复
                </button>
              )}
              <input
                style={{ width: 180 }}
                placeholder="搜 ID / 真名 / 战队"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </>
          }
        />

        {bulk && (
          <div className="salvage-bar">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <b className="small">一键分解</b>
              {sweeps.map((s) => (
                <button
                  key={s.rarity}
                  className="sm"
                  disabled={busy || !s.dupes}
                  onClick={() => runSalvage({ rarities: [s.rarity] })}
                >
                  {RARITY_CN[s.rarity]} {s.dupes} 张 · +{coin(s.coins)}
                </button>
              ))}
              <label className="tiny row" style={{ gap: 5, alignItems: 'center', marginLeft: 'auto' }}>
                <input type="checkbox" checked={keepUp} onChange={(e) => setKeepUp(e.target.checked)} />
                留够升级用的
              </label>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 9 }}>
              <span className="tiny muted">
                点卡片挑：选中 {picked.size} 张，可分解 {pickedPlan.dupes} 张
                {pickedPlan.dupes > 0 && ` · +${coin(pickedPlan.coins)}`}
              </span>
              <button
                className="primary sm"
                disabled={busy || !pickedPlan.dupes}
                onClick={() => runSalvage({ cardIds: [...picked] }, () => setPicked(new Set()))}
              >
                分解选中
              </button>
              {picked.size > 0 && (
                <button className="sm" disabled={busy} onClick={() => setPicked(new Set())}>清空选择</button>
              )}
            </div>
            <p className="tiny faint" style={{ margin: '9px 0 0' }}>
              只卖重复的那几张，收藏里的卡和等级都不动。一键不含彩卡，彩卡要自己点中再分解。
            </p>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="empty">{bulk ? '没有可分解的重复卡。' : '没有符合条件的卡。'}</p>
        ) : (
          <div className="cm-grid">
            {rows.slice(0, 240).map(({ card, owned: o, rating }) => (
              <CardFace
                key={card.id}
                card={card}
                level={o?.level ?? 0}
                dupes={(o?.dupes ?? 0) + (o ? sparesOf(o).length : 0)}
                dimmed={missing}
                selected={bulk && picked.has(card.id)}
                onClick={missing ? undefined : bulk ? () => togglePick(card.id) : () => setOpen(card.id)}
                footer={missing
                  ? `${RARITY_CN[card.rarity]} ${rating}`
                  : bulk ? `重复 ${o?.dupes ?? 0} 张` : undefined}
              />
            ))}
          </div>
        )}
        {rows.length > 240 && (
          <p className="tiny faint" style={{ marginTop: 10 }}>只显示前 240 张，可搜索缩小范围。</p>
        )}
      </Panel>

      {ask && <SalvageConfirm ask={ask} busy={busy} onClose={() => { if (!busy) setAsk(null) }} />}

      {open && g.cards[open] && <CardDetail cardId={open} onClose={() => setOpen(null)} />}
    </>
  )
}
