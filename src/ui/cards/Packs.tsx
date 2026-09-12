import { useEffect, useRef, useState } from 'react'
import { useCards } from './ctx'
import CardFace, { CardBack } from '../Card'
import { Panel } from '../common'
import {
  PACKS, PACK_ORDER, POSITION_PACK_KINDS, QUESTS, HARD_PITY, SOFT_PITY, packPosition,
  collectionProgress, refreshDaily, featuredSeries, packCost, seriesOfPack, seriesProgress,
} from '../../engine/gacha'
import type { CheckIn, PackKind, Pulled, QuestKey, Series } from '../../engine/gacha'
import type { Card } from '../../engine/cards'
import { RARITY_CN, cardById, isPlayerCard } from '../../engine/cards'
import { REGION_CN } from '../../engine/types'
import { track } from '../../engine/telemetry'
import { playPackCue } from '../packAudio'
import CardTilt from './CardTilt'
import PackPouch from './PackPouch'
import { SeoulCardBack } from './SeoulDesign'
import SeoulPackDisplay from './SeoulPackDisplay'
import { SEOUL_CARDS } from '../../engine/cards'
import { POSITION_PACKS, positionPackStyle } from './positionPackDesign'
import type { PackPosition } from './positionPackDesign'

/** What the server says came out of a pack, resolved back to cards. */
interface PulledWire { cardId: string; dupe: boolean; salvage: number }

