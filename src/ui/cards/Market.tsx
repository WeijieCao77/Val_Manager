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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import CardFace from '../Card'
import { cardById, isPlayerCard } from '../../engine/cards'
import { collection, levelOf } from '../../engine/gacha'
import {
  AUCTION_HOURS, AUCTION_HOURS_CHOICES, BID_STEP, BUYOUT_MIN, MAX_LISTINGS, SHELF_PAGE, SNIPE_MINUTES,
  answerOffer, askFloorOf, bidOn, browseMarket, gateText, listCardOnMarket, minBidOf, myOffers, unlistCard,
  waitText, withdrawOffer,
} from '../../engine/market'
import type { Gate, Listing, Offer, ShelfQuery, ShelfSort } from '../../engine/market'
import type { Card } from '../../engine/cards'
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

/**
 * How long an auction has left. Never rounded up: 23 hours 40 minutes read
 * as 「剩 24 小时」 for the first half hour of every listing, which the group
 * took for the clock resetting on every bid. The tile (122px) gets whole
 * hours, the wider panels the minutes too.
 */
const left = (ends: number | null | undefined, now: number, exact = false): string => {
  if (ends == null) return ''
  const ms = ends - now
  if (ms <= 0) return '结算中'
  const m = Math.ceil(ms / 60000)
  if (m < 60) return `剩 ${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return exact && rest ? `剩 ${h} 小时 ${rest} 分` : `剩 ${h} 小时`
}
const nowrap = { whiteSpace: 'nowrap' } as const

/**
 * A value that stops changing for a moment before anyone acts on it — the
 * search box and the price boxes ask the server now, and a request per
 * keystroke is both rude and slower than not having one.
 */
function useSettled<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

/** The shelf's four orders. Two of them are the tabs; the market has to be
 *  readable both by what closes next and by what went up last, or a card
 *  listed for a day is invisible for most of it. */
const SORTS: { key: ShelfSort; label: string }[] = [
  { key: 'ends', label: '即将结束' },
  { key: 'new', label: '最新上架' },
  { key: 'price', label: '价格 ↑' },
  { key: 'price_desc', label: '价格 ↓' },
]

/** the length the seller chose last time, so a regular does not re-pick it on every listing */
const HOURS_KEY = 'valmgr.market.hours'
const rememberedHours = (): number => {
  try {
    const v = Number(localStorage.getItem(HOURS_KEY))
    return AUCTION_HOURS_CHOICES.includes(v) ? v : AUCTION_HOURS
  } catch { return AUCTION_HOURS }
}

export default function Market() {
  const { g, commit, toast, cloud, collect } = useCards()
  const level = (id: string) => levelOf(g, id)
  /** other people's listings, a page at a time, in the order the tabs picked */
  const [shelf, setShelf] = useState<Listing[] | null>(null)
  /** all of your own, which are outside the paging and outside the filter */
  const [own, setOwn] = useState<Listing[]>([])
  /** where the shelf stopped; null at the end of it */
  const [next, setNext] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  /** how many listings are open in all */
  const [total, setTotal] = useState<number | null>(null)
  /** every card with something of it on the market, and how many — the filter
   *  menus are built from this so they cascade over the whole market */
  const [pool, setPool] = useState<[string, number][]>([])
  /** the shelf's own search box — the same rule the listing menu uses */
  const [q, setQ] = useState('')
  const [inbound, setInbound] = useState<Offer[]>([])
  const [outbound, setOutbound] = useState<Offer[]>([])
  const [days, setDays] = useState(3)
  // null once the account has played enough; until then it is how far off it is
  const [gate, setGate] = useState<Gate | null>(null)
  const [busy, setBusy] = useState(false)
  const [sellCard, setSellCard] = useState('')
  const [ask, setAsk] = useState('')
  const [buyout, setBuyout] = useState('')
  const [hours, setHours] = useState<number>(rememberedHours)
  const [bidOpen, setBidOpen] = useState<Listing | null>(null)
  const [bidPrice, setBidPrice] = useState('')
  // the clock the countdowns read; the server's idea of now, carried forward
  const [now, setNow] = useState(Date.now())
  // the shelf's filter. The sell menu has its own, inside the picker: what
  // you are looking to buy and what you are looking to get rid of are two
  // different questions, and a hundred-line menu answers neither
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER)
  const [sort, setSort] = useState<ShelfSort>('ends')
  const [priceLo, setPriceLo] = useState('')
  const [priceHi, setPriceHi] = useState('')
  /** leave out what would only be a spare — see the toggle's own note */
  const [unowned, setUnowned] = useState(false)
  const qq = useSettled(q)
  const loSet = useSettled(priceLo)
  const hiSet = useSettled(priceHi)

  /** what the server is being asked for. Everything in it is applied before
   *  the page is cut, so a filter reaches the whole market and not this page. */
  const query = useMemo<ShelfQuery>(() => {
    const n = (v: string) => { const k = Math.round(Number(v)); return v.trim() !== '' && Number.isFinite(k) && k >= 0 ? k : undefined }
    return {
      sort,
      ...(filter.rarity !== 'all' ? { rarity: filter.rarity } : {}),
      ...(filter.region !== 'all' ? { region: filter.region } : {}),
      ...(filter.role !== 'all' ? { role: filter.role } : {}),
      ...(filter.club !== 'all' ? { club: filter.club } : {}),
      ...(qq.trim() ? { q: qq.trim() } : {}),
      ...(n(loSet) != null ? { priceMin: n(loSet) } : {}),
      ...(n(hiSet) != null ? { priceMax: n(hiSet) } : {}),
      ...(unowned ? { unowned: true } : {}),
    }
  }, [sort, filter, qq, loSet, hiSet, unowned])

  // The newest request wins. Changing the filter while the page before it is
  // still in the air used to be the one way to get a shelf that does not match
  // the menus above it.
  const asked = useRef(0)
  /** whether anything past the first page has been loaded — the poll leaves a
   *  scrolled shelf alone rather than yanking it back to the top */
  const deep = useRef(false)

  const load = useCallback(async () => {
    const mine = ++asked.current
    const [b, o] = await Promise.all([browseMarket(query), myOffers()])
    if (mine !== asked.current) return
    deep.current = false
    if (b?.ok) {
      setShelf(b.listings)
      setOwn(b.own ?? [])
      setNext(b.next ?? null)
      setGate(b.gate ?? null)
      if (typeof b.total === 'number') setTotal(b.total)
      if (b.pool) setPool(b.pool)
      if (typeof b.now === 'number') setNow(b.now)
    } else setShelf([])
    if (o?.ok) { setInbound(o.inbound); setOutbound(o.outbound); setDays(o.days) }
  }, [query])

  /** the next page, appended. A listing already on the shelf is never added
   *  twice even if the market shifted under the cursor. */
  const loadMore = useCallback(async () => {
    if (!next || more) return
    setMore(true)
    const mine = asked.current
    const b = await browseMarket({ ...query, cursor: next })
    setMore(false)
    if (mine !== asked.current || !b?.ok) return
    deep.current = true
    setShelf((old) => {
      const seen = new Set((old ?? []).map((l) => l.id))
      return [...(old ?? []), ...b.listings.filter((l) => !seen.has(l.id))]
    })
    setNext(b.next ?? null)
  }, [next, more, query])

  const refresh = load

  useEffect(() => { if (cloud) void load() }, [cloud, load])
  // An auction settles with nobody here to click: the win is posted to the
  // inbox by the sweep. Opening the shelf empties it, so a card won an hour
  // ago is in the collection by the time you come to look for it. Quiet —
  // the 信箱 already carries the record.
  useEffect(() => { if (cloud) void collect(true) }, [cloud, collect])
  // an auction moves without anyone here clicking: the countdowns tick every
  // half minute and the shelf is re-read every couple of minutes, so a sale
  // or a beaten bid shows up without a reload
  useEffect(() => {
    if (!cloud) return
    const tick = setInterval(() => setNow((t) => t + 30_000), 30_000)
    const poll = setInterval(() => { if (!deep.current) void load() }, 120_000)
    return () => { clearInterval(tick); clearInterval(poll) }
  }, [cloud, load])

  // the next page arrives before the last one runs out, so the shelf reads as
  // one long list rather than as pages
  const foot = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = foot.current
    if (!el || !next) return
    const io = new IntersectionObserver(
      (es) => { if (es.some((e) => e.isIntersecting)) void loadMore() },
      { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [next, loadMore])

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
      toast(`一口价至少 ${money(Math.ceil(price * BUYOUT_MIN))}（起拍价的 ${BUYOUT_MIN} 倍），可留空。`)
      return
    }
    setBusy(true)
    // taken off this side only after the server has the listing, so a failed
    // request can never eat the card
    const r = await listCardOnMarket(sellCard, price, level(sellCard), card.rarity, now2, hours)
    setBusy(false)
    if (!r?.ok) {
      toast(r?.newbie ? gateText(r)
        : r?.notOwned ? '服务器还没同步这张卡，稍后再挂。'
        : r?.alreadyListed ? '这张卡已经挂上去了。'
          : r?.full ? `最多同时挂 ${r.max ?? MAX_LISTINGS} 张，卖掉或撤回一张再挂。`
            : r?.badBuyout ? `一口价要在 ${money(Number(r.min ?? 0))} ~ 500,000 之间，可留空。`
            : r?.badHours ? `拍卖时长要在 ${r.min} ~ ${r.max} 小时之间。`
            : r?.bad ? `起拍价要在 ${money(Number(r.min ?? 50))} ~ 500,000 之间，不低于分解价。`
              : '挂牌失败，稍后再试。')
      return
    }
    // the card left the server's copy of the account when it took the listing
    if (r.state) takeServer(g, r.state, r.rev)
    void commit()
    setSellCard(''); setAsk(''); setBuyout('')
    try { localStorage.setItem(HOURS_KEY, String(hours)) } catch { /* fine */ }
    toast(`${nameOf(sellCard)} 已挂出，起拍 ${money(price)}${now2 != null ? `，一口价 ${money(now2)}` : ''}。${hours} 小时后按最高价成交，流拍退回。`)
    void refresh()
  }

  /** the shape of a reply to a bid, whichever way it went */
  const afterBid = async (r: Awaited<ReturnType<typeof bidOn>>, price: number) => {
    if (!r?.ok) {
      toast(r?.newbie ? gateText(r)
        : r?.low ? `现在至少要出 ${money(Number(r.min ?? 0))}。`
        : r?.leading ? '你已是最高价。'
        : r?.range ? `旧规则挂牌，只能在 ${r.lo} ~ ${r.hi} 之间还价。`
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
    // A bought card is handed over through the inbox. Emptying it here is what
    // puts it in the collection at the level it was raised to, right now —
    // otherwise 收藏 kept showing the plain copy already there until the tab
    // went away and came back.
    if (r.bought) await collect(true)
    toast(r.bought ? `一口价成交（${money(paid)} 金币），卡已入库。`
      : `已出价 ${money(paid)}，目前领先。被超过会立刻退回金币。`)
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
    await afterBid(r, price)
  }

  const buyNow = async (l: Listing) => {
    if (l.buyout == null) return
    if (g.coins < l.buyout) { toast('金币不够。'); return }
    // 一口价 sits next to 出价 on a phone and settles the moment it is
    // pressed — a thumb that meant the other button spent the coins. Ask.
    if (!confirm(`按一口价 ${money(l.buyout)} 金币立刻买下 ${nameOf(l.cardId)}？`)) return
    setBusy(true)
    const r = await bidOn(l.id, l.buyout)
    setBusy(false)
    await afterBid(r, l.buyout)
  }

  // the old listings only: an auction settles itself
  const answer = async (o: Offer, accept: boolean) => {
    setBusy(true)
    const r = await answerOffer(o.id, accept)
    setBusy(false)
    if (!r?.ok) { toast(r?.auction ? '竞拍到时自动成交，不用你选。' : '这个报价已经失效了。'); void refresh(); return }
    toast(accept ? `成交，${money(o.price)} 金币会到你的信箱。` : '已拒绝，金币退回对方。')
    void refresh()
  }

  // the buyer's side of 撤回, on an old listing: a bid the seller has not
  // answered is his to take back. On an auction a bid is binding.
  const takeBack = async (o: Offer) => {
    setBusy(true)
    const r = await withdrawOffer(o.id)
    setBusy(false)
    if (!r?.ok) { toast(r?.binding ? '竞拍出价不能撤回，被超过才退。' : '这个报价已经不在了。'); void refresh(); return }
    toast(`已撤回，${money(o.price)} 金币会回到你的信箱。`)
    void refresh()
  }

  const pull = async (l: Listing) => {
    setBusy(true)
    const r = await unlistCard(l.id)
    setBusy(false)
    if (!r?.ok) { toast(r?.bound ? '已经有人出价了，撤不回来。' : '这张挂牌已经不在了。'); void refresh(); return }
    // it comes home through the inbox, and the inbox is emptied here
    await collect(true)
    toast('已撤回，卡回到了收藏。')
    void refresh()
  }

  if (!cloud) {
    return (
      <Panel title="交易区">
        <p className="empty">交易区需要联网。</p>
      </Panel>
    )
  }

  const mineOnShelf = own
  const theirs = shelf ?? []
  // The menus are built from the whole market, not from the page in front of
  // you: one card per listing, so 「TES（12）」 counts listings the way it always
  // did. It is the server's `pool`, which respects the price range and 「只看
  // 非重复」 and not the four menus themselves — a club menu narrowed by the
  // club you already picked has one entry in it.
  const poolCards = useMemo<Card[]>(
    () => pool.flatMap(([id, n]) => { const c = cardById(id); return c ? (Array(n).fill(c) as Card[]) : [] }),
    [pool])
  // how many are behind the filter, counted off that same pool — the shelf
  // itself only holds the pages loaded so far
  const matched = useMemo(
    () => poolCards.filter((c) => matchesFilter(c, filter) && matchesQuery(c, qq)).length,
    [poolCards, filter, qq])
  const narrowed = matched !== poolCards.length
  const legacyInbound = inbound.filter((o) => o.ends == null)
  const askNum = Math.round(Number(ask))
  const buyoutFloor = Number.isFinite(askNum) && askNum > 0 ? Math.ceil(askNum * BUYOUT_MIN) : null

  return (
    <>
      {gate && (
        <Panel title="交易区还没对你开放">
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
            新账号要建满 <b>{gate.days ?? 3} 天</b>、开够 <b>{gate.need} 抽</b>才能挂牌和出价。
            {gate.have < gate.need && <>你现在 <b>{gate.have}</b> 抽，还差 <b>{gate.need - gate.have}</b> 抽，签到送的包也算。</>}
            {(gate.wait ?? 0) > 0 && <>账号还要等 <b>{waitText(gate.wait ?? 0)}</b>。</>}
          </p>
          {gate.have < gate.need && (
            <div style={{ height: 5, borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, (gate.have / gate.need) * 100)}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          )}
          <p className="tiny faint" style={{ marginBottom: 0, lineHeight: 1.7 }}>
            这道门槛是防小号的。<b>货架可以随便看</b>，只是还不能买卖。
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
            {' · '}竞拍
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
          <select
            className="sm" aria-label="拍卖时长" title="拍多久：到时最高价成交"
            style={{ flex: '0 0 auto', width: 'auto' }}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            {AUCTION_HOURS_CHOICES.map((h) => <option key={h} value={h}>拍 {h} 小时</option>)}
          </select>
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
          <b>拍卖时长 {AUCTION_HOURS_CHOICES[0]} ~ {AUCTION_HOURS_CHOICES[AUCTION_HOURS_CHOICES.length - 1]} 小时自定，到时最高价成交</b>。
          流拍退回信箱；<b>有人出价后不能撤回</b>。
          一口价可不填，填了则按此价立刻成交，至少为起拍价的 {BUYOUT_MIN} 倍。
          <b>最多同时挂 {MAX_LISTINGS} 张</b>。有重复先卖重复那张（+0），只有一张时连强化等级一起卖出。
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
                      ? <>当前最高 <b className="pos">{money(l.best)}</b>{l.bids > 1 ? `，${l.bids} 人出过价` : ''} · {left(l.ends, now, true)}</>
                      : <>还没有人出价 · {left(l.ends, now, true)}</>}
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
                  <div className="tiny"><span className="pos">领先</span> · {left(o.ends, now, true)}</div>
                )}
              </div>
              <span className="mono">{money(o.price)}</span>
              {o.ends == null && (
                <button className="sm ghost" disabled={busy} onClick={() => void takeBack(o)}>撤回</button>
              )}
            </div>
          ))}
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            金币已托管。到时无人超过，卡到你的信箱；被超过立刻退回金币。竞拍出价不能撤回。
          </p>
        </Panel>
      )}

      <Panel
        title="货架"
        actions={
          <span className="tiny muted">
            {narrowed ? `筛出 ${matched} 张` : `${matched} 张在拍`}
            {theirs.length < matched ? `，看到第 ${theirs.length} 张` : ''}
            {total != null && total > matched ? `（全站 ${total} 张）` : ''}
          </span>
        }
      >
        {/* Two tabs and two orders beside them. 「即将结束」 is the shelf as it
            was; 「最新上架」 exists because it is the only one that guarantees a
            card just listed is on somebody's first screen — under the closing
            order a 24-hour auction waits most of a day for its turn. */}
        <div className="row wrap" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <div className="seg">
            {SORTS.map((o) => (
              <button key={o.key} className={sort === o.key ? 'on' : ''} onClick={() => setSort(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {/* The filter belongs to the thing it filters. It used to be its own
            panel at the top of the page, two panels away from the shelf and
            right above the listing menu — which has its own — and read as
            if it filtered that. */}
        <CardFilters
          value={filter}
          onChange={setFilter}
          pool={poolCards}
          extra={
            <>
              <input
                className="sm"
                style={{ width: 130, padding: '4px 7px' }}
                placeholder="搜 ID / 战队"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <span className="row" style={{ gap: 4, alignItems: 'center' }}>
                <input
                  className="sm" type="number" min={0} placeholder="最低价"
                  style={{ width: 78, padding: '4px 7px' }}
                  value={priceLo} onChange={(e) => setPriceLo(e.target.value)}
                />
                <span className="tiny faint">—</span>
                <input
                  className="sm" type="number" min={0} placeholder="最高价"
                  style={{ width: 78, padding: '4px 7px' }}
                  value={priceHi} onChange={(e) => setPriceHi(e.target.value)}
                />
              </span>
              {/* the price it filters on is the one you would have to beat:
                  the top bid where there is one, the starting price where
                  there is not */}
              <button
                className={`sm ${unowned ? '' : 'ghost'}`}
                title="只看你没有的，或强化比你手上高的"
                onClick={() => setUnowned((v) => !v)}
              >
                只看非重复
              </button>
            </>
          }
        />
        {shelf === null ? <p className="empty">读取中…</p>
          : theirs.length === 0 ? (
            <p className="empty">
              {total === 0 ? '货架是空的，挂一张试试。' : '没有符合筛选的卡。'}
            </p>
          )
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
                      {/* one fact a line, none of them allowed to wrap: the
                          tile is 122px and 「起拍 10,000 金币」 broke mid-word */}
                      <div className="tiny mono" style={{ marginTop: 4, ...nowrap }}>
                        {auction && l.best != null
                          ? <>当前 <b>{money(l.best)}</b></>
                          : <>{auction ? '起拍 ' : ''}{money(l.ask)}</>}
                      </div>
                      <div className="tiny faint" style={{ minHeight: '1.4em', ...nowrap }}>
                        {auction && l.buyout != null ? `一口价 ${money(l.buyout)}` : ''}
                      </div>
                      {lands && (
                        <div className={`tiny ${dear ? 'warn' : 'faint'}`}>{lands}</div>
                      )}
                      <div className="tiny faint market-seller">{l.seller}</div>
                      <div className="tiny faint row wrap" style={{ minHeight: '1.4em', gap: '0 6px', justifyContent: 'center' }}>
                        {auction ? (
                          <>
                            {l.bids > 0 && <span style={nowrap}>{l.bids} 人出价</span>}
                            <span style={nowrap}>{left(l.ends, now)}</span>
                          </>
                        ) : <span style={nowrap}>旧规则</span>}
                      </div>
                      <div className="grow" />
                      {l.bid ? (
                        <span className="tag t1" style={{ marginTop: 5 }}>{auction ? '你领先' : '已出价'}</span>
                      ) : (
                        <div className="row wrap" style={{ gap: 4, marginTop: 5 }}>
                          {/* side by side where the tile is wide enough (a phone's
                              two-column shelf), stacked in the 122px desktop tile */}
                          <button
                            className="sm"
                            style={{ flex: '1 1 48px', minHeight: 26 }}
                            disabled={busy || !!gate}
                            title={gate ? gateText(gate) : undefined}
                            onClick={() => { setBidOpen(l); setBidPrice(String(min)) }}
                          >
                            出价
                          </button>
                          {auction && l.buyout != null && (
                            <button
                              className="sm primary"
                              style={{ flex: '1 1 56px', minHeight: 26 }}
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
        {/* The foot of the shelf. The observer fetches the next page before
            this one runs out, so it reads as one list; the button is there
            for anyone the observer never fires for. */}
        {shelf !== null && theirs.length > 0 && (
          <div ref={foot} className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            {next ? (
              <button className="sm ghost" disabled={more} onClick={() => void loadMore()}>
                {more ? '读取中…' : `再看 ${Math.min(SHELF_PAGE, Math.max(0, matched - theirs.length)) || SHELF_PAGE} 张`}
              </button>
            ) : (
              <span className="tiny faint">到底了，一共 {theirs.length} 张</span>
            )}
          </div>
        )}
        <p className="tiny faint" style={{ marginBottom: 0 }}>
          出价即托管金币，被超过立刻退回。每次加价至少 {Math.round(BID_STEP * 100)}%，
          最后 {SNIPE_MINUTES} 分钟内有人出价会延长 {SNIPE_MINUTES} 分钟。出价不能撤回。
          {days ? '' : ''}
        </p>
      </Panel>
    </>
  )
}
