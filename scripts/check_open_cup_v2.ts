/** Real engine + SQL state-machine validation. PGlite is not a substitute for real PG contention. */
process.env.ENGINE_FROM_SOURCE = '1'
process.env.PHONE_GATE = '0'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { newGacha } from '../src/engine/gacha'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import * as engine from '../src/engine/server'
const { CARD_SCHEMA } = await import('../cards-api.js')
const { OPEN_CUP_SCHEMA, OPEN_CUP_V2_SCHEMA, makeOpenCupApi } = await import('../opencup-api.js')
const { makeSwissCupRunner } = await import('../opencup-v2.js')
const db = new PGlite(), sql = makeSql(db)
await db.exec(CARD_SCHEMA); await db.exec(OPEN_CUP_SCHEMA); await db.exec(OPEN_CUP_V2_SCHEMA)
let now = Date.parse('2026-09-18T03:20:00Z')
let failOnce = false
const compute = async (args: any[]) => { if (failOnce) { failOnce = false; throw new Error('injected worker failure') }; return (engine.playOpenCupMatch as any)(...args) }
const engineBundle = readFileSync(new URL('../dist-server/engine.mjs', import.meta.url))
const cardPoolVersion = createHash('sha256').update(engineBundle).digest('hex')
const opts = { engineBundle, cardPoolVersion, readBody: async (r: any) => r.body, json: (r: any, code: number, body: any) => { r.code = code; r.body = body }, normalizeId: (s: any) => s,
  displayName: (name: any, hash: string) => ({ name: name ?? '玩家', tag: hash.slice(0, 4) }), rateLimited: () => false,
  engine, clock: () => now, timer: false, format: 2, compute }