export default function Packs() {
  const { g, today, act, toast } = useCards()
  const [opening, setOpening] = useState<Pulled[] | null>(null)
  const [openingKind, setOpeningKind] = useState<PackKind | null>(null)
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
    if (!out.length) { toast('没读到开出的卡，刷新看看收藏。'); return }
    // A card this page cannot name is a player added to the game after this
    // page was loaded: the server rolled him, the account holds him, and the
    // old bundle has no card to draw. 「十连包只有九张」「cn包只有两张」 — the
    // day 14 CN players went in, a phone still on the previous build lost one
    // card in a quarter of its ten-packs. Say so instead of drawing nine.
    if (out.length < wire.length) {
      toast(`这一包有 ${wire.length - out.length} 张是刚加进游戏的新选手，这个页面还是旧版本画不出来。卡已经在账号里，刷新后在收藏里能看到。`)
    }
    track('card_pull', {
      kind,
      paid: payWith,
      gold: out.filter((p) => p.card.rarity === 'gold').length,
      dupes: out.filter((p) => p.dupe).length,
      // which cards, so 「我抽到过他」 can be checked against something —
      // the ten ids of a ten-pull are under a hundred bytes
      cards: out.map((p) => p.card.id).join(','),
    })
    setOpening(out)
    setOpeningKind(kind)
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
            每天送金币和卡包，连签 3 天加送选拔包，连签 7 天送十连包。日期以服务器（北京时间）为准。
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
          <p className="tiny faint" style={{ marginBottom: 0 }}>全部完成加送一个试训包。</p>
        </Panel>
      </div>

      <section className="seoul-shelf" aria-label="首尔 2024 冠军赛系列">
        <div className="seoul-shelf-art"><SeoulPackDisplay /><SeoulCardBack /></div>
        <div className="seoul-shelf-copy"><span className="seoul-eyebrow">CHAMPIONS SEOUL / 2024 COLLECTION</span>
          <h3>首尔 2024 冠军赛</h3>
          <p>16 支战队 · 80 位登场选手 · 专属黑金卡背<br />每包 3 张赛事卡，至少一张银卡，不出彩卡。</p>
          <a href="/seoul-2024">浏览完整系列 ↗</a><p>已收藏 {SEOUL_CARDS.filter(c => g.cards[c.id]).length} / 80</p>
          <div className="row"><button disabled={busy || g.coins < PACKS.seoul2024.cost} onClick={() => void open('seoul2024', 'coins')}>{PACKS.seoul2024.cost} 金币 · 开启首尔包</button>
            {(g.packs.seoul2024 ?? 0) > 0 && <button className="seoul-shelf-secondary" disabled={busy} onClick={() => void open('seoul2024', 'pack')}>打开库存（{g.packs.seoul2024}）</button>}</div>
        </div>
      </section>

      <Panel
        title="卡包"
        actions={
          <span className="tiny muted">
            收集 {prog.owned}/{prog.total} ·
            距保底 {Math.max(0, HARD_PITY - g.pity)} 抽
            {g.pity >= SOFT_PITY ? '（概率递增中）' : ''}
          </span>
        }
      >
        <p className="tiny faint" style={{ marginTop: 0, lineHeight: 1.7 }}>
          用金币随时买，不限次数。十连包不卖，靠升段、夺冠或连签七天获得。
        </p>
        <div className="pack-shelf">
          {PACK_ORDER.filter((k) => !seriesOfPack(k) && k !== 'seoul2024').map((kind) => {
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

      {POSITION_PACK_KINDS.some((k) => (g.packs[k] ?? 0) > 0) && (
        <Panel title="位置奖励包" actions={<span className="tiny muted">小游戏打出来的</span>}>
          <p className="tiny faint" style={{ marginTop: 0, lineHeight: 1.7 }}>
            开出一张该位置的选手卡，只能在「小游戏」里赢得。
          </p>
          <div className="pack-shelf">
            {POSITION_PACK_KINDS.filter((k) => (g.packs[k] ?? 0) > 0).map((kind) => {
              const def = PACKS[kind]
              const own = g.packs[kind] ?? 0
              return (
                <div key={kind} className="pack-box">
                  <h4>{def.name}<span className="pack-own"> ×{own}</span></h4>
                  <p>{def.blurb}</p>
                  <button className="primary sm" onClick={() => void open(kind, 'pack')} disabled={busy || own < 1}>打开（{own}）</button>
                </div>
              )
            })}
          </div>
        </Panel>
      )}

      <Panel
        title="赛区系列"
        actions={<span className="tiny muted">四个赛区，分开收集</span>}
      >
        <p className="tiny faint" style={{ marginTop: 0, lineHeight: 1.7 }}>
          赛区包只出该赛区的选手，出金率和选拔包相同，贵 200 金币。
          {'　'}每个赛区收到 25% / 50% / 75% / 90% / 100% 各有一档奖励，收齐送十连包。彩卡不计入进度。
          {'　'}每周轮一个主打赛区，本周是{REGION_CN[featured]}，便宜两成。
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
                {/* The reward lives on its own line, next to the words that
                    announce it. It used to be a third button on the buy row,
                    and the box clips (overflow: hidden, for the glow in the
                    corner) — four boxes across a desktop are ~230px each,
                    and 打开 + 花 2600 金币 + 领奖 was wider than that, so the
                    one button that gives something away was the one you could
                    not see. Same for the struck price on the featured box. */}
                <div className="row" style={{ gap: 6, marginBottom: 8, minHeight: 22 }}>
                  <span className="tiny faint" style={{ lineHeight: 1.6 }}>
                    {s.ready.length
                      ? `有 ${s.ready.length} 档奖励可以领`
                      : s.next
                        ? `再收 ${s.next.need} 张到 ${Math.round(s.next.at * 100)}%：${s.next.label}`
                        : '全部收齐了'}
                  </span>
                  {s.ready.length > 0 && (
                    <button
                      className="sm warn" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
                      onClick={() => void takeSeries(s.region)}
                    >
                      领奖
                    </button>
                  )}
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  <button className="primary sm" onClick={() => void open(s.pack, 'pack')} disabled={busy || own < 1}>
                    打开（{own}）
                  </button>
                  <button
                    className="sm" style={{ whiteSpace: 'nowrap' }}
                    onClick={() => void open(s.pack, 'coins')}
                    disabled={busy || g.coins < price}
                  >
                    花 {price} 金币
                    {hot && <s className="faint" style={{ marginLeft: 4 }}>{def.cost}</s>}
                  </button>
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
          position={openingKind ? packPosition(openingKind) ?? undefined : undefined}
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
function Flip({ children, revealed, kind, position, seoul }: { children: React.ReactNode; revealed: boolean; kind: Card['kind']; position?: PackPosition; seoul?: boolean }) {
  return (
    <div className={`flip${revealed ? ' revealed' : ''}`}>
      <div className="flip-inner">
        <div className="flip-face flip-back" aria-hidden={revealed}><CardBack kind={kind} position={position} seoul={seoul} /><span className="card-specular" /></div>
        <div className="flip-face flip-front" aria-hidden={!revealed}>{children}<span className="card-specular" /></div>
      </div>
    </div>
  )
}

/**
 * The reveal.
 *
 * Keep the server's shuffled order stable throughout the reveal and summary.
 * A rare card can be first, in the middle, or last.
 */
export function PackStage({
  pulled, shown, onNext, onDone, onSellAll, position,
}: {
  pulled: Pulled[]; shown: number
  /** Position of the reward source, not the first role on a multi-role player. */
  position?: PackPosition
  onNext: () => void; onDone: () => void; onSellAll: () => void
}) {
  const [unsealed, setUnsealed] = useState(false)
  const [faceUp, setFaceUp] = useState(false)
  const kind = pulled.length && pulled.every(p => p.card.kind === 'coach') ? 'coach' : 'player'
  const seoul = pulled.length > 0 && pulled.every(p => isPlayerCard(p.card) && p.card.event === 'seoul-2024')
  const single = pulled.length === 1
  const finished = shown > pulled.length
  const current = pulled[Math.min(shown, pulled.length) - 1]
  const dupes = pulled.filter((p) => p.dupe).length
  const last = shown === pulled.length

  const advanceReveal = () => {
    if (!unsealed || finished || !current) return
    if (!faceUp) {
      setFaceUp(true)
      playPackCue('reveal')
      return
    }
    // One-card packs end on the revealed card so the collect action stays in
    // view. Multi-packs continue to the next mystery back, then to the strip.
    if (single && last) return
    setFaceUp(false)
    onNext()
  }

  const actions = (
    <div className="pack-actions">
      {dupes > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onSellAll() }}>
          分解 {dupes} 张重复卡
        </button>
      )}
      <button className="primary" onClick={(e) => { e.stopPropagation(); onDone() }}>收下</button>
    </div>
  )

  return (
    <div className="pack-stage" onClick={advanceReveal}>
      {!unsealed && <PackTearGate seoul={seoul} position={kind === 'player' ? position : undefined} kind={kind} count={pulled.length} onOpen={() => setUnsealed(true)} />}
      {unsealed && <div className="pack-reveal">
        {!finished && current && (
          <>
            <div
              key={`${current.card.id}-${shown}`}
              className={`pack-card-focus rarity-${current.card.rarity}${faceUp ? ' revealed' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={faceUp
                ? last ? '当前卡已翻开' : '查看下一张卡背'
                : `翻开第 ${shown} 张卡`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  advanceReveal()
                }
              }}
            >
              <span className="pack-rarity-motes" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
              </span>
              <CardTilt>
                <Flip seoul={seoul} position={position} kind={current.card.kind} revealed={faceUp}>
                  <CardFace card={current.card} size="lg" />
                </Flip>
              </CardTilt>
            </div>
            <div className="pack-card-meta-slot">
              {faceUp && <div className="pack-card-meta row" style={{ gap: 8, flexDirection: 'column' }}>
                <span className={`tag ${current.card.rarity === 'mythic' ? 'holo'
                  : current.card.rarity === 'gold' ? 't1' : 't2'}`}
                >
                  {RARITY_CN[current.card.rarity]}
                </span>
                {current.card.legend && (
                  <span className="small" style={{ color: '#e9dcff', textAlign: 'center' }}>
                    <b>{current.card.legend.title}</b>
                    <br />
                    <span className="tiny muted">{current.card.legend.note}</span>
                  </span>
                )}
                {current.dupe && <span className="tiny muted">重复 · 可分解 {current.salvage} 金币</span>}
              </div>}
            </div>
            {single && faceUp ? actions : (
              <div className="pack-hint" aria-live="polite">
                {shown}/{pulled.length} · {!faceUp
                  ? '点击卡背翻开'
                  : last ? '再点一次看全部' : '再点一次看下一张'}
              </div>
            )}
          </>
        )}
        {finished && (
          <>
            {/* How many cards are in this pack, said out loud. On a phone a
                ten-pack's last row can still fall below the fold, and without
                a number there is no way to tell a hidden row from a short
                pack — which is exactly what got reported. */}
            <div className="pack-strip-head tiny">
              这一包 <b>{pulled.length}</b> 张{dupes > 0 ? ` · 重复 ${dupes} 张` : ''}
            </div>
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
      </div>}
    </div>
  )
}

const REST_POSE = { x: 4, y: -20 }

/** A real pointer-driven foil seal before the first card is revealed. */
function PackTearGate({ count, kind, position, onOpen, seoul }: { count: number; kind: Card['kind']; position?: PackPosition; onOpen: () => void; seoul?: boolean }) {
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [torn, setTorn] = useState(false)
  const [pose, setPose] = useState(REST_POSE)
  const startX = useRef(0)
  const startProgress = useRef(0)
  const dragWidth = useRef(1)
  const packRect = useRef<DOMRect | null>(null)
  const progressRef = useRef(0)
  const tornRef = useRef(false)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  // A horizontal swipe on a phone is also the browser's "go back". While the
  // seal is on screen the document refuses that gesture (overscroll-behavior,
  // see .pack-open in styles.css); the pack itself sits away from the screen
  // edge on narrow screens, where the system gesture zone lives.
  useEffect(() => {
    document.documentElement.classList.add('pack-open')
    return () => document.documentElement.classList.remove('pack-open')
  }, [])

  const tear = () => {
    if (tornRef.current) return
    tornRef.current = true
    progressRef.current = 1
    setProgress(1)
    setDragging(false)
    setTorn(true)
    setPose({ x: 0, y: 0 })
    playPackCue('tear')
    if ('vibrate' in navigator) navigator.vibrate([18, 28, 35])
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    timer.current = window.setTimeout(() => {
      playPackCue('reveal')
      onOpen()
    }, reduced ? 80 : 1450)
  }

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (torn) return
    e.stopPropagation()
    // capture keeps the drag alive past the pack's edge; a browser that refuses
    // it still gets the drag while the pointer stays over the pack
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no capture: see above */ }
    startX.current = e.clientX
    startProgress.current = progress
    const rect = e.currentTarget.getBoundingClientRect()
    packRect.current = rect
    dragWidth.current = rect.width
    setDragging(true)
    playPackCue('grab')
  }

  const poseAt = (clientX: number, clientY: number) => {
    const rect = packRect.current
    if (!rect) return
    const nx = Math.max(-1, Math.min(1, (clientX - rect.left) / rect.width * 2 - 1))
    const ny = Math.max(-1, Math.min(1, (clientY - rect.top) / rect.height * 2 - 1))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setPose({ x: REST_POSE.x - ny * 5, y: REST_POSE.y + nx * 10 })
  }

  // A thumb on a phone travels in an arc, not a line, so only the sideways
  // part of the swipe counts and it does not have to go far: the seal opens
  // once the finger has crossed six tenths of the pack, or is let go past
  // the middle. It used to want seven tenths while moving and half on
  // release, which a short, curved swipe never reached — 「有时候滑不动」.
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (torn) return
    poseAt(e.clientX, e.clientY)
    if (!dragging) return
    e.stopPropagation()
    const next = Math.max(0, Math.min(1, startProgress.current + (e.clientX - startX.current) / (dragWidth.current * .55)))
    progressRef.current = next
    setProgress(next)
    if (next >= .9) tear()
  }

  const settle = () => {
    if (progressRef.current >= .45) tear()
    else {
      progressRef.current = 0
      setProgress(0)
      setPose(REST_POSE)
    }
  }

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (!dragging || torn) return
    setDragging(false)
    settle()
  }

  // The browser takes the pointer away when it decides the gesture is its own
  // — a scroll, or the edge swipe that goes back a page. A swipe already past
  // the middle still opens the pack rather than snapping shut on the player.
  const cancel = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (torn) return
    setDragging(false)
    settle()
  }

  return (
    <div className={`pack-tear-scene pack-tear-${kind}${seoul ? ' pack-tear-seoul' : ''}${position ? ' pack-tear-position' : ''}${torn ? ' torn' : ''}`} style={positionPackStyle(position)}>
      <div className="pack-tear-aura" aria-hidden="true" />
      <div className="pack-tear-kicker">{seoul ? 'CHAMPIONS SEOUL · 2024' : position ? `${POSITION_PACKS[position].label}奖励已送达` : '新卡包已送达'}</div>
      <div
        className={`pack-wrapper${dragging ? ' dragging' : ''}`}
        style={{
          '--tear': progress,
        } as React.CSSProperties}
        role="button"
        tabIndex={0}
        aria-label="向右划开卡包"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onPointerEnter={(e) => { packRect.current = e.currentTarget.getBoundingClientRect() }}
        onPointerLeave={() => { if (!dragging && !torn) setPose(REST_POSE) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            tear()
          }
        }}
      >
        <PackPouch seoul={seoul} position={position} kind={kind} count={count} progress={progress} torn={torn} pose={pose} />
        <div className="pack-card-emerge" aria-hidden="true">
          {Array.from({ length: Math.min(count - 1, 9) }, (_, i) => (
            <span className="pack-stack-card" key={i} style={{ '--stack-index': i + 1 } as React.CSSProperties} />
          ))}
          <CardBack kind={kind} position={position} seoul={seoul} />
        </div>
        <div className="pack-tear-track" aria-hidden="true">
          <span className="pack-tear-cut" />
          <span className="pack-tear-tab">→</span>
        </div>
      </div>
      <div className="pack-tear-instruction" aria-live="polite">
        {torn ? '即将揭晓' : progress > 0 ? '继续向右划' : '按住封条，向右划开'}
      </div>
      <div className="pack-tear-sub">鼠标或触屏拖动 · 也可按 Enter</div>
    </div>
  )
}
