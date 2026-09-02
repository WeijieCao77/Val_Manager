/**
 * 换卡: my card for a friend's, like for like.
 *
 * The rule that makes it safe is the metal: a silver for a silver, a gold
 * for a gold. A swap that crosses metals is a gift with extra steps, and
 * gifting was removed for being an alt-account funnel. One 体力 a side, so
 * a swap is a small decision rather than a free one.
 *
 * Asynchronous like everything else between two players here: my card goes
 * into escrow the moment I offer, the friend answers whenever they next open
 * the game, and both cards arrive through the inbox. Nobody has to be online.
 */
import { useCallback, useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import CardFace from '../Card'
import { cardById, isPlayerCard, RARITY_CN } from '../../engine/cards'
import type { Card } from '../../engine/cards'
import { collection, STAMINA_COST, canPlay } from '../../engine/gacha'
import { fetchFriendCards, myCode, takeServer } from '../../engine/account'
import type { FriendCard, FriendMiss } from '../../engine/account'
import { answerSwap, cancelSwap, mySwaps, proposeSwap } from '../../engine/market'
import type { SwapRow } from '../../engine/market'

const MISS: Record<FriendMiss, string> = {
  bad: '对战码是 8 位，只有数字和 A–F 这几个字母。',
  missing: '没有这个对战码。让他在「好友」页里复制自己的码。',
  clash: '这个码对上了不止一个账号，换个方式找他。',
  offline: '连不上服务器，等会儿再试。',
  empty: '这个人还没有卡。',
}

const nameOf = (id: string) => {
  const c = cardById(id)
  return c ? (isPlayerCard(c) ? c.ign : c.name) : id
}

export default function Swap() {
  const { g, now, cloud, commit, toast } = useCards()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [friend, setFriend] = useState<{ name: string; tag: string; code: string; cards: FriendCard[] } | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [give, setGive] = useState('')
  const [want, setWant] = useState('')
  const [inbound, setInbound] = useState<SwapRow[]>([])
  const [outbound, setOutbound] = useState<SwapRow[]>([])
  const [days, setDays] = useState(3)
  const mine = myCode()

  const refresh = useCallback(async () => {
    const r = await mySwaps()
    if (r?.ok) { setInbound(r.inbound); setOutbound(r.outbound); setDays(r.days) }
  }, [])
  useEffect(() => { if (cloud) void refresh() }, [cloud, refresh])

  const look = async () => {
    const want0 = code.trim()
    if (mine && want0.toUpperCase() === mine.toUpperCase()) { setWhy('这是你自己的码。'); return }
    setBusy(true); setWhy(null); setFriend(null); setWant('')
    const r = await fetchFriendCards(want0)
    setBusy(false)
    if (r.ok) { setFriend(r); setCode(r.code) } else setWhy(MISS[r.why])
  }

  // what I can put up: anything I hold, spare or not; a spare goes first at +0
  const sellable = collection(g).sort((a, b) => b.rating - a.rating)
  const giveCard = give ? cardById(give) : null
  const giveOwned = give ? g.cards[give] : undefined
  const giveLevel = giveOwned ? (giveOwned.dupes > 0 ? 0 : giveOwned.level) : 0
  // theirs, of the same metal — the only ones the server would accept
  const theirs = (friend?.cards ?? [])
    .map((c) => ({ ...c, card: cardById(c.id) }))
    .filter((c): c is FriendCard & { card: Card } => !!c.card && (!giveCard || c.card.rarity === giveCard.rarity))
    .sort((a, b) => b.card.rating - a.card.rating)

  const propose = async () => {
    if (!friend || !give || !want) { toast('先选好给什么、要什么。'); return }
    if (!canPlay(g, 'swap', now)) { toast(`体力不够——换卡要 ${STAMINA_COST.swap} 点。`); return }
    setBusy(true)
    const r = await proposeSwap(friend.code, give, want)
    setBusy(false)
    if (!r?.ok) {
      toast(r?.rarity ? '只能同等级的卡互换：银卡换银卡，金卡换金卡。'
        : r?.newbie ? `再开 ${Number(r.need) - Number(r.have)} 抽才能换卡（已开 ${r.have}/${r.need}）。`
          : r?.theyNew ? '对方还没开够 50 抽，暂时不能和他换。'
            : r?.theyLack ? '对方没有这张卡。'
              : r?.notOwned ? '你已经没有这张卡了。'
                : r?.stamina ? `体力不够——换卡要 ${STAMINA_COST.swap} 点。`
                  : r?.full ? `最多同时挂 ${r.max} 个交换，先等答复或撤回一个。`
                    : r?.self ? '不能和自己换。' : '没发出去，等会儿再试。')
      return
    }
    if (r.state) takeServer(g, r.state, r.rev)
    void commit()
    toast(`已向 ${friend.name} 发出交换：${nameOf(give)} 换 ${nameOf(want)}。卡先托管着，${days} 天没答复会退回。`)
    setGive(''); setWant('')
    void refresh()
  }

  const answer = async (s: SwapRow, accept: boolean) => {
    if (accept && !canPlay(g, 'swap', now)) { toast(`体力不够——接受交换要 ${STAMINA_COST.swap} 点。`); return }
    setBusy(true)
    const r = await answerSwap(s.id, accept)
    setBusy(false)
    if (!r?.ok) {
      toast(r?.stamina ? `体力不够——接受交换要 ${STAMINA_COST.swap} 点。`
        : r?.notOwned ? '你已经没有他要的那张卡了，这个交换作废，他的卡退回给他。'
          : '这个交换已经结束了。')
      void refresh()
      return
    }
    if (r.state) takeServer(g, r.state, r.rev)
    void commit()
    toast(accept ? `成交。${nameOf(s.give)} 会到你的信箱。` : '已拒绝，他的卡退回给他。')
    void refresh()
  }

  const cancel = async (s: SwapRow) => {
    setBusy(true)
    const r = await cancelSwap(s.id)
    setBusy(false)
    toast(r?.ok ? `已撤回，${nameOf(s.give)} 会回到你的信箱。` : '这个交换已经结束了。')
    void refresh()
  }

  if (!cloud) {
    return (
      <Panel title="换卡">
        <p className="empty">换卡要连上服务器才能用。现在是离线模式。</p>
      </Panel>
    )
  }

  return (
    <>
      <Panel title="换卡" actions={<span className="tiny muted">同等级互换 · 每人 {STAMINA_COST.swap} 点体力</span>}>
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
          用你的一张卡换朋友的一张，<b>只能同等级：银卡换银卡，金卡换金卡，彩卡换彩卡</b>。
          发出时你的卡先托管、扣 {STAMINA_COST.swap} 点体力；对方接受时扣他 {STAMINA_COST.swap} 点，两张卡各自进信箱。
          有重复的先走重复那张（+0）；只有一张时连强化等级一起过去。
        </p>
        <div className="row" style={{ gap: 6, marginBottom: 10 }}>
          <input
            style={{ flex: 1, fontFamily: 'var(--mono)', letterSpacing: 2, textTransform: 'uppercase' }}
            placeholder="对方的 8 位对战码"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void look() }}
          />
          <button className="sm" onClick={() => void look()} disabled={busy}>{busy ? '找…' : '查找'}</button>
        </div>
        {why && <p className="small" style={{ color: 'var(--warn)' }}>{why}</p>}

        {friend && (
          <>
            <div className="row wrap" style={{ gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
              <b>{friend.name}</b><span className="tiny faint mono">{friend.tag}</span>
              <span className="tiny muted">{friend.cards.length} 张卡</span>
            </div>
            <div className="grid c2" style={{ gap: 12, alignItems: 'start' }}>
              <div>
                <div className="tiny faint" style={{ marginBottom: 4 }}>我给</div>
                <select style={{ width: '100%' }} value={give} onChange={(e) => { setGive(e.target.value); setWant('') }}>
                  <option value="">选一张我的卡（{sellable.length} 种）</option>
                  {sellable.slice(0, 300).map(({ card, owned, rating }) => (
                    <option key={card.id} value={card.id}>
                      {RARITY_CN[card.rarity]} · {isPlayerCard(card) ? card.ign : card.name} · {rating}
                      {owned.dupes > 0 ? ` · 多 ${owned.dupes} 张` : owned.level > 0 ? ` · +${owned.level}` : ' · 仅此一张'}
                    </option>
                  ))}
                </select>
                {giveCard && (
                  <div style={{ marginTop: 8 }}>
                    <CardFace card={giveCard} level={giveLevel} size="sm" footer={`给出 +${giveLevel}`} />
                  </div>
                )}
              </div>
              <div>
                <div className="tiny faint" style={{ marginBottom: 4 }}>
                  我要{giveCard ? `（他的${RARITY_CN[giveCard.rarity]}，${theirs.length} 张）` : '（先选我给什么）'}
                </div>
                <select style={{ width: '100%' }} value={want} onChange={(e) => setWant(e.target.value)} disabled={!giveCard}>
                  <option value="">选一张他的卡</option>
                  {theirs.slice(0, 300).map((c) => (
                    <option key={c.id} value={c.id}>
                      {isPlayerCard(c.card) ? c.card.ign : c.card.name} · {c.card.rating}
                      {c.dupes > 0 ? ' · 他有多的（+0）' : c.level > 0 ? ` · +${c.level}` : ''}
                    </option>
                  ))}
                </select>
                {want && cardById(want) && (
                  <div style={{ marginTop: 8 }}>
                    <CardFace
                      card={cardById(want)!}
                      level={(() => { const c = friend.cards.find((x) => x.id === want); return c ? (c.dupes > 0 ? 0 : c.level) : 0 })()}
                      size="sm"
                      footer="想要"
                    />
                  </div>
                )}
              </div>
            </div>
            <button
              className="primary" style={{ marginTop: 12 }}
              disabled={busy || !give || !want || !canPlay(g, 'swap', now)}
              onClick={() => void propose()}
            >
              {!canPlay(g, 'swap', now) ? '体力不够' : `发起交换（−${STAMINA_COST.swap} 体力）`}
            </button>
          </>
        )}
      </Panel>

      {(inbound.length > 0 || outbound.length > 0) && (
        <Panel title="交换中" actions={<span className="tiny muted">{days} 天没答复自动退回</span>}>
          {inbound.map((s) => (
            <div key={s.id} className="row wrap" style={{ gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: '1 1 240px' }}>
                <b>{s.who}</b> 想用 <b>{nameOf(s.give)}</b>{s.giveLevel > 0 ? ` +${s.giveLevel}` : ''} 换你的 <b>{nameOf(s.want)}</b>
                <div className="tiny muted">接受要 {STAMINA_COST.swap} 点体力；{g.cards[s.want] ? '' : '你已经没有这张卡了。'}</div>
              </div>
              <button className="sm primary" disabled={busy || !g.cards[s.want]} onClick={() => void answer(s, true)}>接受</button>
              <button className="sm" disabled={busy} onClick={() => void answer(s, false)}>拒绝</button>
            </div>
          ))}
          {outbound.map((s) => (
            <div key={s.id} className="row wrap" style={{ gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ flex: '1 1 240px' }}>
                给 <b>{s.who}</b>：<b>{nameOf(s.give)}</b>{s.giveLevel > 0 ? ` +${s.giveLevel}` : ''} 换他的 <b>{nameOf(s.want)}</b>
                <div className="tiny muted">等他答复 · 卡托管中</div>
              </div>
              <button className="sm ghost" disabled={busy} onClick={() => void cancel(s)}>撤回</button>
            </div>
          ))}
        </Panel>
      )}
    </>
  )
}
