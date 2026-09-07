/**
 * 交易区 — an auction house.
 *
 * The thing to understand before reading any of this: both sides pay in when
 * they act. Listing takes the card off your side now, bidding takes the
 * coins — and whatever happens, the escrow comes back through the inbox. That
 * is what stops a player who never returns from stranding the other one, and
 * it is why every button here changes your save immediately rather than at
 * some settlement in the future.
 *
 * A listing is a starting price and a day on the clock; the top bid when the
 * clock runs out takes the card, and the seller has no say in whose. That
 * replaced a market where the seller picked among offers, which the group
 * used to park a dozen people's coins on a card that was never sold and to
 * hand cards to friends under better bids. A bid is binding both ways, a beaten
 * bid is refunded the moment it is beaten, and a bid in the last ten minutes
 * buys everyone ten more. Listings from before the change still show the old
 * offer-and-answer controls until they run out.
 */
import { useCallback, useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import CardFace from '../Card'
import { cardById, isPlayerCard } from '../../engine/cards'
import { collection, levelOf } from '../../engine/gacha'
import {
  AUCTION_HOURS, BID_STEP, BUYOUT_MIN, MAX_LISTINGS, SNIPE_MINUTES,
  answerOffer, askFloorOf, bidOn, browseMarket, listCardOnMarket, minBidOf, myOffers, unlistCard, withdrawOffer,
} from '../../engine/market'
import type { Gate, Listing, Offer } from '../../engine/market'
import { takeServer } from '../../engine/account'
import { CardFilters, EMPTY_FILTER, matchesFilter } from './Filters'
import { CardPicker, matchesQuery } from './Picker'
import type { CardFilter } from './Filters'

/** the old listings' haggling room, for the ones still running out */
const HAGGLE = 0.1
const money = (n: number) => n.toLocaleString('en-US')
const nameOf = (id: string) => {
  const c = cardById(id)
  return c ? (isPlayerCard(c) ? c.ign : c.name) : id
}

/** How long an auction has left, in words. */
const left = (ends: number | null | undefined, now: number): string => {
  if (ends == null) return ''
  const ms = ends - now
  if (ms <= 0) return '结算中'
  const m = Math.ceil(ms / 60000)
  if (m < 60) return `剩 ${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return `剩 ${h} 小时${rest ? ` ${rest} 分` : ''}`
}

export default function Market() {
  const { g, commit, toast, cloud } = useCards()
  const level = (id: string) => levelOf(g, id)
  const [shelf, setShelf] = useState<Listing[] | null>(null)
  /** the shelf's own search box — the same rule the listing menu uses */
  const [q, setQ] = useState('')
  /** how many listings are open in all, and how many of other people's the shelf shows */
  const [size, setSize] = useState<{ total: number; shelf: number } | null>(null)
  const [inbound, setInbound] = useState<Offer[]>([])
  const [outbound, setOutbound] = useState<Offer[]>([])
  const [days, setDays] = useState(3)
  // null once the account has played enough; until then it is how far off it is
  const [gate, setGate] = useState<Gate | null>(null)
  const [busy, setBusy] = useState(false)
  const [sellCard, setSellCard] = useState('')
  const [ask, setAsk] = useState('')
  const [buyout, setBuyout] = useState('')
  const [bidOpen, setBidOpen] = useState<Listing | null>(null)
  const [bidPrice, setBidPrice] = useState('')
  // the clock the countdowns read; the server's idea of now, carried forward
  const [now, setNow] = useState(Date.now())
  // the shelf's filter. The sell menu has its own, inside the picker: what
  // you are looking to buy and what you are looking to get rid of are two
  // different questions, and a hundred-line menu answers neither
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER)

  const refresh = useCallback(async () => {
    const [b, o] = await Promise.all([browseMarket(), myOffers()])
    if (b?.ok) {
      setShelf(b.listings)
      setGate(b.gate ?? null)
      setSize(typeof b.total === 'number' && typeof b.shelf === 'number' ? { total: b.total, shelf: b.shelf } : null)
      if (typeof b.now === 'number') setNow(b.now)
    }
    else setShelf([])
    if (o?.ok) { setInbound(o.inbound); setOutbound(o.outbound); setDays(o.days) }
  }, [])

  useEffect(() => { if (cloud) void refresh() }, [cloud, refresh])
  // an auction moves without anyone here clicking: the countdowns tick every
  // half minute and the shelf is re-read every couple of minutes, so a sale
  // or a beaten bid shows up without a reload
  useEffect(() => {
    if (!cloud) return
    const tick = setInterval(() => setNow((t) => t + 30_000), 30_000)
    const poll = setInterval(() => { void refresh() }, 120_000)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [cloud, refresh])

  // Anything in the collection can be sold, spare or not: somebody who pulls a
  // 彩卡 he has no use for and wants to keep opening packs is exactly who this
  // is for. A spare goes first and goes out unupgraded.
  const sellable = collection(g).sort((a, b) => b.rating - a.rating)

  const doList = async () => {
    const card = cardById(sellCard)
    const price = Math.round(Number(ask))
    if (!card || !Number.isFinite(price)) { toast('先选一张卡，填个起拍价。'); return }
    const now2 = buyout.trim() === '' ? null : Math.round(Number(buyout))
    if (now2 != null && (!Number.isFinite(now2) || now2 < Math.ceil(price * BUYOUT_MIN))) {
      toast(`一口价至少要 ${money(Math.ceil(price * BUYOUT_MIN))}（起拍价的 ${BUYOUT_MIN} 倍），不想设就留空。`)
      return
    }
    setBusy(true)
    // taken off this side only after the server has the listing, so a failed
    // request can never eat the card
    const r = await listCardOnMarket(sellCard, price, level(sellCard), card.rarity, now2)
    setBusy(false)
    if (!r?.ok) {
      toast(r?.newbie ? `再开 ${Number(r.need) - Number(r.have)} 抽就能用交易区了（已开 ${r.have}/${r.need}）。`
        : r?.notOwned ? '服务器上还没看到这张卡，稍等一下再挂。'
        : r?.alreadyListed ? '这张卡已经挂上去了。'
          : r?.full ? `最多同时挂 ${r.max ?? MAX_LISTINGS} 张，卖掉或撤回一张再挂。`
            : r?.badBuyout ? `一口价要在 ${money(Number(r.min ?? 0))} ~ 500,000 之间，不想设就留空。`
            : r?.bad ? `起拍价要在 ${money(Number(r.min ?? 50))} ~ 500,000 之间（最低不能低于分解价）。`
              : '挂不上去，等会儿再试。')
      return
    }
    // the card left the server's copy of the account when it took the listing
    if (r.state) takeServer(g, r.state, r.rev)
    void commit()
    setSellCard(''); setAsk(''); setBuyout('')
    toast(`${nameOf(sellCard)} 已挂出，起拍 ${money(price)}${now2 != null ? `，一口价 ${money(now2)}` : ''}。${AUCTION_HOURS} 小时后按最高价成交，没人出价原样退回。`)
    void refresh()
  }

  /** the shape of a reply to a bid, whichever way it went */
  const afterBid = (r: Awaited<ReturnType<typeof bidOn>>, price: number) => {
    if (!r?.ok) {
      toast(r?.newbie ? `再开 ${Number(r.need) - Number(r.have)} 抽就能用交易区了（已开 ${r.have}/${r.need}）。`
        : r?.low ? `现在至少要出 ${money(Number(r.min ?? 0))}。`
        : r?.leading ? '你已经是最高价了，等别人超过你再加。'
        : r?.range ? `只能在 ${r.lo} ~ ${r.hi} 之间还价（这是旧规则的挂牌，标价 ±10%）。`
        : r?.broke ? '金币不够。'
          : r?.already ? '你已经对这张牌出过价了。'
            : r?.self ? '这是你自己的挂牌。' : '这张牌已经不在了，可能刚刚成交。')
      void refresh()
      return
    }
    // and the coins left it when it took the bid
    if (r.state) takeServer(g, r.state, r.rev)
    void commit()
    setBidOpen(null); setBidPrice('')
    const paid = typeof r.price === 'number' ? r.price : price
    toast(r.bought ? `一口价成交，${money(paid)} 金币换来的卡会到你的信箱。`
      : `已出价 ${money(paid)}，目前领先。被超过会立刻退回金币；到时没人超过就是你的。`)
    void refresh()
  }

  const doBid = async () => {
    if (!bidOpen) return
    const price = Math.round(Number(bidPrice))
    if (!Number.isFinite(price)) return
    if (g.coins < price) { toast('金币不够。'); return }
    setBusy(true)
    const r = await bidOn(bidOpen.id, price)
    setBusy(false)
    afterBid(r, price)
  }

  const buyNow = async (l: Listing) => {
    if (l.buyout == null) return
    if (g.coins < l.buyout) { toast('金币不够。'); return }
    setBusy(true)
    const r = await bidOn(l.id, l.buyout)
    setBusy(false)
    afterBid(r, l.buyout)
  }

  // the old listings only: an auction settles itself
  const answer = async (o: Offer, accept: boolean) => {
    setBusy(true)
    const r = await answerOffer(o.id, accept)
    setBusy(false)
    if (!r?.ok) { toast(r?.auction ? '竞拍到时自动成交，不用你选。' : '这个报价已经失效了。'); void refresh(); return }
    toast(accept ? `成交，${money(o.price)} 金币会到你的信箱。` : '已拒绝。对方的金币退回给他。')
    void refresh()
  }

  // the buyer's side of 撤回, on an old listing: a bid the seller has not
  // answered is his to take back. On an auction a bid is binding.
  const takeBack = async (o: Offer) => {
    setBusy(true)
    const r = await withdrawOffer(o.id)
    setBusy(false)
    if (!r?.ok) { toast(r?.binding ? '竞拍的出价不能撤回，被别人超过才会退。' : '这个报价已经不在了。'); void refresh(); return }
    toast(`已撤回，${money(o.price)} 金币会回到你的信箱。`)
    void refresh()
  }

  const pull = async (l: Listing) => {
    setBusy(true)
    const r = await unlistCard(l.id)
    setBusy(false)
    if (!r?.ok) { toast(r?.bound ? '已经有人出价了，撤不回来。' : '这张挂牌已经不在了。'); void refresh(); return }
    // it comes home through the inbox, like everything else
    toast('已撤回，卡会回到你的信箱。')
    void refresh()
  }

  if (!cloud) {
    return (
      <Panel title="交易区">
        <p className="empty">交易区要连上服务器才能用。现在是「仅本机」模式。</p>
      </Panel>
    )
  }

  const mineOnShelf = (shelf ?? []).filter((l) => l.mine)
  const theirsAll = (shelf ?? []).filter((l) => !l.mine)
  const shelfCards = theirsAll.map((l) => cardById(l.cardId)).filter((c): c is NonNullable<typeof c> => !!c)
  const theirs = theirsAll.filter((l) => { const c = cardById(l.cardId); return !!c && matchesFilter(c, filter) && matchesQuery(c, q) })
  const legacyInbound = inbound.filter((o) => o.ends == null)
  const askNum = Math.round(Number(ask))
  const buyoutFloor = Number.isFinite(askNum) && askNum > 0 ? Math.ceil(askNum * BUYOUT_MIN) : null

  return (
    <>
      {gate && (
        <Panel title="交易区还没对你开放">
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
            开够 <b>{gate.need} 抽</b>才能挂牌和出价，你现在 <b>{gate.have}</b> 抽，
            还差 <b>{gate.need - gate.have}</b> 抽。签到送的包也算。
          </p>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (gate.have / gate.need) * 100)}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
          <p className="tiny faint" style={{ marginBottom: 0, lineHeight: 1.7 }}>
            这道门槛是防小号的：有人开一堆新号，把新手包和签到的卡搬给大号。
            养一个号到能交易的成本，比它能搬走的那几张卡高得多，这条路就不划算了。
            <b>货架随便看</b>——只是还不能买卖。
          </p>
        </Panel>
      )}

      <Panel
        title="挂一张卡出去"
        actions={
          <span className="tiny muted">
            {/* three at once, by the owner's rule: a shelf is for the card you
                want gone, not a shop window. Counted by the server at the
                moment of listing, so anything up before the cap stays up. */}
            已挂 <b className={mineOnShelf.length >= MAX_LISTINGS ? 'neg' : ''}>{mineOnShelf.length}/{MAX_LISTINGS}</b>
            {' · '}{AUCTION_HOURS} 小时竞拍
          </span>
        }
      >
        <CardPicker
          rows={sellable.map(({ card, owned }) => ({
            card,
            note: owned.dupes > 0 ? `多 ${owned.dupes} 张` : owned.level > 0 ? `+${owned.level}` : '仅此一张',
          }))}
          value={sellCard}
          onChange={setSellCard}
          placeholder="选一张卡"
        />
        <div className="row wrap" style={{ gap: 6 }}>
          <input
            style={{ flex: '1 1 110px' }}
            type="number"
            placeholder={sellCard ? `起拍价，最低 ${askFloorOf(cardById(sellCard)?.rarity ?? '')}` : '起拍价'}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
          />
          <input
            style={{ flex: '1 1 110px' }}
            type="number"
            placeholder={buyoutFloor ? `一口价（可空，≥ ${money(buyoutFloor)}）` : '一口价（可空）'}
            value={buyout}
            onChange={(e) => setBuyout(e.target.value)}
          />
          <button
            className="primary" onClick={() => void doList()}
            disabled={busy || !sellCard || !ask || !!gate || mineOnShelf.length >= MAX_LISTINGS}
          >
            挂出
          </button>
        </div>
        {mineOnShelf.length >= MAX_LISTINGS && (
          <p className="tiny" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>
            最多同时挂 {MAX_LISTINGS} 张。卖掉或撤回一张，就能再挂。
          </p>
        )}
        <p className="tiny faint" style={{ marginBottom: 0, lineHeight: 1.7 }}>
          <b>竞拍 {AUCTION_HOURS} 小时，到时最高价成交</b>，谁出得高卖给谁，你不用选。
          没人出价原样退回信箱；<b>有人出价之后就不能撤回了</b>。
          一口价可以不填，填了就是「谁按这个价出，立刻成交」，至少要起拍价的 {BUYOUT_MIN} 倍。
          <b>最多同时挂 {MAX_LISTINGS} 张</b>；挂出的一刻卡就从你这边拿走了。
          有重复的先走重复那张（重复卡是没强化过的），只有一张时连强化等级一起过去。
        </p>
      </Panel>

      {(legacyInbound.length > 0 || mineOnShelf.length > 0) && (
        <Panel
          title="我挂的牌"
          actions={<span className="tiny muted">到时自动成交</span>}
        >
          {legacyInbound.map((o) => (
            <div key={o.id} className="row wrap" style={{ gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: '1 1 200px' }}>
                <b>{nameOf(o.cardId)}</b>
                <span className="tiny faint"> · 旧规则挂牌 · 挂 {money(o.ask)}</span>
                <div className="tiny muted">
                  {o.who} 出价 <b className={o.price >= o.ask ? 'pos' : 'neg'}>{money(o.price)}</b>
                  {typeof o.ignored === 'number' && o.ignored > 0 && (
                    <span className="neg"> · 已经错过 {o.ignored} 次，满 3 次自动下架</span>
                  )}
                </div>
              </div>
              <button className="sm primary" disabled={busy} onClick={() => void answer(o, true)}>接受</button>
              <button className="sm" disabled={busy} onClick={() => void answer(o, false)}>拒绝</button>
            </div>
          ))}
          {mineOnShelf.map((l) => (
            <div key={l.id} className="row wrap" style={{ gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: '1 1 200px' }}>
                <b>{nameOf(l.cardId)}</b>
                <span className="tiny faint"> · 起拍 {money(l.ask)}{l.buyout != null ? ` · 一口价 ${money(l.buyout)}` : ''}</span>
                <div className="tiny muted">
                  {l.ends == null
                    ? (l.offers ? `${l.offers} 个报价，最高 ${money(l.best ?? 0)}` : '还没有人出价（旧规则挂牌）')
                    : l.best != null
                      ? <>当前最高 <b className="pos">{money(l.best)}</b>{l.bids > 1 ? `，${l.bids} 人出过价` : ''} · {left(l.ends, now)}</>
                      : <>还没有人出价 · {left(l.ends, now)}</>}
                </div>
              </div>
              <button
                className="sm ghost" disabled={busy || (l.ends != null && l.offers > 0)}
                title={l.ends != null && l.offers > 0 ? '已经有人出价，不能撤回' : undefined}
                onClick={() => void pull(l)}
              >
                撤回
              </button>
            </div>
          ))}
        </Panel>
      )}

      {outbound.length > 0 && (
        <Panel title="我出的价" actions={<span className="tiny muted">金币托管中</span>}>
          {outbound.map((o) => (
            <div key={o.id} className="row" style={{ gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: 1 }}>
                <b>{nameOf(o.cardId)}</b>
                <span className="tiny faint"> · 卖家 {o.who} · 起拍 {money(o.ask)}</span>
                {o.ends != null && (
                  <div className="tiny"><span className="pos">领先</span> · {left(o.ends, now)}</div>
                )}
              </div>
              <span className="mono">{money(o.price)}</span>
              {o.ends == null && (
                <button className="sm ghost" disabled={busy} onClick={() => void takeBack(o)}>撤回</button>
              )}
            </div>
          ))}
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            这些金币已经从你身上扣掉、由服务器托管。到时没人超过你，卡就到你的信箱；被超过的那一刻金币退回信箱。
            竞拍的出价不能撤回。
          </p>
        </Panel>
      )}

      <Panel
        title="货架"
        actions={<span className="tiny muted">{theirs.length} 张在拍{theirs.length !== theirsAll.length ? `（共 ${theirsAll.length}）` : ''}{size && size.total > theirsAll.length + mineOnShelf.length ? `，全站 ${size.total} 张，只显示 ${size.shelf} 张` : ''}</span>}
      >
        {/* The filter belongs to the thing it filters. It used to be its own
            panel at the top of the page, two panels away from the shelf and
            right above the listing menu — which has its own — and read as
            if it filtered that. */}
        {theirsAll.length > 0 && (
          <CardFilters
            value={filter}
            onChange={setFilter}
            pool={shelfCards}
            extra={
              <input
                className="sm"
                style={{ width: 150, padding: '4px 7px' }}
                placeholder="搜 ID / 战队"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            }
          />
        )}
        {shelf === null ? <p className="empty">读取中…</p>
          : theirsAll.length === 0 ? <p className="empty">现在没有人在卖东西。挂一张上去试试。</p>
            : theirs.length === 0 ? <p className="empty">货架上没有符合筛选的卡。</p>
            : (
              <div className="market-shelf">
                {theirs.map((l) => {
                  const card = cardById(l.cardId)
                  if (!card) return null
                  const auction = l.ends != null
                  const lo = Math.ceil(l.ask * (1 - HAGGLE))
                  const hi = Math.floor(l.ask * (1 + HAGGLE))
                  const min = auction ? (l.min ?? minBidOf(l.ask, l.best)) : l.ask
                  // One card, one level, spares beside it: two copies at two
                  // levels cannot both be kept. Buying a card you already hold
                  // higher spends real coins on a spare, so say so on the shelf
                  // rather than in the mailbox afterwards.
                  const mine = g.cards[l.cardId]
                  const lands = !mine ? ''
                    : l.level > (mine.level ?? 0)
                      ? `你有 +${mine.level}，买来升到 +${l.level}`
                      : l.level > 0
                        ? `你已有 +${mine.level}，买来只当重复卡`
                        : '你已有，买来是重复卡'
                  const dear = !!mine && l.level > 0 && l.level <= (mine.level ?? 0)
                  return (
                    <div key={l.id} className="market-box">
                      <CardFace card={card} level={l.level} size="sm" />
                      <div className="tiny mono" style={{ marginTop: 4 }}>
                        {auction && l.best != null
                          ? <>当前 <b>{money(l.best)}</b></>
                          : <>{auction ? '起拍 ' : ''}{money(l.ask)} 金币</>}
                      </div>
                      {auction && l.buyout != null && (
                        <div className="tiny faint">一口价 {money(l.buyout)}</div>
                      )}
                      {lands && (
                        <div className={`tiny ${dear ? 'warn' : 'faint'}`}>{lands}</div>
                      )}
                      <div className="tiny faint market-seller">{l.seller}</div>
                      <div className="tiny faint" style={{ minHeight: '1.4em' }}>
                        {auction
                          ? `${l.bids > 0 ? `${l.bids} 人出价 · ` : ''}${left(l.ends, now)}`
                          : (l.offers > 0 ? `${l.offers} 人出价 · 旧规则` : '旧规则')}
                      </div>
                      <div className="grow" />
                      {l.bid ? (
                        <span className="tag t1" style={{ marginTop: 5 }}>{auction ? '你领先' : '已出价'}</span>
                      ) : (
                        <div className="row" style={{ gap: 5, marginTop: 5 }}>
                          <button
                            className="sm"
                            disabled={busy || !!gate}
                            title={gate ? `开够 ${gate.need} 抽才能出价` : undefined}
                            onClick={() => { setBidOpen(l); setBidPrice(String(min)) }}
                          >
                            出价
                          </button>
                          {auction && l.buyout != null && (
                            <button
                              className="sm primary"
                              disabled={busy || !!gate}
                              title={`按一口价 ${money(l.buyout)} 立刻买下`}
                              onClick={() => void buyNow(l)}
                            >
                              一口价
                            </button>
                          )}
                        </div>
                      )}
                      {bidOpen?.id === l.id && (
                        <div style={{ marginTop: 6 }}>
                          <input
                            type="number"
                            value={bidPrice}
                            onChange={(e) => setBidPrice(e.target.value)}
                            style={{ width: '100%' }}
                          />
                          <div className="tiny faint">
                            {auction ? `至少 ${money(min)}${l.buyout != null ? `，到 ${money(l.buyout)} 直接成交` : ''}` : `${lo} ~ ${hi}`}
                          </div>
                          <div className="row" style={{ gap: 5, marginTop: 4 }}>
                            <button className="sm primary" disabled={busy} onClick={() => void doBid()}>确定</button>
                            <button className="sm ghost" onClick={() => setBidOpen(null)}>取消</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          出价的一刻金币就托管走了；被超过立刻退回，到时没人超过就成交换卡。每次至少比当前最高价再高 {Math.round(BID_STEP * 100)}%，
          最后 {SNIPE_MINUTES} 分钟内有人出价会再延长 {SNIPE_MINUTES} 分钟。出了价就不能撤回。
          {days ? '' : ''}
        </p>
      </Panel>
    </>
  )
}
