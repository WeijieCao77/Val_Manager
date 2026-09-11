import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import CardFace, { Flag, natName } from '../Card'
import { Panel } from '../common'
import { collection, salvagePlan, upgradeCost, SWEEPABLE } from '../../engine/gacha'
import { clubSets } from '../../engine/clubSets'
import { dismantleFee, dismantleYield } from '../../engine/dismantle'
import { sparesOf } from '../../engine/inbox'
import { crestUrl } from '../../engine/dossier'
import {
  ALL_CARDS, MAX_LEVEL, RARITY_CN, SALVAGE, cardById, isPlayerCard, ratingAt,
} from '../../engine/cards'
import type { Card } from '../../engine/cards'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../../engine/types'
import { LEGEND_KIND_CN } from '../../engine/legends'
import { legendPhoto } from '../../engine/dossier'
import { CardFilters, EMPTY_FILTER, matchesFilter } from './Filters'
import type { CardFilter } from './Filters'

const coin = (n: number) => n.toLocaleString('en-US')
const SETS_OPEN = 'valmanager:card:setsOpen'

export default function Collection() {
  const { g, act, toast, openDossier } = useCards()
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

  const mine = useMemo(() => collection(g), [g, g.pulls, g.coins])
  // the club menu is built from whatever pile is on screen: what you own, or
  // what you are still missing
  const pool = useMemo(() => (missing
    ? ALL_CARDS.filter((c) => !g.cards[c.id])
    : mine.map((x) => x.card)), [missing, mine, g.cards])

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
  }), [g, g.cards, g.coins, keepUp])
  const pickedPlan = useMemo(() => {
    const lines = salvagePlan(g, { cardIds: [...picked], keepForUpgrade: keepUp })
    return {
      dupes: lines.reduce((n, l) => n + l.count, 0),
      coins: lines.reduce((n, l) => n + l.coins, 0),
    }
  }, [g, g.cards, g.coins, picked, keepUp])

  // 300 is what the server will read out of one request; the grid shows 240,
  // so this only ever bites somebody picking across several filters
  const togglePick = (id: string) => setPicked((was) => {
    const next = new Set(was)
    if (next.has(id)) next.delete(id)
    else if (next.size >= 300) { toast('一次最多选 300 张，先分一批。'); return was }
    else next.add(id)
    return next
  })

  const runSalvage = async (args: Record<string, unknown>, ask: string, after?: () => void) => {
    if (busy || !confirm(ask)) return
    setBusy(true)
    const r = await act('salvage_bulk', { ...args, keepForUpgrade: keepUp })
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const got = r.result as { coins: number; dupes: number }
    toast(`分解 ${got.dupes} 张，+${coin(got.coins)} 金币。`)
    after?.()
  }

  const sets = useMemo(() => clubSets(g), [g, g.cards])
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
  const sel = open ? cardById(open) : null
  const owned = open ? g.cards[open] : undefined

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
                  onClick={() => void runSalvage(
                    { rarities: [s.rarity] },
                    `分解 ${s.dupes} 张重复${RARITY_CN[s.rarity]}，换 ${coin(s.coins)} 金币？`,
                  )}
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
                onClick={() => void runSalvage(
                  { cardIds: [...picked] },
                  `分解选中的 ${pickedPlan.dupes} 张重复卡，换 ${coin(pickedPlan.coins)} 金币？`,
                  () => setPicked(new Set()),
                )}
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

      {sel && owned && (
        <div className="modal-bg" onClick={() => setOpen(null)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{sel.kind === 'player' ? sel.ign : sel.name}</h2>
              <div className="spacer" />
              <button className="ghost sm" onClick={() => setOpen(null)}>关闭</button>
            </div>
            <div className="modal-body">
              <div className="row" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <CardFace card={sel} level={owned.level} size="lg" />
                <div style={{ flex: 1, minWidth: 240 }}>
                  {sel.legend && (
                    <div
                      className="small"
                      style={{
                        marginBottom: 10, padding: '9px 11px', borderRadius: 4, lineHeight: 1.7,
                        background: 'rgba(180,120,255,.10)',
                        border: '1px solid rgba(180,120,255,.35)',
                      }}
                    >
                      <b>★ {sel.legend.title}</b>
                      <span className="tiny faint" style={{ marginLeft: 6 }}>
                        {LEGEND_KIND_CN[sel.legend.kind]} · {sel.legend.year} · {sel.legend.clubTag}
                      </span>
                      <div className="tiny muted" style={{ marginTop: 4 }}>{sel.legend.note}</div>
                      {legendPhoto(sel.legend.id)?.page && (
                        <div className="tiny faint" style={{ marginTop: 6 }}>
                          {/* CC BY-SA asks us to point at where the picture came
                              from; the tier is not claimed because it is derived
                              from a filename and undersells half of them */}
                          照片：
                          <a
                            href={legendPhoto(sel.legend.id)!.page}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Liquipedia
                          </a>
                          {' '}· CC BY-SA
                        </div>
                      )}
                    </div>
                  )}
                  {isPlayerCard(sel) ? (
                    <>
                      <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.8 }}>
                        {sel.realName ?? '真名未公开'} · <Flag nat={sel.nat} /> {natName(sel.nat)} · {sel.age} 岁
                        <br />
                        {REGION_CN[sel.region]} · {sel.clubTag ?? '自由人'} · {sel.roles.join(' / ')}
                        {sel.isIgl && ' · 指挥'}
                      </div>
                      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 10px' }}>
                        {ATTR_KEYS.map((k) => (
                          <div key={k} className="tiny">
                            <span className="faint">{ATTR_CN[k]}</span>{' '}
                            <b className="mono">{Math.min(99, sel.attrs[k] + owned.level)}</b>
                          </div>
                        ))}
                      </div>
                      <button className="sm" style={{ marginTop: 12 }} onClick={() => openDossier(sel.playerId)}>
                        查看选手资料 →
                      </button>
                    </>
                  ) : (
                    <div className="small muted" style={{ lineHeight: 1.9 }}>
                      {sel.clubTag ?? '自由身'} 的教练{sel.spec ? '组分析师' : ''}
                      <br />战术 {sel.tactics} · 培养 {sel.development} · 激励 {sel.motivation}
                      <br />
                      <span className="tiny">带同队或同赛区的选手时默契更高。</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 16, borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div className="small">
                      等级 <b>+{owned.level}</b> / +{MAX_LEVEL}
                      <span className="faint"> · 评分 {ratingAt(sel.rating, owned.level)}</span>
                    </div>
                    <div className="tiny faint">
                      重复卡 {owned.dupes} 张
                      {sparesOf(owned).length > 0 && ` · 备用卡 ${sparesOf(owned).map((l) => `+${l}`).join('、')}`}
                      {' '}· 累计抽到 {owned.seen} 次
                    </div>
                  </div>
                </div>
                <Upgrade cardId={sel.id} />
                {owned.dupes > 0 && (
                  <button
                    className="sm"
                    style={{ marginLeft: 8 }}
                    onClick={async () => {
                      const n = owned.dupes
                      const r = await act('salvage', { cardId: sel.id, count: n })
                      toast(r.ok ? `分解 ${n} 张，+${(r.result as { coins: number }).coins} 金币。` : r.why)
                    }}
                  >
                    全部分解（+{SALVAGE[sel.rarity] * owned.dupes} 金币）
                  </button>
                )}
                <Spares cardId={sel.id} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Upgrade({ cardId }: { cardId: string }) {
  const { g, act, toast } = useCards()
  const cost = upgradeCost(g, cardId)
  if (cost.to == null) return <span className="tiny faint">{cost.why}</span>
  return (
    <button
      className="primary sm"
      disabled={!cost.can}
      title={cost.why}
      onClick={async () => {
        const r = await act('upgrade', { cardId })
        toast(r.ok ? `升级成功，现在是 +${(r.result as { level: number }).level}。` : r.why)
      }}
    >
      升到 +{cost.to}（{cost.dupes} 张重复 + {cost.coins} 金币）
    </button>
  )
}

/**
 * The upgraded copies kept beside the card, each a button that takes it apart
 * into duplicates for the card you play.
 */
function Spares({ cardId }: { cardId: string }) {
  const { g, act, toast } = useCards()
  const owned = g.cards[cardId]
  const spares = owned ? sparesOf(owned) : []
  if (!spares.length) return null
  return (
    <div style={{ marginTop: 12 }}>
      <div className="tiny faint" style={{ marginBottom: 6 }}>
        备用卡是同一张卡多出来的升级版。拆解后变成重复卡，可以拿去升级。
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {spares.map((lv, i) => (
          <button
            key={i}
            className="sm"
            disabled={g.coins < dismantleFee(lv)}
            title={g.coins < dismantleFee(lv) ? '金币不够' : undefined}
            onClick={async () => {
              const r = await act('dismantle', { cardId, level: lv })
              toast(r.ok ? `拆了一张 +${lv}，多了 ${dismantleYield(lv)} 张重复卡。` : r.why)
            }}
          >
            拆解 +{lv}（{dismantleFee(lv)} 金币，得 {dismantleYield(lv)} 张重复卡）
          </button>
        ))}
      </div>
    </div>
  )
}
