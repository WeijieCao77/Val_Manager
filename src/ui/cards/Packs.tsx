import { useDialogFocus } from './useDialogFocus'
import { useEffect, useRef, useState } from 'react'
import { useCards } from './ctx'
import CardFace, { CardBack } from '../Card'
import { Panel } from '../common'
import {
  PACKS, PACK_ORDER, POSITION_PACK_KINDS, QUESTS, CHECKIN_COINS, DAILY_CLEAR_PACKS, HARD_PITY, SOFT_PITY, packPosition,
  collectionProgress, refreshDaily, featuredSeries, packCost, seriesOfPack, seriesProgress,
  fullSetProgress, FULL_SET_REWARD, collectProgress, bangkokOnSale, packRetired, BANGKOK_SALE_LAST, SEOUL_LAST_DAY, MULTI_OPEN_MAX,
} from '../../engine/gacha'
import type { CheckIn, CollectSeries, PackKind, Pulled, QuestKey, Series } from '../../engine/gacha'
import type { Card, Rarity } from '../../engine/cards'
import { RARITY_CN, cardById, isPlayerCard, rarityRank } from '../../engine/cards'
import { REGION_CN } from '../../engine/types'
import { track } from '../../engine/telemetry'
import { playPackCue, setSfxOn, sfxOn } from '../packAudio'
import CardTilt from './CardTilt'
import PackPouch from './PackPouch'
import { SeoulCardBack } from './SeoulDesign'
import SalvageConfirm from './SalvageConfirm'
import type { SalvageAsk } from './SalvageConfirm'
import SeoulPackDisplay from './SeoulPackDisplay'
import { SEOUL_CARDS, BANGKOK_CARDS } from '../../engine/cards'
import BangkokShelfPack from './BangkokShelfPack'
import MultiOpenSheet from './MultiOpenSheet'
import { POSITION_PACKS, positionPackStyle } from './positionPackDesign'
import type { PackPosition } from './positionPackDesign'

/** What the server says came out of a pack, resolved back to cards. */
interface PulledWire { cardId: string; dupe: boolean; salvage: number }

