import { useEffect, useRef, useState } from 'react'
import { rememberedId } from '../engine/cardid'
import { useDialogFocus } from './cards/useDialogFocus'
import './champions.css'

type Match = { id:string; day:string; time:string; a:string; b:string; start:string }
type Feed = { ok:boolean; enabled:boolean; popup:boolean; today:string; now:number; matches:Match[]; syncedAt:string; stale:boolean; event:{id:string; title:string; start:string; end:string; source:string} }
type Message = { id:string; author?:string; target:string; body:string; created:string; status?:string; reason?:string }
const root = import.meta.env.VITE_API_BASE ?? ''
async function request(path:string, body?:unknown) {
  const response=await fetch(`${root}/api/site/champions${path}`, { method:body?'POST':'GET', headers:body?{'Content-Type':'application/json'}:undefined, body:body?JSON.stringify(body):undefined, cache:'no-store' })
  const data=await response.json()
  if(!response.ok || !data.ok) throw new Error(data.why || '暂时无法连接，请稍后重试。')
  return data
}
function useFeed() {
 const [feed,setFeed]=useState<Feed|null>(null), [error,setError]=useState('')
 useEffect(()=>{let alive=true;const load=()=>{void request('').then(d=>{if(alive){setFeed(d);setError('')}}).catch(e=>{if(alive)setError(e.message)})};load();const timer=setInterval(load,60_000);return()=>{alive=false;clearInterval(timer)}},[])
 return {feed,error}
}
function Schedule({feed,day}:{feed:Feed;day:string}) {
 const rows=feed.matches.filter(m=>m.day===day)
 return <div className="champ-schedule"><div className="champ-section-label"><b>{day === feed.today ? '今日赛程' : `${day.slice(5).replace('-','月')}日赛程`}</b><span>北京时间 UTC+8</span></div>
 {rows.length?rows.map(m=><div className="champ-match" key={m.id}><time dateTime={m.start}>{m.time}</time><b>{m.a==='TBD'?'对阵待定':m.a}</b><span>VS</span><b>{m.b==='TBD'?'对阵待定':m.b}</b></div>):<p className="champ-no-match">今日暂无已公布比赛。休赛日也可以为选手留言。</p>}
 <p className="champ-source">赛程可能调整，以官方通知为准。{feed.stale?'同步暂不可用，当前为最近保存赛程。':''}<a href={feed.event.source} target="_blank" rel="noreferrer">官方赛事公告 ↗</a> · <a href="https://www.vlr.gg/event/matches/2766/valorant-champions-2026" target="_blank" rel="noreferrer">赛程来源 ↗</a><br/>更新于 {new Date(feed.syncedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p></div>
}
export function ChampionsNotice({enabled}:{enabled:boolean}) {
 const {feed}=useFeed(),[open,setOpen]=useState(false)
 const ref=useDialogFocus(()=>setOpen(false),open)
 useEffect(()=>{
  if(!enabled||!feed||!feed.popup||feed.today<feed.event.start||feed.today>feed.event.end||!feed.matches.some(m=>m.day===feed.today))return
  const key=`champions-notice:${feed.event.id}:${feed.today}`
  try{if(localStorage.getItem(key))return}catch{/* Session still works without storage. */}
  if(document.querySelector('[role="dialog"],dialog[open]'))return
  setOpen(true)
  try{localStorage.setItem(key,'1')}catch{/* Optional reminder preference. */}
 },[enabled,feed])
 if(!enabled||!open||!feed)return null
 return <div className="champ-overlay" onClick={()=>setOpen(false)}><section className="champ-notice" role="dialog" aria-modal="true" aria-labelledby="champ-notice-title" ref={ref} tabIndex={-1} onClick={e=>e.stopPropagation()}>
 <button className="champ-close" aria-label="关闭今日赛事提醒" onClick={()=>setOpen(false)}>✕</button><div className="champ-city" aria-hidden="true">上海</div><p className="champ-kicker">2026 无畏契约全球冠军赛</p><h2 id="champ-notice-title">{feed.today===feed.event.start?'上海，今日开战。':'今天，为他们呐喊。'}</h2><p>把想说的话，留给你支持的选手。</p><Schedule feed={feed} day={feed.today}/><a className="champ-cta" href="/champions">查看赛程 · 留下应援</a><button className="champ-later" onClick={()=>setOpen(false)}>先去玩，稍后再看</button></section></div>
}
export default function ChampionsPage() {
 const {feed,error}=useFeed(),[day,setDay]=useState(''),[rows,setRows]=useState<Message[]>([]),[mine,setMine]=useState<Message[]>([]),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[wallError,setWallError]=useState('')
 const [target,setTarget]=useState(''),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState('')
 const account=rememberedId(),requestKey=useRef(''),mounted=useRef(true)
 const loadWall=async(append=false)=>{setLoading(true);setWallError('');try{const d=await request(`/messages?offset=${append?rows.length:0}`);if(mounted.current){setRows(prev=>append?[...prev,...d.rows.filter((r:Message)=>!prev.some(p=>p.id===r.id))]:d.rows);setMore(d.more)}}catch(e){if(mounted.current)setWallError((e as Error).message)}finally{if(mounted.current)setLoading(false)}}
 const loadMine=()=>{if(account)void request('/mine',{id:account}).then(d=>{if(mounted.current)setMine(d.rows)}).catch(()=>{})}
 useEffect(()=>{mounted.current=true;void loadWall();loadMine();return()=>{mounted.current=false}},[account]) // mount/read only; no public post without Submit.
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(busy||!account)return;setBusy(true);setFeedback('');if(!requestKey.current)requestKey.current=`msg_${Date.now()}_${Math.random().toString(36).slice(2)}`
 try{await request('/messages',{id:account,target,body,requestId:requestKey.current});setFeedback('已提交，等待人工审核。通过后会出现在应援墙。');setBody('');requestKey.current='';loadMine()}catch(e){setFeedback((e as Error).message)}finally{setBusy(false)}}
 const selectedDay=day||feed?.today||''
 return <div className="champ-page"><header className="champ-page-nav"><a href="/">← 猪之家首页</a><a href="/cards">返回开瓦包</a></header>
 <section className="champ-hero"><div className="champ-city" aria-hidden="true">上海</div><p className="champ-kicker">2026 无畏契约上海全球冠军赛 · Beta</p><h1>把主场的声音，<br/>送到他们身边。</h1><p>为 CN 呐喊，也为每一位你相信的选手加油。</p><div className="champ-hero-links"><a className="champ-cta" href="#champ-compose">写下你的应援</a><span>09.24 — 10.18 · 上海</span></div></section>
 <p className="champ-muted">Beta 测试版：可能存在显示、交互或赛程同步问题，欢迎通过现有反馈入口告诉我们。</p><div className="champ-columns"><div><section className="champ-panel"><div className="champ-section-label"><h2>比赛日历</h2>{feed&&<label>日期 <input aria-label="选择比赛日期" type="date" min={feed.event.start} max={feed.event.end} value={selectedDay} onChange={e=>setDay(e.target.value)} onInput={e=>setDay(e.currentTarget.value)} onBlur={e=>setDay(e.currentTarget.value)}/></label>}</div>{error&&<p role="status">{error}</p>}{feed?<Schedule feed={feed} day={selectedDay}/>:!error&&<p>正在读取赛程…</p>}</section>
 <section className="champ-panel" id="champ-compose"><h2>写给你支持的他们</h2><p className="champ-muted">每一条留言都由人工审核，通过后公开展示。请勿填写账号 ID、手机号等私人信息。</p>
 {account?<form onSubmit={submit}><label htmlFor="champ-target">致</label><input id="champ-target" maxLength={40} required value={target} aria-describedby="champ-target-help" onChange={e=>{setTarget(e.target.value);requestKey.current=''}} placeholder="写下你想支持的人、队伍或赛区"/><p id="champ-target-help" className="champ-muted">自由填写，最多 40 字，也可以写其他想支持的对象。</p><div className="champ-targets" aria-label="快捷填写建议">{['CN赛区','TYL','XLG','EDG','JDG'].map(t=><button type="button" key={t} aria-pressed={target===t} onClick={()=>{setTarget(t);requestKey.current=''}}>{t}</button>)}</div><label htmlFor="champ-body">想对他们说的话</label><textarea id="champ-body" rows={4} minLength={2} maxLength={200} required value={body} onChange={e=>{setBody(e.target.value);requestKey.current=''}} placeholder="不论比分如何，我们都在这里。"/><div className="champ-compose-foot"><span>{body.length}/200</span><button className="champ-cta" disabled={busy||!feed?.enabled}>{busy?'提交中…':feed?.enabled?'提交审核':'留言暂未开放'}</button></div><p role="status" className="champ-feedback">{feedback}</p></form>:<a className="champ-cta" href="/cards">登录开瓦包后留言</a>}
 {mine.length>0&&<details className="champ-mine"><summary>我的留言 · {mine.length}</summary>{mine.map(m=><article key={m.id}><b>{m.target}</b><span>{m.status==='approved'?'已通过':m.status==='rejected'?'未通过':'待审核'}</span><p>{m.body}</p>{m.reason&&<small>审核说明：{m.reason}</small>}</article>)}</details>}</section></div>
 <section className="champ-wall"><div className="champ-section-label"><h2>应援墙</h2><button disabled={loading} onClick={()=>void loadWall()}>刷新留言</button></div><p className="champ-muted">这里展示已通过人工审核的留言。</p>{rows.map(m=><article className="champ-message" key={m.id}><span className="champ-message-target">致 {m.target}</span><p>{m.body}</p><footer><b>{m.author}</b><time>{new Date(m.created).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}</time></footer></article>)}{!rows.length&&!loading&&!wallError&&<div className="champ-empty"><b>第一声加油，等你留下。</b><p>审核通过的留言会在这里汇聚。</p></div>}{wallError&&<p role="status">{wallError}<button onClick={()=>void loadWall()}>重试</button></p>}{loading&&<p role="status">正在读取留言…</p>}{more&&<button disabled={loading} onClick={()=>void loadWall(true)}>查看更多应援</button>}</section></div></div>
}
