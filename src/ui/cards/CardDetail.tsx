/**
 * One card, opened: who he is, his numbers, his level and what the next one
 * costs, the duplicates and spares, and what the card goes for on the market.
 *
 * It was the collection's own modal. 「卡组里点一张卡就直接去选替换的」 — so
 * upgrading a card you play meant leaving the squad, finding him again in the
 * collection and opening him there. Now the squad opens the same page, with
 * 替换 / 移出卡组 underneath (`actions`), and the collection opens it bare.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useCards } from './ctx'
import CardFace, { Flag, natName } from '../Card'
import { upgradeCost } from '../../engine/gacha'
import SalvageConfirm from './SalvageConfirm'
import type { SalvageAsk } from './SalvageConfirm'
import { dismantleFee, dismantleYield } from '../../engine/dismantle'
import { sparesOf } from '../../engine/inbox'
import { MAX_LEVEL, POWER_PER_LEVEL, SALVAGE, cardById, cardPower, isPlayerCard } from '../../engine/cards'
import { ATTR_CN, ATTR_KEYS, REGION_CN } from '../../engine/types'
import { LEGEND_KIND_CN } from '../../engine/legends'
import { legendPhoto } from '../../engine/dossier'
import PriceHistory from './PriceHistory'

const coin = (n: number) => n.toLocaleString('en-US')

export default function CardDetail({ cardId, onClose, actions }: {
  cardId: string
  onClose: () => void
  /** buttons under the card — the squad's 替换 and 移出卡组 */
  actions?: ReactNode
}) {
  const { g, act, toast, openDossier } = useCards()
  const [ask, setAsk] = useState<SalvageAsk | null>(null)
  const [busy, setBusy] = useState(false)
  const sel = cardById(cardId)
  const owned = g.cards[cardId]
  if (!sel || !owned) return null
  return (
    <>
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{sel.kind === 'player' ? sel.ign : sel.name}</h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose}>关闭</button>
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
                    {sel.realName ?? '真名未公开'} · <Flag nat={sel.nat} /> {natName(sel.nat)}{!sel.seoul && ` · ${sel.age} 岁`}
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
                  {sel.seoul ? <div className="small muted" style={{ marginTop: 12, lineHeight: 1.8 }}>
                    <b>首尔 2024 · {String(sel.seoul.number).padStart(3, '0')}/080</b><br />
                    当届数据：ACS {sel.seoul.acs} · K/D {sel.seoul.kd.toFixed(2)} · {sel.seoul.maps} 张地图<br />
                    <span className="tiny">能力值由赛事数据换算；头像摄于首尔冠军赛。</span><br />
                    <a href={sel.seoul.profile} target="_blank" rel="noreferrer">查看选手主页 ↗</a>
                    {' · '}<a href="/seoul-2024">浏览赛事图鉴 ↗</a>
                  </div> : <button className="sm" style={{ marginTop: 12 }} onClick={() => openDossier(sel.playerId)}>
                    查看选手资料 →
                  </button>}
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
                  <span className="faint"> · 评分 {sel.rating}</span>
                  {' '}· 战力 <b>{coin(cardPower(sel, owned.level))}</b>
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
                disabled={busy}
                onClick={() => {
                  const n = owned.dupes
                  setAsk({
                    lines: [{ cardId: sel.id, count: n, coins: SALVAGE[sel.rarity] * n }],
                    onConfirm: async () => {
                      setBusy(true)
                      const r = await act('salvage', { cardId: sel.id, count: n })
                      setBusy(false)
                      setAsk(null)
                      toast(r.ok ? `分解 ${n} 张，+${(r.result as { coins: number }).coins} 金币。` : r.why)
                    },
                  })
                }}
              >
                全部分解（+{SALVAGE[sel.rarity] * owned.dupes} 金币）
              </button>
            )}
            <Spares cardId={sel.id} />
            <div className="small" style={{ marginTop: 14 }}>
              <b>交易区</b>
              <PriceHistory cardId={sel.id} level={owned.dupes > 0 ? 0 : owned.level} wide />
            </div>
          </div>
          {actions && (
            <div className="row wrap" style={{ gap: 8, marginTop: 16, borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>

      {ask && <SalvageConfirm ask={ask} busy={busy} onClose={() => { if (!busy) setAsk(null) }} />}
    </>
  )
}

function Upgrade({ cardId }: { cardId: string }) {
  const { g, act, toast } = useCards()
  const cost = upgradeCost(g, cardId)
  const card = cardById(cardId)
  if (cost.to == null) return <span className="tiny faint">{cost.why}</span>
  const player = !!card
  return (
    <button
      className="primary sm"
      disabled={!cost.can}
      title={cost.why}
      onClick={async () => {
        const r = await act('upgrade', { cardId })
        if (!r.ok) { toast(r.why); return }
        const level = (r.result as { level: number } | undefined)?.level ?? cost.to ?? 0
        toast(player && card ? `升级成功，+${level}，战力 ${coin(cardPower(card, level))}。` : `升级成功，现在是 +${level}。`)
      }}
    >
      升到 +{cost.to}（{player ? `战力 +${POWER_PER_LEVEL} · ` : ''}{cost.dupes} 张重复 + {cost.coins} 金币）
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