export default function Packs() {
  const { g, today, act, toast } = useCards()
  const [opening, setOpening] = useState<Pulled[] | null>(null)
  const [openingKind, setOpeningKind] = useState<PackKind | null>(null)
  /** how many packs the reveal on screen came from (连开) */
  const [openingPacks, setOpeningPacks] = useState(1)
  /** the 连开 sheet, open on one pack kind */
  const [multi, setMulti] = useState<PackKind | null>(null)
  const [shown, setShown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [claiming, setClaiming] = useState<string | null>(null)
  /** the reveal's 分解重复卡, waiting for the player to read the list */
  const [ask, setAsk] = useState<SalvageAsk | null>(null)

  refreshDaily(g, today)
  const prog = collectionProgress(g)
  const series = seriesProgress(g)
  const featured = featuredSeries(today)
  const fullSet = fullSetProgress(g)
  const collect = collectProgress(g)

  // The pack is rolled on the server and comes back already in the
  // collection; what happens here is the reveal.
  const open = async (kind: PackKind, payWith: 'pack' | 'coins' | 'auto', count = 1) => {
    if (busy) return
    // what 'auto' (连开: stock first, coins for the rest) actually spent, read before the stock moves
    const own = g.packs[kind] ?? 0
    const paid = payWith !== 'auto' ? payWith : count <= own ? 'pack' : own > 0 ? 'mixed' : 'coins'
    setBusy(true)
    const r = await act('open', count > 1 ? { kind, payWith, count } : { kind, payWith })
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    setMulti(null)
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
      paid,
      packs: count,
      gold: out.filter((p) => p.card.rarity === 'gold').length,
      dupes: out.filter((p) => p.dupe).length,
      // which cards, so 「我抽到过他」 can be checked against something —
      // the ten ids of a ten-pull are under a hundred bytes
      cards: out.map((p) => p.card.id).join(','),
    })
    setOpening(out)
    setOpeningKind(kind)
    setOpeningPacks(count)
    setShown(1)
  }

  // 连开 is offered wherever at least two packs could be opened, the stock and the coins together
  const buyable = (kind: PackKind) => PACKS[kind].shop !== false && !packRetired(kind, today)
  const canMulti = (kind: PackKind) =>
    (g.packs[kind] ?? 0) + (buyable(kind) ? Math.floor(g.coins / packCost(kind, today)) : 0) >= 2
  const multiButton = (kind: PackKind, className = 'sm') => canMulti(kind) && (
    <button className={className} disabled={busy} onClick={() => setMulti(kind)} title={`一次最多 ${MULTI_OPEN_MAX} 包`}>连开</button>
  )
  const bangkokPrice = packCost('bangkok2025', today)
  const bangkokSale = bangkokOnSale(today)
  const seoulGone = packRetired('seoul2024', today)
  const md = (d: string) => `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日`

  const done = () => {
    setOpening(null)
    setShown(0)
  }

  const check = async () => {
    if (claiming) return
    setClaiming('checkin')
    const r = await act('checkin').finally(() => setClaiming(null))
    if (!r.ok) { toast(r.why); return }
    const c = r.result as CheckIn
    if (!c.already) track('card_signin', { streak: c.streak })
    toast(c.already ? '今天已经签过到了。' : `签到第 ${c.streak} 天：+${c.coins} 金币，卡包已入库。`)
  }

  const claim = async (key: QuestKey) => {
    if (claiming) return
    setClaiming(key)
    const r = await act('quest', { key }).finally(() => setClaiming(null))
    if (!r.ok) { toast(r.why); return }
    toast(`任务完成，+${(r.result as { coins: number }).coins} 金币。`)
  }

  const takeSeries = async (region: Series) => {
    const r = await act('series', { region })
    if (!r.ok) { toast(r.why); return }
    toast(`系列奖励已领取：${(r.result as { got: string }).got}`)
  }

  const takeCollect = async (series: CollectSeries) => {
    const r = await act('collect', { series })
    if (!r.ok) { toast(r.why); return }
    toast(`收集奖励已领取：${(r.result as { got: string }).got}`)
  }

  const takeFullSet = async () => {
    const r = await act('fullset', {})
    if (!r.ok) { toast(r.why); return }
    toast(`全图鉴奖励已领取：${(r.result as { got: string }).got}`)
  }

  const signedToday = g.daily.claimed === today

  return (
    <>
      <div className="cm-pack-overview"><div><strong>{Object.values(g.packs).reduce((sum, n) => sum + (n ?? 0), 0)}</strong><span>个卡包待开启</span></div><div><strong>{prog.owned}<small> / {prog.total}</small></strong><span>已收藏卡牌</span></div><a href="#pack-shop" onClick={e => { e.preventDefault(); document.getElementById('pack-shop')?.scrollIntoView({ block: 'start' }) }}>挑选卡包 ↓</a></div>
      <div className="grid c2 cm-daily" style={{ alignItems: 'start' }}>
        <Panel title="每日签到" actions={<span className="tiny muted">连续 {g.daily.streak} 天</span>}>
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
            每天送 {CHECKIN_COINS} 金币和 1 个试训包；每轮第 3、6 天加送选拔包，第 7 天加送十连包。日期以服务器（北京时间）为准。
          </p>
          <div className="cm-checkin-week" aria-label="七日签到奖励">
            {Array.from({ length: 7 }, (_, i) => {
              const day = i + 1
              // the streak runs past seven, so the strip shows where in the
              // current cycle of seven it is
              const hit = g.daily.streak > 0 ? ((g.daily.streak - 1) % 7) + 1 : 0
              const on = day <= hit
              return (
                <div
                  key={i}
                  className={`cm-checkin-day${on ? ' claimed' : ''}`}
                  title={`第 ${day} 天：${CHECKIN_COINS} 金币 + 试训包${day === 7 ? ' + 十连包' : day % 3 === 0 ? ' + 选拔包' : ''}`}
                >
                  <span>第 {day} 天</span><b>{day === 7 ? '十连' : day % 3 === 0 ? '选拔' : '试训'}</b><span>{on ? '✓ 已签到' : `+${CHECKIN_COINS}`}</span>
                </div>
              )
            })}
          </div>
          <button className="primary" onClick={() => void check()} disabled={signedToday || claiming !== null}>
            {signedToday ? '今天已签到' : claiming === 'checkin' ? '领取中…' : '领取今日奖励'}
          </button>
        </Panel>

        <Panel title="今日任务" actions={<span className="tiny muted">{g.daily.taken.length}/{g.daily.picked.length}</span>}>
          {g.daily.picked.map((key) => {
            const q = QUESTS[key]
            const at = g.daily.progress[key] ?? 0
            const full = at >= q.target
            const taken = g.daily.taken.includes(key)
            return (
              <div key={key} className="cm-quest">
                <div className="cm-quest-info">
                  <div className="small">{q.label}</div>
                  <div className="tiny faint mono">{Math.min(at, q.target)}/{q.target} · +{q.reward} 金币</div>
                  <progress className="cm-quest-progress" value={Math.min(at, q.target)} max={q.target} aria-label={q.label} />
                </div>
                <button className="sm" onClick={() => void claim(key)} disabled={!full || taken || claiming !== null}>
                  {taken ? '已领取' : claiming === key ? '领取中…' : full ? '领取' : '进行中'}
                </button>
              </div>
            )
          })}
          <p className="tiny faint" style={{ marginBottom: 0 }}>全部完成加送 {DAILY_CLEAR_PACKS} 个试训包。</p>
        </Panel>
      </div>

      <section className="bk25-shelf" aria-label="曼谷 2025 大师赛系列">
        <div className="bk25-shelf-art"><BangkokShelfPack /><div className="bk25-shelf-back"><CardBack bangkok /></div></div>
        <div className="bk25-shelf-copy"><span className="bk25-eyebrow">MASTERS BANGKOK / 2025 COLLECTION</span>
          <h3>曼谷 2025 大师赛{bangkokSale && <span className="bk25-sale">上线 85 折</span>}</h3>
          <p>8 支战队 · 41 位登场选手 · 专属莲花卡背<br />每包 3 张赛事卡，至少一张银卡，不出彩卡。{bangkokSale && <><br />85 折到 {md(BANGKOK_SALE_LAST)}。</>}</p>
          <a href="/bangkok-2025">浏览完整系列 ↗</a><p>已收藏 {BANGKOK_CARDS.filter(c => g.cards[c.id]).length} / {BANGKOK_CARDS.length}</p>
          <div className="row"><button disabled={busy || g.coins < bangkokPrice} onClick={() => void open('bangkok2025', 'coins')}>{bangkokPrice} 金币{bangkokSale && <s>{PACKS.bangkok2025.cost}</s>} · 开启曼谷包</button>
            {(g.packs.bangkok2025 ?? 0) > 0 && <button className="bk25-shelf-secondary" disabled={busy} onClick={() => void open('bangkok2025', 'pack')}>打开库存（{g.packs.bangkok2025}）</button>}
            {multiButton('bangkok2025', 'bk25-shelf-secondary')}</div>
        </div>
      </section>

      <section className="seoul-shelf" aria-label="首尔 2024 冠军赛系列">
        <div className="seoul-shelf-art"><SeoulPackDisplay /><SeoulCardBack /></div>
        <div className="seoul-shelf-copy"><span className="seoul-eyebrow">CHAMPIONS SEOUL / 2024 COLLECTION</span>
          <h3>首尔 2024 冠军赛</h3>
          <p>16 支战队 · 80 位登场选手 · 专属黑金卡背<br />每包 3 张赛事卡，至少一张银卡，不出彩卡。<br />{seoulGone ? '首尔包已下线，库存里的仍可打开。' : `首尔包 ${md(SEOUL_LAST_DAY)}后下线，库存里的仍可打开。`}</p>
          <a href="/seoul-2024">浏览完整系列 ↗</a><p>已收藏 {SEOUL_CARDS.filter(c => g.cards[c.id]).length} / 80</p>
          <div className="row">{!seoulGone && <button disabled={busy || g.coins < PACKS.seoul2024.cost} onClick={() => void open('seoul2024', 'coins')}>{PACKS.seoul2024.cost} 金币 · 开启首尔包</button>}
            {(g.packs.seoul2024 ?? 0) > 0 && <button className="seoul-shelf-secondary" disabled={busy} onClick={() => void open('seoul2024', 'pack')}>打开库存（{g.packs.seoul2024}）</button>}
            {multiButton('seoul2024', 'seoul-shelf-secondary')}</div>
        </div>
      </section>

      <div id="pack-shop" className="cm-section-anchor" />
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
          用金币随时买，不限次数。十连包不卖，可通过升段、夺冠、连签、挑战和赛事预测等玩法获得。
        </p>
        <div className="pack-shelf">
          {(g.packs.legend ?? 0) > 0 && (
            <div className="pack-box" style={{ borderColor: 'var(--mythic, var(--warn))' }}>
              <h4>
                {PACKS.legend.name}
                <span className="pack-own"> ×{g.packs.legend}</span>
              </h4>
              <p>{PACKS.legend.blurb}</p>
              <div className="row" style={{ gap: 6 }}>
                <button className="primary sm" onClick={() => void open('legend', 'pack')} disabled={busy}>
                  打开（{g.packs.legend}）
                </button>
                {multiButton('legend')}
                <span className="tiny faint" style={{ alignSelf: 'center' }}>非卖品</span>
              </div>
            </div>
          )}
          {PACK_ORDER.filter((k) => !seriesOfPack(k) && k !== 'seoul2024' && k !== 'bangkok2025').map((kind) => {
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
                  {multiButton(kind)}
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
                  <div className="row" style={{ gap: 6 }}>
                    <button className="primary sm" onClick={() => void open(kind, 'pack')} disabled={busy || own < 1}>打开（{own}）</button>
                    {multiButton(kind)}
                  </div>
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
                  {multiButton(s.pack)}
                </div>
              </div>
            )
          })}
        </div>
        {/* 全图鉴: every 选手卡 and coach (no 彩卡, no series cards), and the one pack that deals nothing else. */}
        <div
          className="row wrap"
          style={{
            gap: 10, alignItems: 'center', marginTop: 10, padding: '8px 10px',
            border: '1px solid var(--line)', borderRadius: 8,
            borderColor: fullSet.ready ? 'var(--warn)' : undefined,
          }}
        >
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <b style={{ fontSize: 13 }}>全图鉴</b>
              <span className="tiny mono faint">{fullSet.owned}/{fullSet.total}（{Math.floor((fullSet.owned / Math.max(1, fullSet.total)) * 100)}%）</span>
            </div>
            <div
              style={{
                height: 5, borderRadius: 3, background: 'var(--panel-2)',
                border: '1px solid var(--line)', overflow: 'hidden', margin: '5px 0',
              }}
            >
              <div
                style={{
                  width: `${(fullSet.owned / Math.max(1, fullSet.total)) * 100}%`, height: '100%',
                  background: fullSet.owned >= fullSet.total ? 'var(--good)' : 'var(--accent)',
                }}
              />
            </div>
            <span className="tiny faint" style={{ lineHeight: 1.6 }}>
              {fullSet.claimed
                ? '全部收齐，彩卡包已领。'
                : fullSet.ready
                  ? `全部收齐了：${PACKS[FULL_SET_REWARD.pack].name} ×${FULL_SET_REWARD.count} 可以领`
                  : `收齐全部选手卡和教练卡（彩卡、首尔卡、曼谷卡不计），送${PACKS[FULL_SET_REWARD.pack].name} ×${FULL_SET_REWARD.count}——只出彩卡的包。还差 ${fullSet.total - fullSet.owned} 张。`}
            </span>
          </div>
          {fullSet.ready && (
            <button className="sm warn" style={{ whiteSpace: 'nowrap' }} onClick={() => void takeFullSet()}>
              领奖
            </button>
          )}
        </div>
        {/* 退役 / 首尔 / 曼谷: each set pays its own ladder (彩卡 not counted) */}
        {collect.map((c) => {
          const pct = Math.floor((c.owned / Math.max(1, c.total)) * 100)
          return (
            <div
              key={c.series}
              className="row wrap"
              style={{
                gap: 10, alignItems: 'center', marginTop: 8, padding: '8px 10px',
                border: '1px solid var(--line)', borderRadius: 8,
                borderColor: c.ready.length ? 'var(--warn)' : undefined,
              }}
            >
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <b style={{ fontSize: 13 }}>{c.name}</b>
                  <span className="tiny mono faint">{c.owned}/{c.total}（{pct}%）</span>
                </div>
                <div
                  style={{
                    height: 5, borderRadius: 3, background: 'var(--panel-2)',
                    border: '1px solid var(--line)', overflow: 'hidden', margin: '5px 0',
                  }}
                >
                  <div style={{ width: `${pct}%`, height: '100%', background: c.owned >= c.total ? 'var(--good)' : 'var(--accent)' }} />
                </div>
                <span className="tiny faint" style={{ lineHeight: 1.6 }}>
                  {c.ready.length
                    ? `有 ${c.ready.length} 档奖励可以领`
                    : c.next
                      ? `再收 ${c.next.need} 张到 ${Math.round(c.next.at * 100)}%：${c.next.label}`
                      : '全部收齐了'}
                </span>
              </div>
              {c.ready.length > 0 && (
                <button className="sm warn" style={{ whiteSpace: 'nowrap' }} onClick={() => void takeCollect(c.series)}>
                  领奖
                </button>
              )}
            </div>
          )
        })}
      </Panel>

      {opening && (
        <PackStage
          pulled={opening}
          packs={openingPacks}
          shown={shown}
          position={openingKind ? packPosition(openingKind) ?? undefined : undefined}
          // ceiling is length + 1, not length: `finished` is `shown >
          // pulled.length`, so clamping at length meant the last card of a
          // multi-card pack could never be got past — the reveal sat on 3/3
          // and swallowed every click
          onNext={() => setShown((n) => Math.min(n + 1, opening.length + 1))}
          onDone={done}
          onSellAll={() => {
            // one spare per card named, which is what salvage_dupes sells —
            // a pack holding the same dupe twice still lists it once
            const seen = new Set<string>()
            const lines = opening
              .filter((p) => p.dupe && !seen.has(p.card.id) && seen.add(p.card.id))
              .map((p) => ({ cardId: p.card.id, count: 1, coins: p.salvage }))
            if (!lines.length) { toast('这一包没有重复卡。'); return }
            setAsk({
              lines,
              onConfirm: async () => {
                setBusy(true)
                const r = await act('salvage_dupes', { cardIds: lines.map((l) => l.cardId) })
                setBusy(false)
                setAsk(null)
                if (!r.ok) { toast(r.why); return }
                const coins = (r.result as { coins: number }).coins
                toast(coins ? `重复卡已分解，+${coins} 金币。` : '这一包的重复卡已经分解过了。')
              },
            })
          }}
        />
      )}
      {ask && <SalvageConfirm ask={ask} busy={busy} onClose={() => { if (!busy) setAsk(null) }} />}
      {multi && (
        <MultiOpenSheet
          kind={multi} own={g.packs[multi] ?? 0} coins={g.coins} price={packCost(multi, today)} buyable={buyable(multi)} busy={busy}
          onOpen={(count) => void open(multi, 'auto', count)} onClose={() => { if (!busy) setMulti(null) }}
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
function Flip({ children, revealed, kind, position, seoul, bangkok, retired }: { children: React.ReactNode; revealed: boolean; kind: Card['kind']; position?: PackPosition; seoul?: boolean; bangkok?: boolean; retired?: boolean }) {
  return (
    <div className={`flip${revealed ? ' revealed' : ''}`}>
      <div className="flip-inner">
        <div className="flip-face flip-back" aria-hidden={revealed}><CardBack kind={kind} position={position} seoul={seoul} bangkok={bangkok} retired={retired} /><span className="card-specular" /></div>
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
  pulled, shown, onNext, onDone, onSellAll, position, packs = 1,
}: {
  pulled: Pulled[]; shown: number
  /** 连开: how many packs these cards came out of */
  packs?: number
  /** Position of the reward source, not the first role on a multi-role player. */
  position?: PackPosition
  onNext: () => void; onDone: () => void; onSellAll: () => void
}) {
  const [unsealed, setUnsealed] = useState(false)
  const [faceUp, setFaceUp] = useState(false)
  const kind = pulled.length && pulled.every(p => p.card.kind === 'coach') ? 'coach' : 'player'
  const seoul = pulled.length > 0 && pulled.every(p => isPlayerCard(p.card) && p.card.event === 'seoul-2024')
  const bangkok = pulled.length > 0 && pulled.every(p => isPlayerCard(p.card) && p.card.event === 'bangkok-2025')
  const retired = pulled.length > 0 && pulled.every(p => isPlayerCard(p.card) && p.card.event === 'retired')
  // 连开's recap leads with the best cards; a single pack keeps the order it was dealt in
  const recap = packs > 1
    ? pulled.map((p, i) => ({ p, i })).sort((a, b) => rarityRank(b.p.card.rarity) - rarityRank(a.p.card.rarity) || Number(a.p.dupe) - Number(b.p.dupe) || a.i - b.i).map(x => x.p)
    : pulled
  const single = pulled.length === 1
  const [revealAll, setRevealAll] = useState(false)
  const dialogRef = useDialogFocus(onDone)
  const finished = revealAll || shown > pulled.length
  const current = pulled[Math.min(shown, pulled.length) - 1]
  const dupes = pulled.filter((p) => p.dupe).length
  const last = shown === pulled.length

  // each new back as it arrives — a gold or 彩卡 back already sounds like one — and the landing at the end
  useEffect(() => {
    if (unsealed && !finished && current && !faceUp) playPackCue('back', current.card.rarity)
  }, [unsealed, shown])
  useEffect(() => {
    if (!unsealed || !finished) return
    // a skipped pack never heard its best card turn, so it hears it now
    const best = revealAll
      ? pulled.reduce<Rarity>((b, p) => (rarityRank(p.card.rarity) > rarityRank(b) ? p.card.rarity : b), 'bronze')
      : 'bronze'
    playPackCue('summary', best, pulled.length)
  }, [finished, unsealed])

  const advanceReveal = () => {
    if (!unsealed || finished || !current) return
    if (!faceUp) {
      setFaceUp(true)
      playPackCue('reveal', current.card.rarity)
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
    <div className="pack-stage" ref={dialogRef} role="dialog" aria-modal="true" aria-label="开启卡包" tabIndex={-1} onClick={advanceReveal}>
      <SoundToggle />
      {!finished && <button className="pack-skip" onClick={e => { e.stopPropagation(); setUnsealed(true); setRevealAll(true) }}>查看全部 · 跳过动画</button>}
      {!unsealed && <PackTearGate seoul={seoul} bangkok={bangkok} packs={packs} position={kind === 'player' ? position : undefined} kind={kind} count={Math.max(1, Math.round(pulled.length / packs))} onOpen={() => setUnsealed(true)} />}
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
                <Flip seoul={seoul} bangkok={bangkok} retired={retired} position={position} kind={current.card.kind} revealed={faceUp}>
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
              {packs > 1 ? <>连开 <b>{packs}</b> 包 · 共 <b>{pulled.length}</b> 张</> : <>这一包 <b>{pulled.length}</b> 张</>}
              {dupes > 0 ? ` · 重复 ${dupes} 张` : ''}
              {packs > 1 && ` · 新卡 ${pulled.length - dupes} 张`}
            </div>
            <div className={`pack-strip${pulled.length > 10 ? ' pack-strip-many' : ''}`} style={stripLayout(pulled.length)}>
              {recap.map((p, i) => (
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

/**
 * How the recap lays a pack out: columns and rows on a wide screen and on a
 * phone. Every card was drawn at 96px (75 on a phone) whatever the pack, so a
 * one-card pack showed one tiny card whose name could not be read. The CSS
 * turns these into the biggest width that still fits the screen's width and
 * height, capped per pack size.
 */
function stripLayout(n: number): React.CSSProperties {
  // 连开 can bring back a hundred cards: past ten the recap stops shrinking to fit one screen and
  // scrolls instead, sized as if three rows had to fit (four on a phone)
  if (n > 10) return { '--cols-d': 6, '--rows-d': 3, '--cols-m': 4, '--rows-m': 4, '--card-max': '120px' } as React.CSSProperties
  const [cols, colsM, max] = n <= 1 ? [1, 1, 220] : n <= 3 ? [n, n, 170] : n <= 5 ? [n, 3, 150] : [5, 4, 140]
  return {
    '--cols-d': cols, '--rows-d': Math.ceil(n / cols),
    '--cols-m': colsM, '--rows-m': Math.ceil(n / colsM),
    '--card-max': `${max}px`,
  } as React.CSSProperties
}

const REST_POSE = { x: 4, y: -20 }

/** A real pointer-driven foil seal before the first card is revealed. */
function PackTearGate({ count, kind, position, onOpen, seoul, bangkok, packs = 1 }: { count: number; kind: Card['kind']; position?: PackPosition; onOpen: () => void; seoul?: boolean; bangkok?: boolean; packs?: number }) {
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
      playPackCue('burst')
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
    <div className={`pack-tear-scene pack-tear-${kind}${seoul ? ' pack-tear-seoul' : ''}${bangkok ? ' pack-tear-bangkok' : ''}${position ? ' pack-tear-position' : ''}${torn ? ' torn' : ''}`} style={positionPackStyle(position)}>
      <div className="pack-tear-aura" aria-hidden="true" />
      <div className="pack-tear-kicker">{bangkok ? 'MASTERS BANGKOK · 2025' : seoul ? 'CHAMPIONS SEOUL · 2024' : position ? `${POSITION_PACKS[position].label}奖励已送达` : '新卡包已送达'}{packs > 1 ? ` · 连开 ${packs} 包` : ''}</div>
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
        <PackPouch seoul={seoul} bangkok={bangkok} position={position} kind={kind} count={count} progress={progress} torn={torn} pose={pose} />
        <div className="pack-card-emerge" aria-hidden="true">
          {Array.from({ length: Math.min(count - 1, 9) }, (_, i) => (
            <span className="pack-stack-card" key={i} style={{ '--stack-index': i + 1 } as React.CSSProperties} />
          ))}
          <CardBack kind={kind} position={position} seoul={seoul} bangkok={bangkok} />
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

/** 音效 on the reveal: its own switch, not the music's (packAudio.ts) */
function SoundToggle() {
  const [on, setOn] = useState(sfxOn)
  return (
    <button
      className="pack-sound"
      aria-pressed={on}
      aria-label={on ? '关闭音效' : '打开音效'}
      onClick={(e) => {
        e.stopPropagation()
        setSfxOn(!on)
        setOn(!on)
        if (!on) playPackCue('grab')
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10v4h3l5 4V6l-5 4z" />
        {on ? <path d="M16 9a4 4 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11" /> : <path d="M16 9l5 6 M21 9l-5 6" />}
      </svg>
      <span>音效{on ? '' : '关'}</span>
    </button>
  )
}
