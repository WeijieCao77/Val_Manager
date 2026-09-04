/**
 * Cards and coins moving in and out of a collection from the outside: escrow
 * for the trading post, and everything the inbox delivers.
 *
 * Shared by the client and the server on purpose. The server is the only
 * side that applies any of this now — see engine/actions.ts — but the client
 * still reads the shapes to draw the mailbox, and one copy of the rules is
 * one copy that cannot drift.
 */
import { cardById, isPlayerCard, MAX_LEVEL } from './cards'
import { MAIL_MAX, PACKS } from './gacha'
import type { GachaState, PackKind } from './gacha'

export interface MailItem {
  kind: string
  cardId: string | null
  level: number
  coins: number
  /** an unopened pack, for a grant from the owner */
  pack: string | null
  count: number
  body: Record<string, unknown>
  at: number
}

/**
 * Take a card off this side, ready to be listed.
 *
 * A spare goes first and goes out unupgraded — upgrading consumes duplicates,
 * so a duplicate is by definition level 0. Only when there is no spare does the
 * card itself leave, and then it carries whatever it was raised to.
 */
export function escrowCard(g: GachaState, cardId: string): { ok: boolean; level: number } {
  const owned = g.cards[cardId]
  if (!owned) return { ok: false, level: 0 }
  if ((owned.dupes ?? 0) > 0) { owned.dupes -= 1; return { ok: true, level: 0 } }
  // a row written by an early client may have no level at all
  const level = Math.max(0, Math.trunc(Number(owned.level) || 0))
  delete g.cards[cardId]
  // and it cannot still be in the five it was just taken out of
  g.squad = {
    slots: g.squad.slots.map((x) => (x === cardId ? null : x)),
    coach: g.squad.coach === cardId ? null : g.squad.coach,
  }
  for (const p of g.presets ?? []) {
    if (!p) continue
    p.squad = {
      slots: p.squad.slots.map((x) => (x === cardId ? null : x)),
      coach: p.squad.coach === cardId ? null : p.squad.coach,
    }
  }
  return { ok: true, level }
}

/**
 * Put a card in, at the level it arrives with.
 *
 * The collection holds one level per card and a pile of spares beside it, so
 * two copies at two different levels cannot both be kept: one of them is the
 * card and the other is a spare. The one worth keeping is the higher, and
 * the copy that steps down was never worth more than a spare anyway.
 *
 * This used to make every arrival a plain spare and throw its level away,
 * which quietly destroyed whatever the other side had raised. Reported from
 * the group: a plain BABYBAY in the collection, a +1 bought in the market,
 * and the +1 landed as an ordinary duplicate — so the upgrade pressed right
 * afterwards ate it to raise the plain one to +1, and a whole copy was gone
 * for nothing. The same hole swallowed your own card coming home: list your
 * only +3, pull a plain copy out of a pack while it sits on the shelf, and
 * the +3 came back as a spare.
 */
export function restoreCard(g: GachaState, cardId: string, level: number): void {
  // never a card the game does not have — a row with a bad id (a grant typed
  // wrong, an old card retired from the set) must not become an owned card
  if (!cardById(cardId)) return
  const lv = Math.min(MAX_LEVEL, Math.max(0, Math.trunc(Number(level) || 0)))
  const had = g.cards[cardId]
  if (had) {
    had.dupes++
    had.seen++
    if (lv > (Math.trunc(Number(had.level) || 0))) had.level = lv
    return
  }
  g.cards[cardId] = {
    id: cardId, level: lv, dupes: 0, seen: 1,
    got: new Date().toISOString().slice(0, 10),
  }
}

const nameOf = (cardId: string): string => {
  const c = cardById(cardId)
  if (!c) return '一张卡'
  return isPlayerCard(c) ? c.ign : c.name
}

/** A card's name with what it was raised to — silent when it is a plain one. */
const nameAt = (cardId: string, level: number): string =>
  `${nameOf(cardId)}${level > 0 ? ` +${level}` : ''}`

