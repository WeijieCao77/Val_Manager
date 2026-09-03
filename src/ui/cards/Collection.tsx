import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import CardFace, { Flag, natName } from '../Card'
import { Panel } from '../common'
import { clubSets, collection, upgradeCost } from '../../engine/gacha'
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

export default function Collection() {
  const { g, act, toast, openDossier } = useCards()
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER)
  const [dupesOnly, setDupesOnly] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

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
      .filter(({ card, owned }) => (!dupesOnly || owned.dupes > 0) && match(card) && matchesFilter(card, filter))
  }, [mine, pool, filter, dupesOnly, q, missing])

  const sets = useMemo(() => clubSets(g), [g, g.cards])
  const doneSets = sets.filter((x) => x.done)
  const [allSets, setAllSets] = useState(false)
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
            <button className="sm" onClick={() => setAllSets((v) => !v)}>{allSets ? '只看快齐的' : '看全部'}</button>
          </div>
        }
      >
        <p className="tiny muted" style={{ marginTop: 0 }}>
          一支俱乐部的选手卡全部到手就算集齐（5–7 张，按它在卡池里的人数；彩卡是同一个人的另一晚，不算第二张）。
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
          {!allSets && sets.filter((x) => x.done || x.owned >= Math.max(3, x.total - 2)).length === 0 && (
            <p className="empty">还没有哪支队快集齐。点「看全部」看每支队差多少。</p>
          )}
        </div>
      </Panel>

      <Panel
        title={missing ? '还没抽到的卡' : '我的收藏'}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <span className="tiny muted mono">{rows.length} 张</span>
            <button className="sm" onClick={() => setMissing((v) => !v)}>
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

        {rows.length === 0 ? (
          <p className="empty">没有符合条件的卡。</p>
        ) : (
          <div className="cm-grid">
            {rows.slice(0, 240).map(({ card, owned: o, rating }) => (
              <CardFace
                key={card.id}
                card={card}
                level={o?.level ?? 0}
                dupes={o?.dupes ?? 0}
                dimmed={missing}
                onClick={() => (missing ? undefined : setOpen(card.id))}
                footer={missing ? `${RARITY_CN[card.rarity]} ${rating}` : undefined}
              />
            ))}
          </div>
        )}
        {rows.length > 240 && (
          <p className="tiny faint" style={{ marginTop: 10 }}>只显示了前 240 张，搜一下缩小范围。</p>
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
                  {isPlayerCard(sel) && sel.legend && (
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
                      <span className="tiny">带你阵容里同队/同赛区的选手时，默契会更高。</span>
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
                    <div className="tiny faint">重复卡 {owned.dupes} 张 · 累计抽到 {owned.seen} 次</div>
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
