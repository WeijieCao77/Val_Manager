/**
 * Eight squad presets (2026-10-11, five before).
 *
 *   npx tsx scripts/check_presets.ts
 *
 * The server keeps eight; a phone still on the five-slot bundle sends five and
 * must not clear the three it cannot see; deleting the last preset reaches the
 * server instead of coming back on the next load.
 */
import { newGacha, mergeClientFields, presetsOf, savePreset, clearPreset, SQUAD_PRESETS } from '../src/engine/gacha'
import type { GachaState } from '../src/engine/gacha'

let bad = 0
const check = (ok: boolean, what: string, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${info ? `  ${info}` : ''}`); if (!ok) bad++ }
const wire = (g: GachaState) => JSON.parse(JSON.stringify({ name: g.name, squad: g.squad, presets: g.presets, friends: g.friends })) as Partial<GachaState>

check(SQUAD_PRESETS === 8, '八个配置')
const client = newGacha()
for (let i = 0; i < 8; i++) savePreset(client, i, `P${i + 1}`)
const server = mergeClientFields(newGacha(), wire(client))
check(presetsOf(server).every((p, i) => p?.name === `P${i + 1}`), '八个配置都存到服务器', presetsOf(server).map((p) => p?.name).join(','))

// a stale bundle: five slots, the fifth renamed
const stale = wire(client); stale.presets = stale.presets!.slice(0, 5); stale.presets[4] = { ...stale.presets[4]!, name: 'old5' }
mergeClientFields(server, stale)
check(presetsOf(server).map((p) => p?.name).join(',') === 'P1,P2,P3,P4,old5,P6,P7,P8', '旧版五格客户端不清掉 6–8', presetsOf(server).map((p) => p?.name).join(','))

const c2 = newGacha(); savePreset(c2, 6, 'only7')
const s2 = mergeClientFields(newGacha(), wire(c2))
check(presetsOf(s2)[6]?.name === 'only7', '只存第 7 个也能存上')
clearPreset(c2, 6)
mergeClientFields(s2, wire(c2))
check(!presetsOf(s2).some(Boolean), '删掉最后一个配置，服务器也删掉', presetsOf(s2).map((p) => p?.name).join(','))

if (bad) { console.log(`${bad} failed`); process.exit(1) }
console.log('全部通过')
