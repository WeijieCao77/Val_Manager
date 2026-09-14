/** The stored profile stays bounded across repeated writes, not only one request. */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { makeProfileApi, PROFILE_SCHEMA } from '../profile-api.js'
import { ENDINGS } from '../src/engine/endings'
import { ACHIEVEMENTS } from '../src/engine/achievements'
const db = new PGlite()
await db.exec(PROFILE_SCHEMA)
const api = makeProfileApi(makeSql(db), {
  readBody: async (req: { body: unknown }) => JSON.stringify(req.body),
  json: (res: { body?: any }, _status: number, body: unknown) => { res.body = body },
  rateLimited: () => false,
} as never)
const id = 'VM-2222-2222-2222-2222-2222'
async function save(profile: object) {
  const res: { body?: any } = {}
  await api.route({ body: { id, profile } }, res, '/api/profile/save', 'test')
  assert(res.body.ok)
  return res.body.profile
}
const endings = ENDINGS.map((e) => e.key)
const achievements = ACHIEVEMENTS.map((a) => a.key)
assert(endings.length <= 200 && achievements.length <= 200, 'Raise the bound before the real catalog exceeds it')
await save({ endings: endings.slice(0, 5), achievements: achievements.slice(0, 5) })
let state = await save({ endings: endings.slice(5), achievements: achievements.slice(5) })
assert.deepEqual(new Set(state.endings), new Set(endings))
assert.deepEqual(new Set(state.achievements), new Set(achievements))
console.log('ok  跨设备同步保留完整真实结局与成就目录')
for (let batch = 0; batch < 10; batch++) state = await save({
  endings: Array.from({ length: 200 }, (_, i) => `fake_ending_${batch}_${i}`),
  achievements: Array.from({ length: 200 }, (_, i) => `fake_achievement_${batch}_${i}`),
})
assert.equal(state.endings.length, 200)
assert.equal(state.achievements.length, 200)
assert(endings.every((k) => state.endings.includes(k)))
assert(achievements.every((k) => state.achievements.includes(k)))
state = await save({ endings: [], achievements: [] })
assert.equal(state.endings.length, 200)
assert.equal(state.achievements.length, 200)
console.log('ok  连续追加任意键无法无限扩张，原有真实解锁和旧设备同步均保留')
// Reverse the order: a saturated old record must not block real future unlocks.
await db.exec('delete from site_profiles')
const junk = Array.from({ length: 200 }, (_, i) => `legacy_junk_${i}`)
await save({ endings: junk, achievements: junk })
state = await save({ endings: [endings[0]], achievements: [achievements[0]] })
assert(state.endings.includes(endings[0]))
assert(state.achievements.includes(achievements[0]))
assert.equal(state.endings.length, 200)
assert.equal(state.achievements.length, 200)
// Even within one incoming payload, valid keys after 200 junk keys survive vet().
state = await save({ endings: [...junk, ...endings.slice(1)], achievements: [...junk, ...achievements.slice(1)] })
assert(endings.every((k) => state.endings.includes(k)))
assert(achievements.every((k) => state.achievements.includes(k)))
assert.equal(state.endings.length, 200)
assert.equal(state.achievements.length, 200)
state = await save({ endings: junk, achievements: junk })
assert(endings.every((k) => state.endings.includes(k)))
assert(achievements.every((k) => state.achievements.includes(k)))
console.log('ok  旧垃圾键先占满也不会丢掉新真实解锁，单次末尾真实键和两端解锁均保留')
await db.close()
