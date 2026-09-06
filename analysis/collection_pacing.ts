/** Scenario estimate, not a prediction of a particular account's win rate.
 * Run: node --import tsx analysis/collection_pacing.ts [trials=100]
 * Uses production openPack, pity, salvage, check-in, challenge and series rewards.
 * No game balances or player saves are changed.
 */
import { ALL_CARDS, PLAYER_CARDS, COACH_CARDS, LEGEND_CARDS, SALVAGE } from '../src/engine/cards'
import { newGacha, openPack, salvage, checkIn, packCost, PACKS, PACK_ORDER, SERIES, SERIES_REWARDS, claimSeries, QUESTS, recordLadder } from '../src/engine/gacha'
import type { PackKind, GachaState } from '../src/engine/gacha'
import { rewardFor, CHALLENGE_COST } from '../src/engine/challenge'
import { Rng } from '../src/engine/rng'

const trials = Number(process.argv[2] || 100)
const days = Array.from({length:20000}, (_,i)=>new Date(Date.UTC(2026,8,6+i)).toISOString().slice(0,10))
const regularTotal = ALL_CARDS.filter(c=>c.rarity!=='mythic').length
const kinds: PackKind[] = ['scout','elite','coach','cn','pac','ame','emea']
const rarityKeys = ['bronze','silver','gold','mythic'] as const
const poolFor = (kind:PackKind) => {
  const pool=PACKS[kind].pool
  return pool==='coach'?COACH_CARDS:pool==='player'?PLAYER_CARDS:PLAYER_CARDS.filter(c=>c.region===pool)
}
const pools=Object.fromEntries(kinds.map(k=>[k,rarityKeys.map(r=>poolFor(k).filter(c=>c.rarity===r))])) as Record<PackKind, typeof ALL_CARDS[]>
const regionTotals=SERIES.map(r=>PLAYER_CARDS.filter(c=>c.region===r&&c.rarity!=='mythic').length)
const groupByCard = new Map(ALL_CARDS.map(c=>[c.id,kinds.flatMap(k=>pools[k].flatMap((p,i)=>p.some(v=>v.id===c.id)?[[k,i] as const]:[]))]))
const ladderWinByDivision = [.90, .80, .70, .60, .50, .45]
const scenarios=[
 {name:'old_full',energy:28.8}, {name:'new_full',energy:48}, {name:'new_twice_12h',energy:40},
]
const percentile=(xs:number[],q:number)=>xs.slice().sort((a,b)=>a-b)[Math.floor((xs.length-1)*q)]
console.log(JSON.stringify({trials,cardCounts:{total:ALL_CARDS.length,regular:regularTotal,player:PLAYER_CARDS.length-LEGEND_CARDS.length,coach:COACH_CARDS.length,mythic:LEGEND_CARDS.length},assumptions:{ladderWinByDivision,energyCupShare:.25,cupCoins:330,cupTitleChance:.05,challenge:{first:.025,within3:.45,later:.325,fail:.2},upgradeQuests:'skipped; all duplicates recycled',shopping:'maximize expected missing cards per net coin; target regions; honor weekly discount',start:'empty account plus real starter rewards',excluded:'trading, gifts, future cards; no upgrades paid'}}))
for(const scenario of scenarios){
 const results:Record<string,number>[]=[]
 for(let trial=0;trial<trials;trial++){
  const g=newGacha(`estimate-${trial}`,'estimate',days[0]);const rng=new Rng(71823+trial*7919)
  const missing=Object.fromEntries(kinds.map(k=>[k,pools[k].map(p=>p.length)])) as Record<PackKind,number[]>
  let normal=0,players=0,coaches=0,mythic=0,challengeStreak=0,ladderBank=0,cupBank=0
  const regional=[0,0,0,0], claimed=[0,0,0,0]
  const marks:Record<string,number>={};let buys=0,draws365=0
  const open=(kind:PackKind,pay:'pack'|'coins',date:string)=>{
    const cards=openPack(g,kind,pay,date)
    for(const p of cards){
      if(p.dupe) salvage(g,p.card.id,1)
      else {
        for(const [k,r] of groupByCard.get(p.card.id)!) missing[k][r]--
        if(p.card.rarity==='mythic')mythic++
        else {normal++;if(p.card.kind==='coach')coaches++;else{players++;const r=SERIES.indexOf(p.card.region as typeof SERIES[number]);if(r>=0)regional[r]++}}
      }
    }
  }
  const free=(date:string)=>{
    for(const k of PACK_ORDER) while((g.packs[k]??0)>0)open(k,'pack',date)
    for(let r=0;r<4;r++){
      const next=SERIES_REWARDS[claimed[r]]
      if(next&&regional[r]>=Math.ceil(next.at*regionTotals[r])){
        claimSeries(g,SERIES[r]);claimed[r]=g.series?.[SERIES[r]]??0
      }
    }
  }
  const choose=(date:string):PackKind=>{
    let best:PackKind='scout',score=-1
    for(const k of kinds){
      if(k==='coach'&&coaches===COACH_CARDS.length)continue
      const def=PACKS[k], owed=def.mythic>0&&g.mythicDry>=1200
      const gold=g.pity>=44?1:g.pity>=25?Math.min(1,def.gold+(g.pity-24)*.055):def.gold
      const b=Math.max(0,1-gold-def.silver)
      const probs=owed?[0,0,0,1]:[b,Math.min(def.silver,1-gold),gold,def.mythic]
      if(!owed&&def.floor==='silver'){const shift=b**def.draws/def.draws;probs[0]-=shift;probs[1]+=shift}
      let novelty=0,refund=0
      for(let r=0;r<4;r++){
        const n=pools[k][r].length;if(!n)continue
        const unseen=missing[k][r]/n
        novelty+=probs[r]*unseen
        refund+=probs[r]*(1-unseen)*SALVAGE[rarityKeys[r]]
      }
      const value=def.draws*novelty/(packCost(k,date)-def.draws*refund)
      if(value>score){score=value;best=k}
    }
    return best
  }
  for(let day=0;day<days.length;day++){
    const date=days[day];checkIn(g,date)
    // Mix of ladder and cups; fractional energy is retained across days.
    const energy=scenario.energy+(day===0?(scenario.name==='old_full'?15:20):0)
    ladderBank+=energy*.75/2;cupBank+=energy*.25/5
    let played=0,won=0,cups=0
    while(ladderBank>=1){ladderBank--;played++;const win=rng.chance(ladderWinByDivision[g.ladder.div]);if(win)won++;recordLadder(g,win)}
    // Above uses real climb, gold coin rewards and one-time promotion prizes.
    while(cupBank>=1){cupBank--;cups++;g.coins+=330;if(rng.chance(.05))g.packs.elite=(g.packs.elite??0)+1}
    const roll=rng.next(),solved=roll<.8
    challengeStreak=solved?challengeStreak+1:0
    const reward=rewardFor(roll<.025?1:roll<.475?3:6,solved,challengeStreak)
    g.coins+=reward.coins-CHALLENGE_COST
    for(const k of [reward.pack,reward.streakPack])if(k)g.packs[k]=(g.packs[k]??0)+1
    free(date)
    let questDone=0
    for(const k of g.daily.picked){
      const done=k==='play3'?played>=3:k==='win2'?won>=2:k==='cup1'?cups>0:k==='open2'?(g.daily.progress.open2??0)>=2:false
      if(done){g.coins+=QUESTS[k].reward;questDone++}
    }
    if(questDone===3){g.packs.scout=(g.packs.scout??0)+1;free(date)}
    // Banking for a targeted pack is allowed; no buying a worse pack just to spend today.
    let kind=choose(date)
    while(g.coins>=packCost(kind,date)){
      open(kind,'coins',date);buys++;free(date)
      if(normal===regularTotal&&mythic===LEGEND_CARDS.length)break
      kind=choose(date)
    }
    if(day===364)draws365=g.pulls
    for(const [key,ready] of Object.entries({regular50:normal>=regularTotal*.5,regular90:normal>=regularTotal*.9,players:players===524,coaches:coaches===69,regular:normal===regularTotal,all:normal===regularTotal&&mythic===21}))
      if(ready&&marks[key]===undefined)marks[key]=day+1
    if(marks.all)break
  }
  results.push({...marks,pulls:g.pulls,buys,draws365})
 }
 console.log(JSON.stringify({scenario:scenario.name,results:Object.fromEntries(Object.keys(results[0]).map(k=>[k,{p10:percentile(results.map(r=>r[k]),.1),median:percentile(results.map(r=>r[k]),.5),p90:percentile(results.map(r=>r[k]),.9),mean:results.reduce((s,r)=>s+r[k],0)/trials}]))}))
}
