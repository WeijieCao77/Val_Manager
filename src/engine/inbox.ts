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

/** The upgraded copies kept beside a card, lowest first; an old row has none. */
export const sparesOf = (owned: { spares?: unknown }): number[] =>
  (Array.isArray(owned.spares) ? owned.spares : [])
    .map((x) => Math.trunc(Number(x) || 0))
    .filter((x) => x >= 1 && x <= MAX_LEVEL)
    .sort((a, b) => a - b)

export function setSpares(owned: { spares?: number[] }, spares: number[]): void {
  if (spares.length) owned.spares = [...spares].sort((a, b) => a - b)
  else delete owned.spares
}

/**
 * Take a card off this side, ready to be listed.
 *
 * The copy asked for leaves when this side holds one; otherwise the least of
 * them — a duplicate first, unupgraded (upgrading consumes duplicates, so a
 * duplicate is by definition level 0), then the lowest upgraded spare, and
 * the card itself last, carrying whatever it was raised to. When the card
 * itself leaves with spares behind it, the best spare steps up into its place.
 */
export function escrowCard(g: GachaState, cardId: string, want?: number): { ok: boolean; level: number } {
  const owned = g.cards[cardId]
  if (!owned) return { ok: false, level: 0 }
  const dupes = owned.dupes ?? 0
  const spares = sparesOf(owned)
  // a row written by an early client may have no level at all
  const level = Math.max(0, Math.trunc(Number(owned.level) || 0))
  const holds = (lv: number) => (lv === 0 ? dupes > 0 : spares.includes(lv)) || lv === level
  const pick = want != null && holds(want) ? want : dupes > 0 ? 0 : spares.length ? spares[0] : level
  if (pick === 0 && dupes > 0) { owned.dupes = dupes - 1; return { ok: true, level: 0 } }
  const at = spares.indexOf(pick)
  if (pick > 0 && at >= 0) {
    spares.splice(at, 1)
    setSpares(owned, spares)
    return { ok: true, level: pick }
  }
  if (spares.length) {
    owned.level = spares.pop()!
    setSpares(owned, spares)
    return { ok: true, level }
  }
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
 * Two copies of one card at two levels: the higher is the card, and the other
 * is kept as it is — a plain copy as a duplicate, a raised one as an upgraded
 * spare that can be taken apart into duplicates (engine/dismantle.ts).
 *
 * Arrivals used to become plain duplicates with their level thrown away, which
 * quietly destroyed whatever the other side had raised. Reported from the
 * group twice: a plain BABYBAY and a +1 bought in the market, where the
 * upgrade pressed afterwards ate the +1 to raise the plain one; and two +2
 * Smoggy that could never make a +3, because the second one's levels were
 * simply gone. The same hole swallowed your own card coming home: list your
 * only +3, pull a plain copy while it sits on the shelf, and the +3 came back
 * as a duplicate.
 */
export function restoreCard(g: GachaState, cardId: string, level: number): void {
  // never a card the game does not have — a row with a bad id (a grant typed
  // wrong, an old card retired from the set) must not become an owned card
  if (!cardById(cardId)) return
  const lv = Math.min(MAX_LEVEL, Math.max(0, Math.trunc(Number(level) || 0)))
  const had = g.cards[cardId]
  if (had) {
    had.seen++
    const main = Math.max(0, Math.trunc(Number(had.level) || 0))
    const low = Math.min(lv, main)
    had.level = Math.max(lv, main)
    if (low > 0) setSpares(had, [...sparesOf(had), low])
    else had.dupes++
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
    case 'overbid': return `你对 ${nameOf(String(m.body?.cardId ?? ''))} 的出价被超过了（现在 ${m.body?.by}），${m.coins} 金币退回`
    case 'unsold': return `${nameAt(m.cardId ?? '', m.level)} 到时没人出价，已退回`
    case 'listing_retired': return `交易区改成竞拍了，改版前挂的 ${nameAt(m.cardId ?? '', m.level)} 已退回，可以重新挂`
    case 'offer_declined': return `对方拒绝了你的报价，${m.coins} 金币退回`
    case 'offer_expired': return `报价过期或挂牌撤回，${m.coins} 金币退回`
    case 'offer_withdrawn': return `你撤回了对 ${nameOf(String(m.body?.cardId ?? ''))} 的报价，${m.coins} 金币退回`
    case 'offer_made': return `${who} 对你的 ${nameOf(String(m.body?.cardId ?? ''))} 出价 ${m.body?.price}（起拍 ${m.body?.ask}）`
    case 'listing_pulled': return `${nameAt(m.cardId ?? '', m.level)} 已撤回`
    case 'listing_expired': return `${nameAt(m.cardId ?? '', m.level)} 连续三次没回复报价，已自动下架并退回`
    case 'gift': return `收到 ${who} 送的 ${nameAt(m.cardId ?? '', m.level)}`
    case 'swap_offer': return `${who} 想用 ${nameOf(String(m.body?.give ?? ''))} 换你的 ${nameOf(String(m.body?.want ?? ''))}，去好友页答复`
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
