import assert from 'node:assert/strict'
import { createCupComputer } from '../opencup-worker.js'
import { CUP_TEAMS } from '../src/engine/cupTeams'
import { playOpenCupMatch } from '../src/engine/openCup'
import { squadPaper } from '../src/engine/cards'
const rival=(i:number)=>({ name:CUP_TEAMS[i].name,tag:'TEST',slots:CUP_TEAMS[i].squad.slots,coach:CUP_TEAMS[i].squad.coach,levels:{},div:0,points:0 })
const a=rival(0),b=rival(1)
const scores:[number,number]=[squadPaper(a).score,squadPaper(b).score]
const worker=createCupComputer()
try {
 for(const balance of [1,2]) for(const bo5 of [false,true]) {
  const expected=playOpenCupMatch(a,b,bo5,4271,balance,scores)
  const actual=await worker.compute([a,b,bo5,4271,balance,scores])
  assert.deepEqual(actual,expected)
 }
 console.log('PASS worker matches direct engine BO3/BO5 balance v1/v2 with frozen scores')
 await assert.rejects(worker.compute([null,null,false,1,2]),/./)
 const again=await worker.compute([a,b,false,10,2,scores])
 assert.ok(again.detail.maps.length>=2)
 worker.close()
 const restarted=await worker.compute([a,b,true,10,2,scores])
 assert.ok(restarted.detail.maps.length>=3)
 console.log('PASS worker error recovery + termination/restart')
} finally { worker.close() }