/** What one piece of mail says, in the player's words. */
export function mailLine(m: MailItem): string {
  const who = String(m.body?.who ?? '')
  switch (m.kind) {
    case 'sold': return `${nameOf(String(m.body?.cardId ?? ''))} 卖给了 ${who}，到账 ${m.coins} 金币`
    case 'bought': return `买到 ${nameAt(m.cardId ?? '', m.level)}，花了 ${m.body?.price} 金币`
    case 'outbid': return `${nameOf(String(m.body?.cardId ?? ''))} 被别人买走了，你的 ${m.coins} 金币退回`
    case 'offer_declined': return `对方拒绝了你的报价，${m.coins} 金币退回`
    case 'offer_expired': return `报价过期或挂牌撤回，${m.coins} 金币退回`
    case 'offer_withdrawn': return `你撤回了对 ${nameOf(String(m.body?.cardId ?? ''))} 的报价，${m.coins} 金币退回`
    case 'offer_made': return `${who} 对你的 ${nameOf(String(m.body?.cardId ?? ''))} 出价 ${m.body?.price}（挂 ${m.body?.ask}）`
    case 'listing_pulled': return `${nameAt(m.cardId ?? '', m.level)} 已撤回`
    case 'listing_expired': return `${nameAt(m.cardId ?? '', m.level)} 连续三次没回复报价，已自动下架并退回`
    case 'gift': return `收到 ${who} 送的 ${nameAt(m.cardId ?? '', m.level)}`
    case 'swap_offer': return `${who} 想用 ${nameOf(String(m.body?.give ?? ''))} 换你的 ${nameOf(String(m.body?.want ?? ''))}——去好友页答复`
    case 'swap_in': return `换到了 ${nameAt(m.cardId ?? '', m.level)}（和 ${who} 的交换成交）`
    case 'swap_back': return `${nameAt(m.cardId ?? '', m.level)} 退回来了（${String(m.body?.reason ?? '交换没成')}）`
    case 'grant': {
      const bits = []
      if (m.pack) bits.push(`${PACKS[m.pack as PackKind]?.name ?? m.pack} ×${m.count}`)
      if (m.coins) bits.push(`${m.coins} 金币`)
      if (m.cardId) bits.push(nameOf(m.cardId))
      const note = String(m.body?.note ?? '')
      return `收到官方发放：${bits.join('，')}${note ? `（${note}）` : ''}`
    }
    default: return '有一条新消息'
  }
}

/**
 * Apply what the server handed over, and keep a readable copy of it.
 *
 * The copy is what the 信箱 button shows: the server has already marked
 * these taken, so the save is the only place they can be read back from.
 */
export function applyMail(g: GachaState, mail: MailItem[]): void {
  const now = Date.now()
  for (const m of mail) {
    if (m.coins) g.coins += m.coins
    if (m.cardId) restoreCard(g, m.cardId, m.level)
    if (m.pack && m.pack in PACKS) {
      const k = m.pack as PackKind
      g.packs[k] = (g.packs[k] ?? 0) + Math.max(1, m.count)
    }
    const note = m.kind === 'grant' ? String(m.body?.note ?? '') : ''
    // the note gets its own line in the box, so the headline goes without it
    const text = mailLine(note ? { ...m, body: { ...m.body, note: '' } } : m)
    g.mail = [
      { at: m.at || now, kind: m.kind, text, ...(note ? { note } : {}), seen: false },
      ...(g.mail ?? []),
    ].slice(0, MAIL_MAX)
  }
}

/** How many deliveries the player has not looked at yet. */
export const unreadMail = (g: GachaState): number => (g.mail ?? []).filter((m) => !m.seen).length

/** The player opened the box: everything in it has been looked at. */
export function markMailSeen(g: GachaState): boolean {
  let changed = false
  for (const m of g.mail ?? []) {
    if (!m.seen) { m.seen = true; changed = true }
  }
  return changed
}
