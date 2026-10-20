/**
 * 告别期 (2026-10-20): until the site closes, coins are unlimited — every read
 * of an account refills the purse, so what is bought costs nothing by the next
 * action. Off unless the server switches it on, so no other check sees it.
 */
import { FREE_COINS, migrateGacha, newGacha, openPack } from '../src/engine/gacha'

const fail = (m: string) => { console.error('❌ ' + m); process.exit(1) }
if (FREE_COINS.on) fail('默认应关闭')
const id = 'VM-TEST-FREE-0000-0000'
const g = migrateGacha(newGacha(id, '测试', '2026-10-21'), id)
const real = g.coins
if (real >= FREE_COINS.balance) fail('关闭时不该补金币')

FREE_COINS.on = true
const a = migrateGacha(JSON.parse(JSON.stringify(g)), id)
if (a.coins !== FREE_COINS.balance) fail(`打开后应补满，实际 ${a.coins}`)
openPack(a, 'bangkok2025', 'coins', '2026-10-21')
if (a.coins >= FREE_COINS.balance) fail('开包仍应照常扣一次')
const b = migrateGacha(JSON.parse(JSON.stringify(a)), id)
if (b.coins !== FREE_COINS.balance) fail('下一次读取应补回')
const rich = migrateGacha({ ...JSON.parse(JSON.stringify(b)), coins: FREE_COINS.balance + 500 }, id)
if (rich.coins !== FREE_COINS.balance + 500) fail('比上限多的不该被削')
FREE_COINS.on = false
console.log(`✅ 金币无限：${real} → ${FREE_COINS.balance}，开包后下次读取补回`)
