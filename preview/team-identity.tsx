// Development-only visual fixture. No API calls or account writes.
import {createRoot} from 'react-dom/client'
import {useEffect,useRef,useState} from 'react'
import {ALL_CARDS,isPlayerCard,isCoachCard,squadRating,chemistry} from '../src/engine/cards'
import {WORLD_TEAMS} from '../src/engine/teams'
import {playArenaMatch} from '../src/engine/arena'
import {paintShare} from '../src/ui/cards/shareCard'
import TeamBoard from '../src/ui/cards/TeamBoard'
import CardFace from '../src/ui/Card'
import MatchReport from '../src/ui/cards/Report'
import '../src/styles.css'
import '../src/ui/cards/cards-ux.css'
if(!import.meta.env.DEV)throw new Error('Development only')
const coach=ALL_CARDS.find(c=>isCoachCard(c)&&c.clubTag==='EDG')!
const players=ALL_CARDS.filter(c=>isPlayerCard(c)&&c.clubId===coach.clubId).slice(0,5)
const opponent=WORLD_TEAMS.find(t=>t.tag==='PRX')!.id
const squad={slots:players.map(p=>p.id),coach:coach.id}
function Preview(){const canvas=useRef<HTMLCanvasElement>(null),[report,setReport]=useState(false),[status,setStatus]=useState('正在生成分享图');useEffect(()=>{void paintShare(canvas.current!,{squad,level:()=>0,who:{name:'上海主场'},rating:squadRating(squad,()=>0),chem:chemistry(squad).score}).then(()=>setStatus('分享图已生成')).catch(e=>setStatus(String(e)))},[]);return <main style={{maxWidth:1100,margin:'32px auto',padding:16}}><h1>完整战队阵容 · 本地预览</h1><TeamBoard squad={squad}><div className="team-lineup-players">{players.map(c=><CardFace key={c.id} card={c} level={0}/>)}</div><div className="team-lineup-coach"><p>教练席 · 战术 / 培养 / 激励</p><CardFace card={coach} level={0}/></div></TeamBoard><button onClick={()=>setReport(true)} style={{margin:'24px 0'}}>查看对战结算</button><h2>{status}</h2><canvas ref={canvas} style={{width:'100%',maxWidth:620,height:'auto'}}/>{report&&<MatchReport result={playArenaMatch(squad,()=>0,opponent,1,123)} opponentId={opponent} mySquad={squad} level={()=>0} onClose={()=>setReport(false)}/>}</main>}
createRoot(document.getElementById('root')!).render(<Preview/> )