const api = makeOpenCupApi(sql, opts), twin = makeOpenCupApi(sql, opts)
try {
 for (const n of (process.env.CUP_FIELDS ? process.env.CUP_FIELDS.split(',').map(Number) : [4, 5, 7, 9, 17, 37, 267])) {
  now += 2 * 3600_000
  await api.advance(now)
  const start = engine.openCupSlot(now)
  const cup = (await sql`select id::text as id from open_cups where starts = ${new Date(start)}`)[0]
  await sql`update open_cups set seed = ${n * 199} where id = ${cup.id}`
  const names = Array.from({length:n}, (_,i) => `test-${n}-${i}`)
  for (let i = 0; i < n; i++) {
   const team = CUP_TEAMS[i % CUP_TEAMS.length]
   const g = newGacha(names[i], names[i], '2026-09-18')
   g.squad = structuredClone(team.squad)
   g.cards = Object.fromEntries([...team.squad.slots, team.squad.coach].filter(Boolean).map((id) => [id!, { id: id!, level: i % 4, dupes: 0, seen: 1 }])) as any
   await sql`insert into card_accounts(id_hash, name, state) values (${names[i]}, ${names[i]}, ${sql.json(g)})`
   await sql`insert into open_cup_entries(cup_id,id_hash,name) values (${cup.id},${names[i]},${names[i]})`
  }
  now = start
  if (n === 5) failOnce = true
  await Promise.all([api.advance(now), twin.advance(now)])
  const first = await sql`select * from open_cup_entries where cup_id = ${cup.id}`
  assert.ok(first.every((e: any) => e.alive), 'first loss cannot eliminate')
  assert.ok(first.every((e: any) => Number.isFinite(e.five?.paper?.score)), 'paper score snapshot')
  if (n === 5) {
   const failures = await sql`select * from open_cup_matches where cup_id = ${cup.id} and error is not null`
   assert.equal(failures.length, 1)
   await sql`update open_cup_matches set lease_until = now() - interval '1 second' where cup_id = ${cup.id} and winner is null`
   await api.advance(now)
  }
  // Alter live account data: only frozen fives may be used from this point.
  await sql`update card_accounts set state = '{}' where id_hash in (select id_hash from open_cup_entries where cup_id=${cup.id})`
  for (let round = 1; round < 20; round++) {
   const c = (await sql`select * from open_cups where id = ${cup.id}`)[0]
   if (c.status === 'done') break
   now = start + c.round * c.step_sec * 1000
   await Promise.all([api.advance(now), twin.advance(now)])
  }
  const c = (await sql`select * from open_cups where id = ${cup.id}`)[0]
  assert.equal(c.status, 'done', `n=${n}`)
  assert.equal(c.engine_hash,cardPoolVersion)
  const es = await sql`select * from open_cup_entries where cup_id = ${cup.id}`
  const ms = await sql`select * from open_cup_matches where cup_id = ${cup.id} order by round, slot`
  const real = ms.filter((m:any) => m.b)
  assert.equal(es.filter((e:any) => e.alive).length,1)
  assert.ok(es.every((e:any) => e.swiss_wins === 2 || e.swiss_losses === 2))
  assert.equal(es.reduce((a:number,e:any)=>a+e.wins,0),real.length)
  assert.ok(ms.every((m:any)=>m.b ? Math.max(m.maps_a,m.maps_b)===(m.stage==='swiss'?2:3) : m.maps_a===null && m.maps_b===null && m.detail===null))
  const qualified = es.filter((e:any)=>e.swiss_wins===2)
  assert.equal(real.filter((m:any)=>m.stage!=='swiss').length,qualified.length-1)
  const mail = await sql`select * from card_mail where kind='open_cup' and body->>'cup'=${String(cup.id)}`
  assert.equal(new Set(mail.map((m:any)=>m.to_h)).size,mail.length)
  for (const m of mail) {
   const e = es.find((e:any)=>e.id_hash===m.to_h)
   const p = engine.openCupPurse(n,0,[1,2,4].includes(e.place)?e.place:null)
   assert.equal(m.coins,p.coins+20*e.swiss_real_wins+40*e.playoff_wins)
  }
  await Promise.all([api.advance(now),twin.advance(now)])
  assert.equal((await sql`select count(*)::int as n from open_cup_payouts where cup_id=${cup.id}`)[0].n,mail.length)
  const output:any = {}
  await api.route({ body:JSON.stringify({cup:String(cup.id),stage:'swiss'}) },output,'/api/card/opencup/schedule','test')
  assert.equal(output.body.ok,true)
  assert.ok(output.body.rows.length<=50)
  assert.equal(output.body.next!==null,ms.filter((m:any)=>m.stage==='swiss').length>50)
  console.log(`PASS n=${n}, ${real.length} played, ${qualified.length} qualified, ${mail.length} unique payouts`)
 }
 // Lease fencing: a timed-out worker may not overwrite a newer owner's job.
 const fixture = (await sql`select five from open_cup_entries where five is not null limit 1`)[0].five
 const makeFaultCup = async (offset: number) => {
  const rows = await sql`insert into open_cups(starts,status,format_version,phase,round,rounds,seed,entrants,balance_version)
    values (${new Date(now+offset)},'live',2,'swiss',0,5,42,4,2) returning id::text as id`
  const id=rows[0].id
  for (let i=0;i<4;i++) await sql`insert into open_cup_entries(cup_id,id_hash,name,five) values (${id},${'fault'+i},${'fault'+i},${sql.json(fixture)})`
  await sql`insert into open_cup_matches(cup_id,round,slot,a,b,stage,stage_round,bo) values
    (${id},0,0,'fault0','fault1','swiss',0,3), (${id},0,1,'fault2','fault3','swiss',0,3)`
  return (await sql`select * from open_cups where id=${id}`)[0]
 }
 const rivalOf=(e:any)=>({ name:e.name,tag:'x',...e.five,div:0,points:0 })
 const stale = await makeFaultCup(1000)
 let stole=false
 const slow=makeSwissCupRunner(sql,{engine,rivalOf,simulate:async(args:any[])=>{
  if(!stole){stole=true;await sql`update open_cup_matches set lease_token='new-owner',lease_until=now()+interval '60 seconds' where cup_id=${stale.id} and slot=0 and round=0`}
  return (engine.playOpenCupMatch as any)(...args)
 }})
 await slow.tick(stale)
 assert.equal((await sql`select winner from open_cup_matches where cup_id=${stale.id} and round=0 and slot=0`)[0].winner,null)
 assert.equal((await sql`select wins from open_cup_entries where cup_id=${stale.id} and id_hash='fault0'`)[0].wins,0)
 await sql`update open_cup_matches set lease_until=now()-interval '1 second' where cup_id=${stale.id} and winner is null`
 const recovered=makeSwissCupRunner(sql,{engine,rivalOf,simulate:compute})
 await recovered.tick(stale)
 assert.equal((await sql`select round from open_cups where id=${stale.id}`)[0].round,1)
 console.log('PASS stale worker token fenced; expired lease resumed by fresh runner')

 // A write failure AFTER the result update must roll the result back with the standings.
 const atomic=await makeFaultCup(2000)
 let injected=false
 const wrapped:any=(...args:any[])=>(sql as any)(...args)
 Object.assign(wrapped,sql)
 wrapped.begin=(fn:any)=>sql.begin(async(db:any)=>{
  const guarded:any=(strings:any,...args:any[])=>{
   if(!injected && strings.join('').includes('update open_cup_entries e set wins')){injected=true;throw new Error('injected standings write failure')}
   return db(strings,...args)
  }
  Object.assign(guarded,db)
  return fn(guarded)
 })
 await makeSwissCupRunner(wrapped,{engine,rivalOf,simulate:compute}).tick(atomic)
 assert.equal((await sql`select winner from open_cup_matches where cup_id=${atomic.id} and round=0 and slot=0`)[0].winner,null)
 assert.equal((await sql`select coalesce(sum(wins),0)::int as n from open_cup_entries where cup_id=${atomic.id}`)[0].n,1)
 await sql`update open_cup_matches set lease_until=now()-interval '1 second' where cup_id=${atomic.id} and winner is null`
 await recovered.tick(atomic)
 assert.equal((await sql`select coalesce(sum(wins),0)::int as n from open_cup_entries where cup_id=${atomic.id}`)[0].n,2)
 console.log('PASS result + standings transaction rollback; retry applies exactly once')

 // Age never licenses deleting an unfinished cup.
 const oldDate=new Date(now-30*86400_000)
 await sql`update open_cups set starts=${oldDate} where id=${atomic.id}`
 await sql`update open_cup_matches set lease_until=now()+interval '1 hour' where cup_id=${atomic.id} and winner is null`
 api.invalidate(); await api.advance(now)
 assert.ok((await sql`select 1 from open_cup_entries where cup_id=${atomic.id}`).length===4)
 assert.ok((await sql`select 1 from open_cup_matches where cup_id=${atomic.id}`).length>0)
 console.log('PASS 30-day unfinished cup survives pruning')
} finally { api.close(); twin.close(); await db.close() }
