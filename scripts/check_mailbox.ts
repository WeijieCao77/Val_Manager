/**
 * The 信箱 keeps what it delivers, and says how much is unread.
 *
 *   npx tsx scripts/check_mailbox.ts
 *
 * Mail is handed over by the server exactly once, so the save is the only
 * place it can be read back from. This drives applyMail with the shapes the
 * server actually sends — a sale, a refund, an official grant with a note —
 * and checks that the goods land, the list keeps them newest first with the
 * note attached, the unread count moves, and the list is capped.
 */
import { newGacha } from '../src/engine/gacha'
import { MAIL_MAX } from '../src/engine/gacha'
import { applyMail, markMailSeen, unreadMail } from '../src/engine/market'
import type { MailItem } from '../src/engine/market'

const store = new Map<string, string>()
;(globalThis as never as { localStorage: unknown }) = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  key: () => null, clear: () => store.clear(), get length() { return store.size },
}

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const g = newGacha('VM-TEST-MAIL-0000-0000-0000', '审计', '2026-09-02')
const coins0 = g.coins
const item = (x: Partial<MailItem>): MailItem => ({
  kind: 'sold', cardId: null, level: 0, coins: 0, pack: null, count: 1, body: {}, at: 1_700_000_000_000, ...x,
})

check('一开始信箱是空的、没有未读', (g.mail ?? []).length === 0 && unreadMail(g) === 0)

// a sale paid out, then an official grant with a note
applyMail(g, [
  item({ kind: 'sold', coins: 700, body: { who: 'someone #1234', cardId: 'p:1' }, at: 1_700_000_000_000 }),
])
applyMail(g, [
  item({ kind: 'grant', coins: 500, pack: 'elite', count: 2, body: { note: '群活动补偿' }, at: 1_700_000_100_000 }),
])
check('金币到账', g.coins === coins0 + 1200, `${coins0} → ${g.coins}`)
check('卡包到账', (g.packs.elite ?? 0) === 1 + 2, `elite ${g.packs.elite}`)
check('两条都记下了', (g.mail ?? []).length === 2)
check('最新的在最上面', g.mail?.[0].kind === 'grant', g.mail?.[0].kind)
check('官方发放带着附言', g.mail?.[0].note === '群活动补偿', g.mail?.[0].note)
check('交易的那条没有附言', g.mail?.[1].note === undefined)
check('文字是给人看的', !!g.mail?.[0].text.includes('官方发放'), g.mail?.[0].text)
check('两条都是未读', unreadMail(g) === 2)

// opening the box reads it
check('打开信箱标为已读', markMailSeen(g) === true && unreadMail(g) === 0)
check('再打开一次没有变化', markMailSeen(g) === false)

// a busy week does not grow without bound
applyMail(g, Array.from({ length: MAIL_MAX + 15 }, (_, i) =>
  item({ kind: 'offer_expired', coins: 1, at: 1_700_001_000_000 + i })))
check(`最多只留 ${MAIL_MAX} 条`, (g.mail ?? []).length === MAIL_MAX, `${g.mail?.length}`)
check('留下的是最新的', g.mail?.[0].at === 1_700_001_000_000 + MAIL_MAX + 14)
check('旧的已读被挤掉，新的未读都在', unreadMail(g) === MAIL_MAX)

// an old save without the field is fine
const old = newGacha('VM-TEST-MAIL-0000-0000-0001', '审计', '2026-09-02')
delete (old as { mail?: unknown }).mail
check('旧存档没有这个字段也能读', unreadMail(old) === 0 && markMailSeen(old) === false)

console.log(bad ? `\n${bad} 处不对` : '\n全部通过')
process.exit(bad ? 1 : 0)
