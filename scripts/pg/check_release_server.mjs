/** Production server startup against disposable PG: alive != ready. */
import postgres from 'postgres'
import { safeTransactions } from '../../db-transactions.js'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { releaseFingerprint } from '../../release-fingerprint.js'
const raw=process.env.PG_TEST_URL
if(!raw||!['localhost','127.0.0.1','[::1]'].includes(new URL(raw).hostname))throw Error('Dedicated localhost PG_TEST_URL required')
const admin=postgres(raw,{max:1,onnotice:()=>{}}),name=`release_${Date.now()}_${randomBytes(4).toString('hex')}`
await admin.unsafe(`create database "${name}"`)
const url=new URL(raw);url.pathname='/'+name
const sql=safeTransactions(postgres(url.toString(),{max:1,onnotice:()=>{}}))
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
let child,release,locked
const gate=new Promise(r=>release=r),ready=new Promise(r=>locked=r)
const blocker=sql.begin(async db=>{await db`select pg_advisory_xact_lock(5150409)`;locked();await gate})
let logs=''
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const origin=`http://127.0.0.1:${port}`
try{
 await ready
 const expected=releaseFingerprint()
 child=spawn(process.execPath,['--import','./scripts/pg/history-timer-loader.mjs','server.js'],{env:{...process.env,NODE_ENV:'production',PG_ACCELERATE_HISTORY_TEST:'1',DATABASE_URL:url.toString(),PORT:String(port),PHONE_KEY:randomBytes(32).toString('hex'),PHONE_SALT:randomBytes(32).toString('hex'),ANALYTICS_TOKEN:randomBytes(32).toString('hex'),OPEN_CUP_FORMAT:'2'},stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x)
 let health
 for(let i=0;i<100;i++){try{health=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(500)});break}catch{};await pause(100)}
 assert.equal(health?.status,200,'port must open while migration blocked')
 assert.equal(health.headers.get('x-release-sha256'),expected)
 const before=await fetch(origin+'/readyz');assert.equal(before.status,503)
 const api=await fetch(origin+'/api/card/load',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(api.status,503)
 console.log('PASS health responds; readiness and APIs refuse before migration completes')
 release();await blocker
 let state
 for(let i=0;i<200;i++){const r=await fetch(origin+'/readyz');state=await r.json();if(r.status===200)break;await pause(100)}
 assert.equal(state.ready,true,JSON.stringify(state));assert.equal(state.db,'up');assert.equal(state.release,expected)
 assert.ok(Object.keys(state.features).length>=10);assert.ok(Object.values(state.features).every(Boolean))
 console.log('PASS asynchronous schema completes; all feature/uniqueness gates ready; release fingerprint matches')
 await pause(500)
 assert.ok(logs.includes('TEST_HISTORY_BOOT_TIMER_FIRED'));assert.ok(logs.includes('TEST_HISTORY_HOURLY_TIMER_FIRED'))
 assert.equal(child.exitCode,null);assert.ok(!logs.includes('history maintenance failed'),logs);assert.equal((await fetch(origin+'/healthz')).status,200)
 console.log('PASS actual boot/hourly history timers execute without process failure (test clock accelerated)')
 if(releaseFingerprint()===expected){
  const code=await new Promise(done=>{const verifier=spawn(process.execPath,['scripts/verify_deployment.mjs',origin],{env:{...process.env,DEPLOY_WAIT_MS:'1000'},stdio:'inherit'});verifier.on('exit',done)})
  assert.equal(code,0);console.log('PASS deployment verifier matches server/backend/engine/frontend bytes')
 }else console.log('SKIP deployment byte verifier: working tree changed during startup; freeze before deploy')
}finally{
 release();await blocker.catch(()=>{})
 if(child&&child.exitCode===null){const closed=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await closed}
 await sql.end({timeout:5});await admin.unsafe(`drop database "${name}" with (force)`);await admin.end({timeout:5})
 if(process.env.PG_SHOW_SERVER_LOG==='1')console.log(logs)
}
