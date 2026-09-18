/** Local HTTP/real PG mixed-load diagnostic; never a production capacity claim. */
process.env.ENGINE_FROM_SOURCE = '1'; process.env.PHONE_GATE = '0'
import postgres from 'postgres'
import { safeTransactions } from '../../db-transactions.js'
import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { performance, monitorEventLoopDelay } from 'node:perf_hooks'
import { writeFile, readFile } from 'node:fs/promises'
const url = process.env.PG_TEST_URL
if (!url || !['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname)) throw new Error('Dedicated localhost PG_TEST_URL required')
const admin = postgres(url,{max:1,onnotice:()=>{}})
const database=`load_${Date.now()}_${randomBytes(4).toString('hex')}`
await admin.unsafe(`create database "${database}"`)
const test = new URL(url); test.pathname='/'+database
const pool = max => postgres(test.toString(),{max,...(process.env.PG_LOAD_MAX_PIPELINE ? {max_pipeline:Number(process.env.PG_LOAD_MAX_PIPELINE)} : {}),onnotice:()=>{},connection:{statement_timeout:30000,lock_timeout:15000}})
const sql=pool(4), bg=pool(1), stats=pool(2)
if (process.env.PG_LOAD_RAW_BEGIN !== '1') for (const client of [sql,bg,stats]) safeTransactions(client)
let server,cup,market
const output={environment:{postgres:18,interactivePool:4,backgroundPool:1,statsPool:2,rateLimits:false,network:'localhost HTTP',sourceEngine:true,reservedBegin:process.env.PG_LOAD_RAW_BEGIN!=='1',maxPipeline:process.env.PG_LOAD_MAX_PIPELINE??'default'},waves:[]}
const errors=[]
try {
 const {CARD_SCHEMA,makeCardApi,normalizeId}=await import('../../cards-api.js')
 const {makeMarketApi}=await import('../../market-api.js')
 const {OPEN_CUP_SCHEMA,OPEN_CUP_V2_SCHEMA,makeOpenCupApi}=await import('../../opencup-api.js')
 const {SCHEMA}=await import('../../analytics.js')
 const {ROLLUP_SCHEMA,rollup}=await import('../../rollup.js')
 const {displayName}=await import('../../names.js')
 const engine=await import('../../src/engine/server.ts')
 const {CUP_TEAMS}=await import('../../src/engine/cupTeams.ts')
 for(const schema of [CARD_SCHEMA,OPEN_CUP_SCHEMA,OPEN_CUP_V2_SCHEMA,SCHEMA,ROLLUP_SCHEMA]) await sql.unsafe(schema).simple()
 const hash=id=>createHash('sha256').update(id).digest('hex'), chars='0123456789ABCDEFGHJKMNPQRSTVWXYZ'
 const ids=Array.from({length:512},(_,i)=>`VM-CVPA-CVPB-CVPC-CVPD-CV${chars[Math.floor(i/32)]}${chars[i%32]}`)
 const today=new Date().toISOString().slice(0,10)
 for(let i=0;i<ids.length;i++) {
  const g=engine.newGacha(ids[i],`测试${i}`,today), team=CUP_TEAMS[i%CUP_TEAMS.length]
  g.coins=100000;g.pulls=100;g.squad=structuredClone(team.squad)
  for(const c of [...g.squad.slots,g.squad.coach].filter(Boolean))g.cards[c]={id:c,level:i%4,dupes:1,seen:2}
  await sql`insert into card_accounts(id_hash,name,state,created,verified) values(${hash(ids[i])},${`测试${i}`},${sql.json(g)},now()-interval '9 days',now())`
 }
 await sql`insert into card_listings(seller_h,card_id,level,ask,ends,hours) select ${hash(ids[511])},'p:P1',0,100,now()+interval '1 day',24 from generate_series(1,1500)`
 await stats`insert into events(ts,n,visitor_id,session_id,seq,device,name,props) select now()-interval '1 hour',n,'visitor'||n,'session'||n,1,'phone','session_start','{}'::jsonb from generate_series(1,5000) n`
 const engineBundle=await readFile(new URL('../../dist-server/engine.mjs',import.meta.url)),cardPoolVersion=createHash('sha256').update(engineBundle).digest('hex')
 const deps={engineBundle,cardPoolVersion,readBody:async req=>{let body='';for await(const c of req)body+=c;return body},json:(res,code,data)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(data))},normalizeId,displayName,rateLimited:()=>false,engine,timer:false}
 const cards=makeCardApi(sql,deps);market=makeMarketApi(sql,{...deps,bg})
 let now=Date.now()
 cup=makeOpenCupApi(sql,{...deps,bg,format:2,clock:()=>now})
 server=createServer(async(req,res)=>{
  try{
   if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return}
   const found=await cards.route(req,res,req.url,'mixed')||await market.route(req,res,req.url,'mixed')
   if(!found){res.writeHead(404);res.end('{}')}
  }catch(e){errors.push({code:e.code??'exception',message:e.message});if(!res.headersSent){res.writeHead(500);res.end('{"ok":false}')}}
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const root=`http://127.0.0.1:${server.address().port}`
 const request=async(path,body)=>{const r=await fetch(root+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const value=await r.json();return {status:r.status,ok:value.ok===true}}
 for(const concurrency of (process.env.PG_LOAD_WAVES??'50,100,300').split(',').map(Number)){
  now+=3*3600_000
  const [c]=await bg`insert into open_cups(starts,seed,format_version,phase) values(${new Date(now)},42,2,'swiss') returning id`
  await bg`insert into open_cup_entries(cup_id,id_hash,name) select ${c.id},id_hash,name from card_accounts`
  await bg`insert into card_listings(seller_h,card_id,level,ask,ends,hours) select ${hash(ids[511])},'p:P2',0,100,now()-interval '1 minute',24 from generate_series(1,1000)`
  const durations={},statuses={},rejections={},delay=monitorEventLoopDelay({resolution:10});delay.enable()
  const start=performance.now(),deadline=start+15000
  const maintenance=(async()=>{
   await Promise.all([market.settleDue({budgetMs:1500}),rollup(stats,{lagSec:0})])
   let rounds=0
   while(rounds++<30){await cup.advance(now);const [row]=await bg`select status,round,step_sec,starts from open_cups where id=${c.id}`;if(row.status==='done')return;now=Number(new Date(row.starts))+Number(row.round)*row.step_sec*1000}
   throw new Error('cup did not finish within 30 advances')
  })().catch(e=>errors.push({code:'maintenance',message:e.message}))
  await Promise.all(Array.from({length:concurrency},async(_,i)=>{
   let j=0
   while(performance.now()<deadline){
    const slot=j++%10,id=ids[i]
    const [name,path,body]=slot===0?['health','/health',null]:slot<4?['load','/api/card/load',{id}]:slot<8?['browse','/api/market/browse',{id,sort:'price'}]:slot===8?['peek','/api/market/peek',{id,ids:['1','2','3']}]:['act','/api/card/act',{id,action:'checkin',args:{},requestId:`load-${concurrency}-${i}-checkin-0001`}]
    const t=performance.now()
    try{const r=await request(path,body);statuses[r.status]=(statuses[r.status]??0)+1;if(!r.ok)rejections[name]=(rejections[name]??0)+1}catch(e){errors.push({code:'http',message:e.message})}
    ;(durations[name]??=[]).push(performance.now()-t)
   }
  }))
  await maintenance;delay.disable()
  const metrics={}
  for(const[name,values]of Object.entries(durations)){values.sort((a,b)=>a-b);const pct=p=>Number(values[Math.min(values.length-1,Math.floor(values.length*p))].toFixed(1));metrics[name]={n:values.length,p50:pct(.5),p95:pct(.95),p99:pct(.99),max:pct(1)}}
  const [matches]=await bg`select count(*)::int as n from open_cup_matches where cup_id=${c.id} and b is not null and winner is not null`
  const wave={concurrency,durationSeconds:Number(((performance.now()-start)/1000).toFixed(2)),metrics,statuses,rejections,cupMatches:matches.n,eventLoopP99Ms:Number((delay.percentile(99)/1e6).toFixed(1))}
  output.waves.push(wave);console.log(JSON.stringify(wave))
 }
 output.errors=errors
 await writeFile(process.env.PG_LOAD_OUT??'analysis/balance_v2/mixed_load_pg.json',JSON.stringify(output,null,2))
 if(errors.length||output.waves.some(w=>Object.keys(w.statuses).some(s=>Number(s)>=500)))process.exitCode=1
}finally{
 cup?.close();market?.close?.();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}
 await Promise.all([sql.end({timeout:5}),bg.end({timeout:5}),stats.end({timeout:5})]);await admin.unsafe(`drop database "${database}" with (force)`);await admin.end({timeout:5})
}
