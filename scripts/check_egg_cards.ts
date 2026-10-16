/**
 * 彩蛋卡 (2026-10-16): the 回溯 lukxo.
 *
 *   npx tsx scripts/check_egg_cards.ts
 *
 * 「LOUD 输掉一个回合后比分没有变成 3 比 0，而是回溯成了 2 比 0」 — a joke card
 * on the real lukxo (P41): rating 32, the owner hands it out from the
 * dashboard. It must be ownable (a grant, the mail, the market all go through
 * ownableCard), never dealt by a pack and never counted by the 全图鉴.
 */
import { existsSync } from 'node:fs'
import { ALL_CARDS, EGG_CARDS, cardById, isPlayerCard, ownableCard, personOf, squadPaper } from '../src/engine/cards'
import { matchesFilter, EMPTY_FILTER, seriesOf } from '../src/engine/cardFilter'
import { collection, newGacha, openPacks, PACKS, SERVER_KEYS } from '../src/engine/gacha'
import type { PackKind } from '../src/engine/gacha'
import { applyMail } from '../src/engine/inbox'
import { runAction } from '../src/engine/cardActions'
import { redeemFor, normCode } from '../redeem-codes.js'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import world from '../src/data/world.json'

let bad = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) bad++
}

const ID = 'egg:lukxo-rewind'
const card = cardById(ID)
check('回溯卡存在、能持有', !!card && !!ownableCard(ID))
if (!card || !isPlayerCard(card) || !card.egg) { console.log('FAIL 回溯卡不是带彩蛋信息的选手卡'); process.exit(1) }

const him = (world as any).players.find((p: any) => p.id === 'P41')
check('是真实的 lukxo（P41）', him?.ign === 'lukxo' && card.ign === 'lukxo' && card.realName === him.realName && card.nat === him.nat, `${card.ign} ${card.realName} ${card.nat}`)
check('和现役 lukxo 是同一个人', personOf(card) === personOf(cardById('p:P41')!))
check('总评 32', card.rating === 32)
check('沟通、指挥 99', card.attrs.communication === 99 && card.attrs.igl === 99)
check('属性都在 1–99', Object.values(card.attrs).every((v) => v >= 1 && v <= 99))
check('系列：彩蛋卡', card.event === 'egg' && seriesOf(card) === 'egg' && matchesFilter(card, { ...EMPTY_FILTER, series: 'egg' }))
const art = card.egg.art.replace(/^.*?events\//, 'public/events/').replace(/\?.*$/, '')
check('卡面图在 public 里', existsSync(art), art)
check('有照片（vlr）', !!card.face)

check('不在 ALL_CARDS（不进全图鉴、不进卡包）', !ALL_CARDS.some((c) => c.id.startsWith('egg:')))
check('EGG_CARDS 只有这一张', EGG_CARDS.length === 1 && EGG_CARDS[0].id === ID)

// every pack, opened a lot: nothing egg comes out
const g = newGacha('VM-TEST-EGG0-0000', 'egg', '2026-10-16')
let dealt = 0
let opened = 0
for (const kind of Object.keys(PACKS) as PackKind[]) {
  for (let i = 0; i < 40; i++) {
    g.packs[kind] = 10
    const r = openPacks(g, kind, 'pack', 10, '2026-10-16')
    opened += r.length
    dealt += r.flat().filter((p) => p.card.id.startsWith('egg:')).length
  }
}
check(`卡包开不出彩蛋卡（${opened} 包）`, opened > 0 && dealt === 0 && !Object.keys(g.cards).some((id) => id.startsWith('egg:')))

// the dashboard's 发卡: a grant row with the card id
const h = newGacha('VM-TEST-EGG1-0000', 'egg', '2026-10-16')
applyMail(h, [{ kind: 'grant', cardId: ID, level: 0, coins: 0, pack: null, count: 1, body: { note: '回溯' }, at: Date.now() }])
check('后台发卡能收到', !!h.cards[ID] && collection(h).some((x) => x.card.id === ID))
const paper = squadPaper({ slots: [null, null, null, ID, null], coach: null })
check('能上阵、按 32 算', paper.players === 1 && paper.mean === 32, `${paper.players} 人 均分 ${paper.mean}`)

// 口令领卡: the server proves the code (redeem-codes.js), the engine hands the card over once
console.log('=== 口令领卡 ===')
check('口令不对：没有结果', redeemFor('回溯-AAAA-BBBB-CCCC') === null && redeemFor('') === null && redeemFor(undefined) === null)
const own = { REDEEM_LUKXO_REWIND: '回溯-TEST-2026' }
check('后台变量换口令：新口令能领', redeemFor(' 回溯 test 2026 ', own)?.cardId === ID)
check('换了口令，旧的不认', redeemFor('回溯-AAAA-BBBB-CCCC', own) === null && redeemFor('TEST2025', own) === null)
check('口令只比字母数字、不分大小写', normCode('回溯-ab12-CD34') === 'AB12CD34')
const env = { now: Date.now(), today: '2026-10-16', seed: 1 }
const r0 = newGacha('VM-TEST-EGG2-0000', 'egg', '2026-10-16')
const wrong = runAction(r0, 'redeem', { code: 'nope' }, { ...env, redeem: null })
check('错的口令领不到', !wrong.ok && !r0.cards[ID], !wrong.ok ? wrong.why : '')
const right = runAction(r0, 'redeem', { code: 'x' }, { ...env, redeem: redeemFor('回溯-TEST-2026', own) })
check('对的口令领到一张', right.ok && !!r0.cards[ID] && r0.cards[ID].dupes === 0 && !!r0.redeemed?.includes('lukxo-rewind'))
const again = runAction(r0, 'redeem', { code: 'x' }, { ...env, redeem: redeemFor('回溯-TEST-2026', own) })
check('领过的记录跟着服务器回到前端', (SERVER_KEYS as readonly string[]).includes('redeemed'))
check('同一个账号只能领一次', !again.ok && r0.cards[ID].dupes === 0, !again.ok ? again.why : '')
// nothing under src/ (the browser bundle) knows the code or its hash
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])
const leak = walk('src').filter((f) => /\.(ts|tsx|js|json)$/.test(f)).filter((f) => {
  const t = readFileSync(f, 'utf8')
  return /(import|from)[^\n]*redeem-codes/.test(t) || t.includes('0345359ccba03beb') || t.includes('826263363af8a977')
})
check('前端代码里没有口令', leak.length === 0, leak.join(', '))

console.log(bad ? `\n${bad} FAIL` : '\nall ok')
process.exit(bad ? 1 : 0)
