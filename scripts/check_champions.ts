import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { makeSql } from '../pglite-sql.js'
import { createHash } from 'node:crypto'
import { makeChampionsApi, CHAMPIONS_SCHEMA } from '../champions-api.js'
import { SITE_SCHEMA } from '../site-api.js'
import { normalizeId } from '../cards-api.js'
import { displayName } from '../names.js'
import { CHAMPIONS, chinaDay, makeSchedule, parseChampionsCalendar } from '../champions-schedule.js'
import { ALL_CARDS, isPlayerCard, isCoachCard } from '../src/engine/cards'
import { squadTeamIdentity, teamBackdrop } from '../src/engine/teamIdentity'
const calendar=readFileSync('data/champions-shanghai-2026.ics','utf8')
const matches=parseChampionsCalendar(calendar)
assert.equal(matches[0].day,'2026-09-24');assert.equal(matches[0].time,'17:00');assert.equal(matches[1].time,'20:00')
assert.equal(chinaDay(new Date('2026-09-23T16:01:00Z')),'2026-09-24')
assert.equal(matches.filter(m=>m.day==='2026-09-28').length,0)
assert(matches.some(m=>m.day==='2026-10-18'))
assert.equal(parseChampionsCalendar(calendar.replaceAll('STATUS:CONFIRMED','STATUS:CANCELLED')).length,0)
const fallback=await makeSchedule(null,async()=>{throw new Error('offline')})()
assert(fallback.stale);assert(fallback.matches.length>0,'upstream failure preserves bundled schedule')
const coach=ALL_CARDS.find(c=>isCoachCard(c)&&ALL_CARDS.filter(p=>isPlayerCard(p)&&p.clubId===c.clubId).length>=5)!
const players=ALL_CARDS.filter(c=>isPlayerCard(c)&&c.clubId===coach.clubId).slice(0,5)
const squad={slots:players.map(p=>p.id),coach:coach.id}
assert.equal(squadTeamIdentity(squad)?.id,coach.clubId)
assert.equal(squadTeamIdentity({...squad,coach:null}),null)
assert.equal(squadTeamIdentity({...squad,slots:[...squad.slots.slice(0,4),null]}),null)
assert.equal(squadTeamIdentity({...squad,slots:squad.slots.map(()=>squad.slots[0])}),null)
const other=ALL_CARDS.find(c=>isPlayerCard(c)&&c.clubId!==coach.clubId)!
assert.equal(squadTeamIdentity({...squad,slots:[other.id,...squad.slots.slice(1)]}),null)
assert(teamBackdrop('#ff4655').startsWith('data:image/svg+xml'))
const db=new PGlite(),sql=makeSql(db)
await db.exec(SITE_SCHEMA+CHAMPIONS_SCHEMA+'create table card_accounts(id_hash text primary key,name text);')
const id='VM-AAAA-AAAA-AAAA-AAAA-AAAA',accountHash=createHash('sha256').update(id).digest('hex')
await sql`insert into card_accounts values(${accountHash},${'支持者'})`
const api=makeChampionsApi(sql,{readBody:async req=>req.body,json:(res,code,body)=>{res.code=code;res.body=body},token:'test-admin',tokenFrom:req=>req.headers.authorization,normalizeId,displayName,fetcher:async()=>new Response(calendar)})
async function call(path,body?,admin=false){const res:any={setHeader(){}};const url=new URL(path,'http://local');await api.route({method:body!==undefined?'POST':'GET',body:JSON.stringify(body),headers:{authorization:admin?'test-admin':''}},res,url.pathname,url);return res}
assert.equal((await call('/api/admin/champions')).code,404)
assert.equal((await call('/api/site/champions/messages',null)).code,400)
assert.equal((await call('/api/site/champions/messages',[])).code,400)
assert.equal((await call('/api/site/champions/messages',{id,target:'CN',body:id,requestId:'private_001'})).code,400)
assert.equal((await call('/api/admin/champions',{action:'config',day:'2026-09-24',matches:[null]},true)).code,400)
assert.equal((await call('/api/site/champions/messages',{id:'bad',target:'CN',body:'加油！',requestId:'test_key_001'})).code,401)
const payload={id,target:'CN赛区',body:'相信你们！<script>alert(1)</script>',requestId:'test_key_001'}
const first=await call('/api/site/champions/messages',payload);assert.equal(first.code,200);assert.equal(first.body.row.status,'pending')
assert.equal((await call('/api/site/champions/messages',payload)).body.row.id,first.body.row.id)
assert.equal((await call('/api/site/champions/messages')).body.rows.length,0,'pending stays private')
assert.equal((await call('/api/site/champions/messages',{...payload,requestId:'test_key_002'})).code,429)
const pending=await call('/api/admin/champions',undefined,true);assert.equal(pending.body.rows.length,1)
const approved=await call('/api/admin/champions',{action:'review',id:first.body.row.id,expected:'pending',status:'approved'},true);assert.equal(approved.code,200)
const publicRows=(await call('/api/site/champions/messages')).body.rows
assert.equal(publicRows.length,1);assert.equal(publicRows[0].body,payload.body)
assert(!JSON.stringify(publicRows).includes(accountHash));assert(!JSON.stringify(publicRows).includes(id));assert(!('status' in publicRows[0]))
assert.equal((await call('/api/admin/champions',{action:'review',id:first.body.row.id,expected:'pending',status:'rejected'},true)).code,409)
assert.equal((await call('/api/admin/champions',{action:'review',id:first.body.row.id,expected:'approved',status:'rejected',reason:'测试撤下'},true)).code,200)
assert.equal((await call('/api/site/champions/messages')).body.rows.length,0)
const mine=(await call('/api/site/champions/mine',{id})).body.rows;assert.equal(mine[0].status,'rejected');assert.equal(mine[0].reason,'测试撤下')
assert.equal((await sql`select * from champion_message_reviews`).length,2)
assert.equal((await call('/api/admin/champions',{action:'config',day:'2026-09-24',matches:[{time:'25:00',a:'A',b:'B'}]},true)).code,400)
assert.equal((await call('/api/admin/champions',{action:'config',day:'2026-09-24',matches:[{time:'18:00',a:'A',b:'B'}]},true)).code,200)
let feed=(await call('/api/site/champions')).body
assert.equal(feed.matches.filter(m=>m.day==='2026-09-24').length,1);assert.equal(feed.matches[0].time,'18:00')
await call('/api/admin/champions',{action:'config',day:'2026-09-24',reset:true},true)
feed=(await call('/api/site/champions')).body;assert.equal(feed.matches[0].time,'17:00');assert.equal(feed.event.id,CHAMPIONS.id)
await call('/api/admin/champions',{action:'config',enabled:false},true)
assert.equal((await call('/api/site/champions/messages',{...payload,requestId:'test_key_003'})).code,403)
await db.close()
console.log('PASS: full-team identity, Shanghai timezone/calendar, authentication, private pending messages, idempotency/rate limit, moderation conflict/withdrawal, schedule overrides and restore')
