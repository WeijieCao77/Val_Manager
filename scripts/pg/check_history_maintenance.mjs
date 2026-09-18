import assert from 'node:assert/strict'
import { createHistoryMaintenance } from '../../history-maintenance.js'
const tick=()=>new Promise(r=>setImmediate(r))
let release,folds=0,prunes=0,failFold=false,failPrune=false
const gate=()=>new Promise(r=>release=r)
let foldGate=gate()
const sql={},prune=()=>{},order=[],ceilings=[]
const keep=createHistoryMaintenance({getSql:()=>sql,days:180,prune,
 rollup:async db=>{assert.equal(db,sql);folds++;order.push('fold');await foldGate;if(failFold)throw Error('fold failed');return {events:42}},
 pruneFolded:async(db,p,days,max)=>{assert.equal(db,sql);assert.equal(p,prune);assert.equal(days,180);prunes++;order.push('prune');ceilings.push(max);if(failPrune)throw Error('prune failed');return 5}})
const one=keep(100),two=keep(70),three=keep(100)
assert.equal(one,two);assert.equal(two,three)
await tick();assert.equal(folds,1);assert.equal(prunes,0)
release();assert.equal((await one).pruned,5);assert.deepEqual(order,['fold','prune']);assert.deepEqual(ceilings,[70])
failFold=true;foldGate=Promise.resolve();await assert.rejects(keep(100),/fold failed/);assert.equal(prunes,1)
failFold=false;failPrune=true;await assert.rejects(keep(100),/prune failed/)
failPrune=false;assert.equal((await keep(100)).pruned,5);assert.equal(folds,4);assert.equal(prunes,3)
await assert.rejects(keep(0),RangeError)
const skipped=createHistoryMaintenance({getSql:()=>null,rollup:()=>{throw Error('must not run')},pruneFolded:()=>{throw Error('must not run')},prune,days:180})
assert.equal((await skipped(100)).skipped,true)
// Timer callbacks consume rejected maintenance promises; no process crash.
let timerFailure
await new Promise(resolve=>setTimeout(()=>{failFold=true;void keep(100).catch(e=>{timerFailure=e.message}).finally(resolve)},1))
assert.equal(timerFailure,'fold failed')
console.log('PASS history single-flight, strict budget merge, fold failure no-prune, prune failure recovery, unavailable DB, timer rejection handling')
