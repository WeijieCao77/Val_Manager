import { useMemo, useState } from 'react'
import { useCards } from './ctx'
import CardFace, { Flag, natName } from '../Card'
import { Panel } from '../common'
import { collection, salvage, upgrade, upgradeCost } from '../../engine/gacha'
import {
  ALL_CARDS, MAX_LEVEL, RARITY_CN, SALVAGE, cardById, isPlayerCard, ratingAt,
} from '../../engine/cards'
import type { Card, Rarity } from '../../engine/cards'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../../engine/types'

type Filter = 'all' | Rarity | 'coach' | 'dupes'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'gold', label: '金卡' },
  { key: 'silver', label: '银卡' },
  { key: 'bronze', label: '铜卡' },
  { key: 'coach', label: '教练' },
  { key: 'dupes', label: '有重复' },
]

export default function Collection() {
  const { g, commit, toast, openDossier } = useCards()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  const mine = useMemo(() => collection(g), [g, g.pulls, g.coins])

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase()
    const match = (c: Card) => {
      if (!text) return true
      const name = c.kind === 'player' ? `${c.ign} ${c.realName ?? ''} ${c.clubTag ?? ''}` : `${c.name} ${c.clubTag ?? ''}`
      return name.toLowerCase().includes(text)
    }
    if (missing) {
      const owned = new Set(Object.keys(g.cards))
      return ALL_CARDS.filter((c) => !owned.has(c.id) && match(c))
        .filter((c) => filter === 'all' || (filter === 'coach' ? c.kind === 'coach' : filter === 'dupes' ? false : c.rarity === filter))
        .sort((a, b) => b.rating - a.rating)
        .map((card) => ({ card, owned: null, rating: card.rating }))
    }
    return mine
      .filter(({ card, owned }) => {
        if (filter === 'coach') return card.kind === 'coach'
        if (filter === 'dupes') return owned.dupes > 0
        if (filter !== 'all' && card.rarity !== filter) return false
        return true
      })
      .filter(({ card }) => match(card))
  }, [mine, filter, q, missing, g.cards])

  const sel = open ? cardById(open) : null
  const owned = open ? g.cards[open] : undefined

  return (
    <>
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
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <div className="seg">
            {FILTERS.filter((f) => !(missing && f.key === 'dupes')).map((f) => (
              <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <input
            style={{ width: 180 }}
            placeholder="搜 ID / 真名 / 战队"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

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
                <Upgrade
                  cardId={sel.id}
                  onDone={(msg) => { commit(true); toast(msg) }}
                />
                {owned.dupes > 0 && (
                  <button
                    className="sm"
                    style={{ marginLeft: 8 }}
                    onClick={() => {
                      const coins = salvage(g, sel.id, owned.dupes)
                      commit(true)
                      toast(`分解 ${owned.dupes} 张，+${coins} 金币。`)
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

function Upgrade({ cardId, onDone }: { cardId: string; onDone: (msg: string) => void }) {
  const { g } = useCards()
  const cost = upgradeCost(g, cardId)
  if (cost.to == null) return <span className="tiny faint">{cost.why}</span>
  return (
    <button
      className="primary sm"
      disabled={!cost.can}
      title={cost.why}
      onClick={() => {
        if (upgrade(g, cardId)) onDone(`升级成功，现在是 +${g.cards[cardId].level}。`)
      }}
    >
      升到 +{cost.to}（{cost.dupes} 张重复 + {cost.coins} 金币）
    </button>
  )
}
