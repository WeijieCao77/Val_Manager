import { useState } from 'react'
import { useCards } from './ctx'
import CardFace, { CardBack } from '../Card'
import { Panel } from '../common'
import {
  PACKS, PACK_ORDER, QUESTS, HARD_PITY, SOFT_PITY,
  collectionProgress, refreshDaily, featuredSeries, packCost, seriesOfPack, seriesProgress,
} from '../../engine/gacha'
import type { CheckIn, PackKind, Pulled, QuestKey, Series } from '../../engine/gacha'
import { RARITY_CN, cardById, isPlayerCard } from '../../engine/cards'
import { REGION_CN } from '../../engine/types'
import { track } from '../../engine/telemetry'

/** What the server says came out of a pack, resolved back to cards. */
interface PulledWire { cardId: string; dupe: boolean; salvage: number }

export default function Packs() {
  const { g, today, act, toast } = useCards()
  const [opening, setOpening] = useState<Pulled[] | null>(null)
  const [shown, setShown] = useState(0)
  const [busy, setBusy] = useState(false)

  refreshDaily(g, today)
  const prog = collectionProgress(g)
  const series = seriesProgress(g)
  const featured = featuredSeries(today)

  // The pack is rolled on the server and comes back already in the
  // collection; what happens here is the reveal.
  const open = async (kind: PackKind, payWith: 'pack' | 'coins') => {
    if (busy) return
    setBusy(true)
    const r = await act('open', { kind, payWith })
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const wire = ((r.result as { pulled?: PulledWire[] } | undefined)?.pulled ?? [])
    const out: Pulled[] = wire
      .map((p) => { const card = cardById(p.cardId); return card ? { card, dupe: p.dupe, salvage: p.salvage } : null })
      .filter((x): x is Pulled => !!x)
    if (!out.length) { toast('开是开了，但没读到卡——刷新看看收藏。'); return }
    track('card_pull', {
      kind,
      paid: payWith,
      gold: out.filter((p) => p.card.rarity === 'gold').length,
      dupes: out.filter((p) => p.dupe).length,
    })
    setOpening(out)
    setShown(1)
  }

  const done = () => {
    setOpening(null)
    setShown(0)
  }

  const check = async () => {
    const r = await act('checkin')
    if (!r.ok) { toast(r.why); return }
    const c = r.result as CheckIn
    if (!c.already) track('card_signin', { streak: c.streak })
    toast(c.already ? '今天已经签过到了。' : `签到第 ${c.streak} 天：+${c.coins} 金币，卡包已入库。`)
  }

  const claim = async (key: QuestKey) => {
    const r = await act('quest', { key })
    if (!r.ok) { toast(r.why); return }
    toast(`任务完成，+${(r.result as { coins: number }).coins} 金币。`)
  }

  const takeSeries = async (region: Series) => {
    const r = await act('series', { region })
    if (!r.ok) { toast(r.why); return }
    toast(`系列奖励已领取：${(r.result as { got: string }).got}`)
  }

  const signedToday = g.daily.claimed === today

  return (
    <>
      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Panel title="每日签到" actions={<span className="tiny muted">连续 {g.daily.streak} 天</span>}>
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
            每天一次，送金币和卡包。连签 3 天多一个选拔包，连签 7 天送十连包。
            日期以服务器为准（北京时间），改手机时间没有用。
          </p>
          <div className="row" style={{ gap: 4, margin: '10px 0 12px' }}>
            {Array.from({ length: 7 }, (_, i) => {
              const day = i + 1
              // the streak runs past seven, so the strip shows where in the
              // current cycle of seven it is
              const hit = g.daily.streak > 0 ? ((g.daily.streak - 1) % 7) + 1 : 0
              const on = day <= hit
              return (
                <div
                  key={i}
                  title={day === 7 ? '十连包' : day % 3 === 0 ? '选拔包' : '试训包 + 300 金币'}
                  style={{
                    flex: 1, height: 30, borderRadius: 3, display: 'grid', placeItems: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: on ? 'var(--warn-wash)' : 'var(--panel-2)',
                    border: `1px solid ${on ? 'var(--warn)' : 'var(--line)'}`,
                    color: on ? 'var(--warn)' : 'var(--faint)',
                  }}
                >
                  {day === 7 ? '十连' : day % 3 === 0 ? '选拔' : day}
                </div>
              )
            })}
          </div>
          <button className="primary" onClick={() => void check()} disabled={signedToday}>
            {signedToday ? '今天已签到' : '签到'}
          </button>
        </Panel>

        <Panel title="今日任务" actions={<span className="tiny muted">{g.daily.taken.length}/{g.daily.picked.length}</span>}>
          {g.daily.picked.map((key) => {
            const q = QUESTS[key]
            const at = g.daily.progress[key] ?? 0
            const full = at >= q.target
            const taken = g.daily.taken.includes(key)
            return (
              <div key={key} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div>
                  <div className="small">{q.label}</div>
                  <div className="tiny faint mono">{Math.min(at, q.target)}/{q.target} · +{q.reward} 金币</div>
                </div>
                <button className="sm" onClick={() => void claim(key)} disabled={!full || taken}>
                  {taken ? '已领' : full ? '领取' : '进行中'}
                </button>
              </div>
            )
          })}
          <p className="tiny faint" style={{ marginBottom: 0 }}>三个全部完成再送一个试训包。</p>
        </Panel>
      </div>

      <Panel
        title="卡包"
        actions={
          <span className="tiny muted">
            收集 {prog.owned}/{prog.total} ·
            距保底 {Math.max(0, HARD_PITY - g.pity)} 抽
            {g.pity >= SOFT_PITY ? '（已进入保底区间，出金率提升中）' : ''}
          </span>
        }
      >
        <p className="tiny faint" style={{ marginTop: 0, lineHeight: 1.7 }}>
          想买几个就买几个，没有次数限制——能开多少由金币决定。
          十连包不卖，只能靠升段、夺冠或连签七天拿。
        </p>
        <div className="pack-shelf">
          {PACK_ORDER.filter((k) => !seriesOfPack(k)).map((kind) => {
            const def = PACKS[kind]
            const own = g.packs[kind] ?? 0
            return (
              <div key={kind} className="pack-box">
                <h4>
                  {def.name}
                  {own > 0 && <span className="pack-own"> ×{own}</span>}
                </h4>
                <p>{def.blurb}</p>
                <div className="row" style={{ gap: 6 }}>
                  <button className="primary sm" onClick={() => void open(kind, 'pack')} disabled={busy || own < 1}>
                    打开（{own}）
                  </button>
                  {def.shop === false ? (
                    <span className="tiny faint" style={{ alignSelf: 'center' }}>非卖品</span>
                  ) : (
                    <button
                      className="sm"
                      onClick={() => void open(kind, 'coins')}
                      disabled={busy || g.coins < def.cost}
                    >
                      花 {def.cost} 金币
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel
        title="赛区系列"
        actions={<span className="tiny muted">四个赛区，分开收集</span>}
      >
        <p className="tiny faint" style={{ marginTop: 0, lineHeight: 1.7 }}>
          赛区包只会开出该赛区的选手，出金率和选拔包一样，贵 200 金币买的是「不会再出你不缺的卡」。
          {'　'}每个赛区的选手卡收到 25% / 50% / 75% / 90% / 100% 各有一档奖励，收齐一个赛区送买不到的十连包。
          {'　'}彩卡另算，不影响进度——不然一张三百抽才出一次的卡会把整条进度卡死。
          {'　'}每周轮一个主打赛区，本周是{REGION_CN[featured]}，便宜两成；四个包一直都在，不会下架。
        </p>
        <div className="pack-shelf">
          {series.map((s) => {
            const def = PACKS[s.pack]
            const own = g.packs[s.pack] ?? 0
            const pct = s.total ? Math.round((s.owned / s.total) * 100) : 0
            const hot = s.region === featured
            const price = packCost(s.pack, today)
            return (
              <div
                key={s.region}
                className="pack-box"
                style={hot ? { borderColor: 'var(--warn)' } : undefined}
              >
                <h4>
                  {REGION_CN[s.region]}
                  {hot && <span className="tag warn" style={{ marginLeft: 6 }}>本周主打</span>}
                  {own > 0 && <span className="pack-own"> ×{own}</span>}
                </h4>
                <div className="tiny mono faint" style={{ margin: '2px 0 5px' }}>
                  选手卡 {s.owned}/{s.total}（{pct}%）· 彩卡 {s.legends}/{s.legendsTotal}
                </div>
                <div
                  style={{
                    height: 5, borderRadius: 3, background: 'var(--panel-2)',
                    border: '1px solid var(--line)', overflow: 'hidden', marginBottom: 9,
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`, height: '100%',
                      background: s.owned >= s.total ? 'var(--good)' : 'var(--accent)',
                    }}
                  />
                </div>
                <div className="tiny faint" style={{ marginBottom: 8, lineHeight: 1.6 }}>
                  {s.ready.length
                    ? `有 ${s.ready.length} 档奖励可以领`
                    : s.next
                      ? `再收 ${s.next.need} 张到 ${Math.round(s.next.at * 100)}%：${s.next.label}`
                      : '全部收齐了'}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="primary sm" onClick={() => void open(s.pack, 'pack')} disabled={busy || own < 1}>
                    打开（{own}）
                  </button>
                  <button
                    className="sm"
                    onClick={() => void open(s.pack, 'coins')}
                    disabled={busy || g.coins < price}
                  >
                    花 {price} 金币
                    {hot && <s className="faint" style={{ marginLeft: 4 }}>{def.cost}</s>}
                  </button>
                  {s.ready.length > 0 && (
                    <button className="sm warn" onClick={() => void takeSeries(s.region)}>领奖</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      {opening && (
        <PackStage
          pulled={opening}
          shown={shown}
          // ceiling is length + 1, not length: `finished` is `shown >
          // pulled.length`, so clamping at length meant the last card of a
          // multi-card pack could never be got past — the reveal sat on 3/3
          // and swallowed every click
          onNext={() => setShown((n) => Math.min(n + 1, opening.length + 1))}
          onDone={done}
          onSellAll={async () => {
            const cardIds = opening.filter((p) => p.dupe).map((p) => p.card.id)
            if (!cardIds.length) { toast('这一包没有重复卡。'); return }
            const r = await act('salvage_dupes', { cardIds })
            if (!r.ok) { toast(r.why); return }
            const coins = (r.result as { coins: number }).coins
            toast(coins ? `重复卡已分解，+${coins} 金币。` : '这一包的重复卡已经分解过了。')
          }}
        />
      )}
    </>
  )
}

/**
 * One card turning over.
 *
 * The whole point of a pack is the half-second before you know what it is, and
 * a card that simply appears has no half-second. `key` on the caller restarts
 * the animation for each new card.
 */
function Flip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flip">
      <div className="flip-inner">
        <div className="flip-face flip-back"><CardBack /></div>
        <div className="flip-face flip-front">{children}</div>
      </div>
    </div>
  )
}

/**
 * The reveal.
 *
 * Cards come out worst-first and one tap at a time, because the whole point of
 * a ten-pull is the last card. Tapping again skips ahead; nobody should have
 * to sit through an animation twice.
 */
function PackStage({
  pulled, shown, onNext, onDone, onSellAll,
}: {
  pulled: Pulled[]; shown: number
  onNext: () => void; onDone: () => void; onSellAll: () => void
}) {
  // A single-card pack has nothing to summarise: showing a "strip" of one card
  // under the card you are already looking at reads as a bug. So one card goes
  // straight to its own reveal with the buttons under it, and a multi-card
  // pack flips through and then lays them all out.
  const single = pulled.length === 1
  const finished = single || shown > pulled.length
  const current = pulled[Math.min(shown, pulled.length) - 1]
  const dupes = pulled.filter((p) => p.dupe).length

  const actions = (
    <div className="row" style={{ gap: 8 }}>
      {dupes > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onSellAll() }}>
          分解 {dupes} 张重复卡
        </button>
      )}
      <button className="primary" onClick={(e) => { e.stopPropagation(); onDone() }}>收下</button>
    </div>
  )

  return (
    <div className="pack-stage" onClick={finished ? undefined : onNext}>
      {(current?.card.rarity === 'gold' || current?.card.rarity === 'mythic') && (
        <div key={shown} className={`pack-glow${current.card.rarity === 'mythic' ? ' holo' : ''}`} />
      )}
      <div className="pack-reveal">
        {(!finished || single) && current && (
          <>
            <Flip key={`${current.card.id}-${shown}`}>
              <CardFace card={current.card} size="lg" />
            </Flip>
            <div className="row" style={{ gap: 8, flexDirection: 'column' }}>
              <span
                className={`tag ${current.card.rarity === 'mythic' ? 'holo'
                  : current.card.rarity === 'gold' ? 't1' : 't2'}`}
              >
                {RARITY_CN[current.card.rarity]}
              </span>
              {isPlayerCard(current.card) && current.card.legend && (
                <span className="small" style={{ color: '#e9dcff', textAlign: 'center' }}>
                  <b>{current.card.legend.title}</b>
                  <br />
                  <span className="tiny muted">{current.card.legend.note}</span>
                </span>
              )}
              {current.dupe && <span className="tiny muted">重复 · 可分解 {current.salvage} 金币</span>}
            </div>
            {single ? actions : <div className="pack-hint">{shown}/{pulled.length} · 点任意位置继续</div>}
          </>
        )}
        {finished && !single && (
          <>
            <div className="pack-strip">
              {pulled.map((p, i) => (
                <div key={`${p.card.id}-${i}`} className="pack-card" style={{ animationDelay: `${i * 40}ms` }}>
                  <CardFace card={p.card} size="sm" footer={p.dupe ? '重复' : '新卡'} />
                </div>
              ))}
            </div>
            {actions}
          </>
        )}
      </div>
    </div>
  )
}
