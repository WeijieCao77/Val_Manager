/**
 * 交易区.
 *
 * The thing to understand before reading any of this: both sides pay in when
 * they act. Listing takes the card off your side now, offering takes the
 * coins — and whatever happens, the escrow comes back through the inbox. That
 * is what stops a player who never returns from stranding the other one, and
 * it is why every button here changes your save immediately rather than at
 * some settlement in the future.
 */
import { useCallback, useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import CardFace from '../Card'
import { cardById, isPlayerCard } from '../../engine/cards'
import { collection, levelOf } from '../../engine/gacha'
import {
  answerOffer, askFloorOf, bidOn, browseMarket, listCardOnMarket, myOffers, unlistCard,
} from '../../engine/market'
import type { Gate, Listing, Offer } from '../../engine/market'
import { takeServer } from '../../engine/account'
import { CardFilters, EMPTY_FILTER, matchesFilter } from './Filters'
import { CardPicker } from './Picker'
import type { CardFilter } from './Filters'

const HAGGLE = 0.1
const money = (n: number) => n.toLocaleString('en-US')
const nameOf = (id: string) => {
  const c = cardById(id)
  return c ? (isPlayerCard(c) ? c.ign : c.name) : id
}

export default function Market() {
  const { g, commit, toast, cloud } = useCards()
  const level = (id: string) => levelOf(g, id)
  const [shelf, setShelf] = useState<Listing[] | null>(null)
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
  const [bidOpen, setBidOpen] = useState<Listing | null>(null)
  const [bidPrice, setBidPrice] = useState('')
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
    }
    else setShelf([])
    if (o?.ok) { setInbound(o.inbound); setOutbound(o.outbound); setDays(o.days) }
  }, [])

  useEffect(() => { if (cloud) void refresh() }, [cloud, refresh])

  // Anything in the collection can be sold, spare or not: somebody who pulls a
  // 彩卡 he has no use for and wants to keep opening packs is exactly who this
  // is for. A spare goes first and goes out unupgraded.
  const sellable = collection(g).sort((a, b) => b.rating - a.rating)

  const doList = async () => {
    const card = cardById(sellCard)
    const price = Math.round(Number(ask))
    if (!card || !Number.isFinite(price)) { toast('先选一张卡，填个价。'); return }
    setBusy(true)
    // taken off this side only after the server has the listing, so a failed
    // request can never eat the card
    const r = await listCardOnMarket(sellCard, price, level(sellCard), card.rarity)
    setBusy(false)
    if (!r?.ok) {
      toast(r?.newbie ? `再开 ${Number(r.need) - Number(r.have)} 抽就能用交易区了（已开 ${r.have}/${r.need}）。`
        : r?.notOwned ? '服务器上还没看到这张卡，稍等一下再挂。'
        : r?.alreadyListed ? '这张卡已经挂上去了。'
          : r?.full ? '挂牌数量到上限了，先撤一个。'
            : r?.bad ? `价格要在 ${money(Number(r.min ?? 50))} ~ 500,000 之间（最低不能低于分解价）。`
              : '挂不上去，等会儿再试。')
      return
    }
    // the card left the server's copy of the account when it took the listing
    if (r.state) takeServer(g, r.state, r.rev)
    void commit()
    setSellCard(''); setAsk('')
    toast(`${nameOf(sellCard)} 已挂出，标价 ${money(price)}。卖不掉会原样退回来。`)
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
    if (!r?.ok) {
      toast(r?.newbie ? `再开 ${Number(r.need) - Number(r.have)} 抽就能用交易区了（已开 ${r.have}/${r.need}）。`
        : r?.range ? `只能在 ${r.lo} ~ ${r.hi} 之间还价（挂牌价 ±10%）。`
        : r?.broke ? '金币不够。'
          : r?.already ? '你已经对这张牌出过价了。'
            : r?.self ? '这是你自己的挂牌。' : '这张牌已经不在了。')
      void refresh()
      return
    }
    // and the coins left it when it took the bid
    if (r.state) takeServer(g, r.state, r.rev)
    void commit()
    setBidOpen(null); setBidPrice('')
    toast(`已出价 ${money(price)}。金币先托管着，${days} 天没回应会自动退回。`)
    void refresh()
  }

  const answer = async (o: Offer, accept: boolean) => {
    setBusy(true)
    const r = await answerOffer(o.id, accept)
    setBusy(false)
    if (!r?.ok) { toast('这个报价已经失效了。'); void refresh(); return }
    toast(accept ? `成交，${money(o.price)} 金币会到你的信箱。` : '已拒绝。对方的金币退回给他。')
    void refresh()
  }

  const pull = async (l: Listing) => {
    setBusy(true)
    const r = await unlistCard(l.id)
    setBusy(false)
    if (!r?.ok) { toast('这张挂牌已经不在了。'); void refresh(); return }
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
  const theirs = theirsAll.filter((l) => { const c = cardById(l.cardId); return !!c && matchesFilter(c, filter) })

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

      <Panel title="货架筛选" actions={<span className="tiny muted">只筛下面的货架；挂牌菜单有自己的筛选</span>}>
        <CardFilters value={filter} onChange={setFilter} pool={shelfCards} />
      </Panel>

      <Panel title="挂一张卡出去" actions={<span className="tiny muted">还价范围 ±10%</span>}>
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
            placeholder={sellCard ? `最低 ${askFloorOf(cardById(sellCard)?.rarity ?? '')}` : '标价'}
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
          />
          <button className="primary" onClick={() => void doList()} disabled={busy || !sellCard || !ask || !!gate}>
            挂出
          </button>
        </div>
        <p className="tiny faint" style={{ marginBottom: 0, lineHeight: 1.7 }}>
          <b>挂出的一刻卡就从你这边拿走了</b>，卖掉换成金币，卖不掉原样退回你的信箱——
          这是为了没人会因为对方不上线而两头落空。有重复的先走重复那张（重复卡是没强化过的）；
          只有一张时连强化等级一起过去。
        </p>
      </Panel>

      {(inbound.length > 0 || mineOnShelf.length > 0) && (
        <Panel
          title="我挂的牌"
          actions={<span className="tiny muted">{days} 天不回应，报价自动撤回</span>}
        >
          {inbound.map((o) => (
            <div key={o.id} className="row wrap" style={{ gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: '1 1 200px' }}>
                <b>{nameOf(o.cardId)}</b>
                <span className="tiny faint"> · 挂 {money(o.ask)}</span>
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
                <span className="tiny faint"> · 标价 {money(l.ask)}</span>
                <div className="tiny muted">{l.offers ? `${l.offers} 个报价，最高 ${money(l.best ?? 0)}` : '还没有人出价'}</div>
              </div>
              <button className="sm ghost" disabled={busy} onClick={() => void pull(l)}>撤回</button>
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
                <span className="tiny faint"> · 卖家 {o.who} · 挂 {money(o.ask)}</span>
              </div>
              <span className="mono">{money(o.price)}</span>
            </div>
          ))}
          <p className="tiny faint" style={{ marginBottom: 0 }}>
            这些金币已经从你身上扣掉、由服务器托管。买到了就换成卡，被拒或者 {days} 天没人理会自动退回。
          </p>
        </Panel>
      )}

      <Panel
        title="货架"
        actions={<span className="tiny muted">{theirs.length} 张在卖{theirs.length !== theirsAll.length ? `（共 ${theirsAll.length}）` : ''}{size && size.total > theirsAll.length + mineOnShelf.length ? `，全站 ${size.total} 张，只显示最新 ${size.shelf} 张` : ''}</span>}
      >
        {shelf === null ? <p className="empty">读取中…</p>
          : theirsAll.length === 0 ? <p className="empty">现在没有人在卖东西。挂一张上去试试。</p>
            : theirs.length === 0 ? <p className="empty">货架上没有符合筛选的卡。</p>
            : (
              <div className="market-shelf">
                {theirs.map((l) => {
                  const card = cardById(l.cardId)
                  if (!card) return null
                  const lo = Math.ceil(l.ask * (1 - HAGGLE))
                  const hi = Math.floor(l.ask * (1 + HAGGLE))
                  return (
                    <div key={l.id} className="market-box">
                      <CardFace card={card} level={l.level} size="sm" />
                      <div className="tiny mono" style={{ marginTop: 4 }}>{money(l.ask)} 金币</div>
                      <div className="tiny faint market-seller">{l.seller}</div>
                      <div className="tiny faint" style={{ minHeight: '1.4em' }}>
                        {l.offers > 0 ? `${l.offers} 人出价` : ''}
                      </div>
                      <div className="grow" />
                      {l.bid ? (
                        <span className="tag t1" style={{ marginTop: 5 }}>已出价</span>
                      ) : (
                        <button
                          className="sm"
                          style={{ marginTop: 5 }}
                          disabled={busy || !!gate}
                          title={gate ? `开够 ${gate.need} 抽才能出价` : undefined}
                          onClick={() => { setBidOpen(l); setBidPrice(String(l.ask)) }}
                        >
                          出价
                        </button>
                      )}
                      {bidOpen?.id === l.id && (
                        <div style={{ marginTop: 6 }}>
                          <input
                            type="number"
                            value={bidPrice}
                            onChange={(e) => setBidPrice(e.target.value)}
                            style={{ width: '100%' }}
                          />
                          <div className="tiny faint">{lo} ~ {hi}</div>
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
          出价的一刻金币就托管走了，买到换卡，没买到原路退回。还价只能在标价的 ±10% 之间。
        </p>
      </Panel>
    </>
  )
}
