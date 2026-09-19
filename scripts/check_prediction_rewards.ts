/** Group reward tiers, trusted results and once-only collection after save reloads. */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha, migrateGacha, mergeClientFields } from '../src/engine/gacha'
import { runAction } from '../src/engine/cardActions'
import { CHAMPIONS_2026 as EV, PREDICT_RESULTS, predictionReward, confirmedResult } from '../src/engine/predict'
import type { Picks } from '../src/engine/predict'

const group = EV.groups.find(g => g.key === 'C')!
const before = Date.parse('2026-09-20T00:00Z'), after = group.at.d + 4 * 3600000
const result = { first: 'PRX', second: 'TL', confirmedAt: after }
const cases: [string, Picks, { elite: number; ten: number }][] = [
  ['两队名次全对', { o1: 'PRX', o2: 'G2', w: 'PRX', e: 'TL', d: 'TL' }, { elite: 0, ten: 2 }],
  ['两队颠倒', { o1: 'TL', o2: 'G2', w: 'TL', e: 'PRX', d: 'PRX' }, { elite: 5, ten: 0 }],
  ['第一名正确', { o1: 'PRX', o2: 'G2', w: 'PRX', e: 'TL', d: 'G2' }, { elite: 0, ten: 1 }],
  ['第二名正确', { o1: 'PRX', o2: 'G2', w: 'G2', e: 'TL', d: 'TL' }, { elite: 0, ten: 1 }],
  ['仅一队晋级且名次错', { o1: 'PRX', o2: 'G2', w: 'G2', e: 'TL', d: 'PRX' }, { elite: 3, ten: 0 }],
  ['都没猜中', { o1: 'TL', o2: 'G2', w: 'G2', e: 'TYL', d: 'TYL' }, { elite: 0, ten: 0 }],
  ['空预测', {}, { elite: 0, ten: 0 }],
  ['只保存首轮不算晋级预测', { o1: 'PRX', o2: 'G2' }, { elite: 0, ten: 0 }],
]
const env = (now: number) => ({ now, today: new Date(now).toISOString().slice(0, 10), seed: 1 })
const claim = (g: ReturnType<typeof newGacha>, extra = {}) => runAction(g, 'predict_claim', { event: EV.id, group: 'C', ...extra }, env(after))
const saved = () => {
  const g = newGacha('prediction-rewards', '预测', '2026-09-20')
  assert(runAction(g, 'predict', { event: EV.id, group: 'C', picks: cases[0][1] }, env(before)).ok)
  return g
}
for (const [name, picks, reward] of cases) {
  assert.deepEqual(predictionReward(group, picks, result), reward, name)
  console.log('PASS', name, reward)
}
const original = PREDICT_RESULTS[EV.id].C
try {
  delete PREDICT_RESULTS[EV.id].C
  const forged = saved(), packs = structuredClone(forged.packs)
  assert(!claim(forged, { result, reward: { ten: 99 }, confirmedAt: after }).ok)
  assert.deepEqual(forged.packs, packs)
  PREDICT_RESULTS[EV.id].C = result
  assert.equal(confirmedResult(EV.id, group, after - 1), null)
  for (const bad of [
    { ...result, second: 'PRX' }, { ...result, first: 'EDG' },
    { ...result, confirmedAt: group.at.d }, { ...result, confirmedAt: NaN },
  ]) {
    PREDICT_RESULTS[EV.id].C = bad
    assert.equal(confirmedResult(EV.id, group, after), null)
    assert(!claim(saved()).ok)
  }
  PREDICT_RESULTS[EV.id].C = result
  assert(!runAction(saved(), 'predict_claim', { event: EV.id, group: 'C' }, env(after - 1)).ok)
  for (const [name, picks, reward] of cases) {
    const g = newGacha(name)
    assert(runAction(g, 'predict', { event: EV.id, group: 'C', picks }, env(before)).ok)
    const initial = { elite: g.packs.elite ?? 0, ten: g.packs.ten ?? 0 }
    const got = claim(g)
    assert.equal(got.ok, reward.elite + reward.ten > 0)
    assert.equal(g.packs.elite ?? 0, initial.elite + reward.elite)
    assert.equal(g.packs.ten ?? 0, initial.ten + reward.ten)
    const reloaded = migrateGacha(JSON.parse(JSON.stringify(g)), g.id)
    mergeClientFields(reloaded, { predict: { [EV.id]: { C: { picks, at: before, claimedAt: 0 } } }, packs: { ten: 999 } } as never)
    assert(!claim(reloaded).ok, `${name}: duplicate rejected after reload/client merge`)
    assert.deepEqual(reloaded.packs, g.packs)
  }
  const late = saved()
  late.predict![EV.id].C.at = group.at.o1
  assert(!claim(late).ok)
  assert(!claim(saved(), { event: 'fake' }).ok)
  assert(!claim(saved(), { group: 'Z' }).ok)
  const g = saved()
  assert(claim(g).ok)
  assert(!runAction(g, 'predict', { event: EV.id, group: 'C', picks: cases[1][1] }, env(after)).ok)
  assert(g.predict![EV.id].C.claimedAt)
  console.log('PASS trusted results, closed picks, tier payouts, migration and repeated claims')
  // Exercise real persistence: two simultaneous claims with different request IDs
  // still pay once, and replaying the successful request cannot mint more packs.
  const { CARD_SCHEMA, makeCardApi } = await import('../cards-api.js')
  const db = new PGlite(), sql = makeSql(db)
  const realNow = Date.now
  try {
    await db.exec(CARD_SCHEMA)
    const id = 'VM-BBBB-BBBB-BBBB-BBBB-BBBB'
    const hash = createHash('sha256').update(id).digest('hex')
    const account = newGacha(id, '预测并发', '2026-09-20')
    assert(runAction(account, 'predict', { event: EV.id, group: 'C', picks: cases[0][1] }, env(before)).ok)
    const starting = account.packs.ten ?? 0
    await sql`insert into card_accounts (id_hash, name, state, verified) values (${hash}, '预测并发', ${JSON.stringify(account)}, now())`
    const api = makeCardApi(sql, {
      rateLimited: () => false, readBody: async (req: { body: string }) => req.body,
      json: (res: any, _code: number, body: any) => { res.body = body },
    } as never)
    const ask = async (requestId: string) => {
      const res: any = {}
      await api.route({ method: 'POST', body: JSON.stringify({ id, action: 'predict_claim', requestId,
        args: { event: EV.id, group: 'C', reward: { ten: 999 } },
        client: { predict: {}, packs: { ten: 999 } },
      }) } as never, res, '/api/card/act', 'prediction')
      return res.body
    }
    Date.now = () => after
    const ids = ['prediction-claim-00000001', 'prediction-claim-00000002']
    const replies = await Promise.all(ids.map(ask))
    assert.equal(replies.filter(r => r.ok).length, 1)
    const stored = async () => (await sql`select state from card_accounts where id_hash = ${hash}`)[0].state
    assert.equal((await stored()).packs.ten, starting + 2)
    assert((await stored()).predict[EV.id].C.claimedAt)
    await ask(ids[replies.findIndex(r => r.ok)])
    assert.equal((await stored()).packs.ten, starting + 2)
    console.log('PASS API transaction, concurrent claims, request replay and forged client reward')
  } finally { Date.now = realNow; await db.close() }
} finally {
  if (original) PREDICT_RESULTS[EV.id].C = original
  else delete PREDICT_RESULTS[EV.id].C
}
