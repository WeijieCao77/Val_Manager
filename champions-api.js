import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { isVerified } from './phone-api.js'
import { CHAMPIONS, chinaDay, makeSchedule } from './champions-schedule.js'
export const CHAMPIONS_SCHEMA = `
create table if not exists champion_messages (
 id text primary key, event text not null, account_hash text not null,
 request_key text not null, author text not null, target text not null, body text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created timestamptz not null default now(), reviewed timestamptz, reason text not null default '',
 unique(account_hash,request_key)
);
create index if not exists champion_messages_public_idx on champion_messages(event,status,created desc);
create index if not exists champion_messages_account_idx on champion_messages(account_hash,created desc);
create table if not exists champion_message_reviews (
 id text primary key, message_id text not null, before_status text not null, after_status text not null,
 reason text not null, created timestamptz not null default now()
);
`
const same = (a,b) => { const x=Buffer.from(String(a??'')), y=Buffer.from(String(b??'')); return x.length>0 && x.length===y.length && timingSafeEqual(x,y) }
const hash = id => createHash('sha256').update(id).digest('hex')
const structuredCloneJson = v => JSON.parse(JSON.stringify(v))
const clean = (v,max) => typeof v === 'string' && v.trim().length <= max ? v.trim().replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'') : ''
/** A real calendar day inside the event, not just a string that sorts between its ends (2026-09-99 did). */
const eventDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= CHAMPIONS.start && day <= CHAMPIONS.end
 && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) === day
export function makeChampionsApi(sql, { readBody, json, token, tokenFrom, normalizeId, displayName, fetcher, rateLimited, bucketOf }) {
 const schedule = makeSchedule(sql, fetcher)
 const read = async req => JSON.parse(await readBody(req, 30_000))
 // Every open home/cards tab reads the feed, so the switches are held in the
 // process for half a minute; the admin's own write drops the copy at once.
 let configCache=null, configAt=0
 const config = async () => {
  if (configCache && Date.now()-configAt < 30_000) return structuredCloneJson(configCache)
  const [r] = await sql`select value from site_config where key='champions_config'`
  configCache = { enabled:true, popup:true, overrides:{}, ...r?.value }; configAt = Date.now()
  return structuredCloneJson(configCache)
 }
 return { async route(req,res,path,url) {
  if (!['/api/site/champions','/api/site/champions/messages','/api/site/champions/mine','/api/admin/champions'].includes(path)) return false
  res.setHeader?.('Cache-Control','no-store')
  const admin=path.startsWith('/api/admin/')
  if (admin && (!token || !same(tokenFrom(req,url),token))) { json(res,404,{ok:false}); return true }
  if (!sql) { json(res,503,{ok:false,why:'留言服务暂不可用，请稍后重试。'}); return true }
  if (!['GET','POST'].includes(req.method)) { json(res,405,{ok:false}); return true }
  let body={}
  if(req.method==='POST' && !admin && rateLimited?.(`ch:${bucketOf?.(req) ?? ''}`, 20)) { json(res,429,{ok:false,why:'操作太频繁，请稍后再试。'}); return true }
 if(req.method==='POST') { try { body=await read(req); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required') } catch { json(res,400,{ok:false,why:'提交格式不正确或内容过长。'}); return true } }
  if (path==='/api/site/champions' && req.method==='GET') {
   const cfg=await config(), feed=await schedule(), today=chinaDay()
   const matches=feed.matches.filter(m=>!Object.prototype.hasOwnProperty.call(cfg.overrides,m.day)).concat(Object.values(cfg.overrides).flat()).sort((a,b)=>(a.day+a.time).localeCompare(b.day+b.time))
   json(res,200,{ok:true,event:CHAMPIONS,enabled:cfg.enabled,popup:cfg.popup,today,now:Date.now(),matches,syncedAt:feed.syncedAt,stale:feed.stale}); return true
  }
  if(path==='/api/site/champions/messages' && req.method==='GET') {
   const limit=24, offset=Math.max(0,Math.min(10000,Math.floor(Number(url.searchParams.get('offset'))||0)))
   const rows=await sql`select id,author,target,body,created from champion_messages where event=${CHAMPIONS.id} and status='approved' order by created desc,id desc limit ${limit+1} offset ${offset}`
   json(res,200,{ok:true,rows:rows.slice(0,limit),more:rows.length>limit}); return true
  }
  if(admin) {
   if(req.method==='GET') {
    const status=['pending','approved','rejected'].includes(url.searchParams.get('status'))?url.searchParams.get('status'):'pending'
    const offset=Math.max(0,Math.min(10000,Math.floor(Number(url.searchParams.get('offset'))||0)))
    const rows=await sql`select id,author,target,body,status,created,reviewed,reason from champion_messages where event=${CHAMPIONS.id} and status=${status} order by created desc,id desc limit 31 offset ${offset}`
    const counts=await sql`select status,count(*)::int as count from champion_messages where event=${CHAMPIONS.id} group by status`
    json(res,200,{ok:true,rows:rows.slice(0,30),more:rows.length>30,counts,config:await config()}); return true
   }
   if(body.action==='config') {
    const old=await config(), next={...old}
    if(typeof body.enabled==='boolean') next.enabled=body.enabled
    if(typeof body.popup==='boolean') next.popup=body.popup
    if(body.day) {
     if(!eventDay(body.day)) { json(res,400,{ok:false,why:'日期不在赛事范围内。'}); return true }
     if(body.reset) delete next.overrides[body.day]
     else {
      if(!Array.isArray(body.matches)||body.matches.length>8||body.matches.some(m=>!m || typeof m!=='object' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.time)||!clean(m.a,60)||!clean(m.b,60))) {json(res,400,{ok:false,why:'请填写有效时间和双方队伍。'});return true}
      next.overrides[body.day]=body.matches.map((m,i)=>({id:`manual-${body.day}-${i}`,day:body.day,time:m.time,a:clean(m.a,60),b:clean(m.b,60),start:new Date(`${body.day}T${m.time}:00+08:00`).toISOString()}))
     }
    }
    await sql`insert into site_config(key,value) values('champions_config',${JSON.stringify(next)}::jsonb) on conflict(key) do update set value=excluded.value,updated=now()`
    configCache=null
    json(res,200,{ok:true});return true
   }
   if(body.action==='review' && ['approved','rejected'].includes(body.status) && ['pending','approved','rejected'].includes(body.expected)) {
    const reason=clean(body.reason??'',200)
    const changed=await sql.begin(async tx=>{
     const [r]=await tx`update champion_messages set status=${body.status},reviewed=now(),reason=${reason} where id=${String(body.id)} and event=${CHAMPIONS.id} and status=${body.expected} returning id`
     if(r) await tx`insert into champion_message_reviews(id,message_id,before_status,after_status,reason) values(${randomUUID()},${r.id},${body.expected},${body.status},${reason})`
     return !!r
    })
    json(res,changed?200:409,{ok:changed,why:changed?undefined:'留言状态已变化，请刷新后再审核。'});return true
   }
   json(res,400,{ok:false,why:'无效操作。'});return true
  }
  if(req.method!=='POST') {json(res,405,{ok:false});return true}
  const id=normalizeId(body.id)
  if(!id) {json(res,401,{ok:false,why:'请先登录开瓦包后留言。'});return true}
  const accountHash=hash(id)
  // a made-up id is turned away on a plain read, before any transaction or row lock
  const [known]=await sql`select 1 as ok from card_accounts where id_hash=${accountHash}`
  if(!known){json(res,401,{ok:false,why:'请先登录有效的开瓦包账号。'});return true}
  if(path==='/api/site/champions/mine') {
   const [account]=await sql`select id_hash from card_accounts where id_hash=${accountHash}`
   if(!account){json(res,401,{ok:false,why:'账号不存在。'});return true}
   const rows=await sql`select id,target,body,status,created,reason from champion_messages where account_hash=${accountHash} and event=${CHAMPIONS.id} order by created desc limit 20`
   json(res,200,{ok:true,rows});return true
  }
  if(path!=='/api/site/champions/messages'){json(res,405,{ok:false});return true}
  if(!(await isVerified(sql,accountHash))){json(res,403,{ok:false,why:'先绑手机号再留言。'});return true}
  const text=clean(body.body,200), target=clean(body.target,40), key=clean(body.requestId,80)
  if(text.length<2||!target||!/^[a-zA-Z0-9_-]{8,80}$/.test(key)){json(res,400,{ok:false,why:'请填写支持对象和 2–200 字留言。'});return true}
  if (/VM(?:[-\s]?[A-Z0-9]{4}){5}/i.test(text+' '+target)) {json(res,400,{ok:false,why:'留言不能包含账号 ID，请删除后再提交。'});return true}
  const cfg=await config()
  if(!cfg.enabled){json(res,403,{ok:false,why:'留言征集暂未开放。'});return true}
  const result=await sql.begin(async tx=>{
   const [account]=await tx`select name from card_accounts where id_hash=${accountHash} for update`
   if(!account) return {code:401,why:'请先登录有效的开瓦包账号。'}
   const [existing]=await tx`select id,status from champion_messages where account_hash=${accountHash} and request_key=${key}`
   if(existing)return {code:200,row:existing}
   const [rate]=await tx`select count(*)::int as total,max(created) as latest from champion_messages where account_hash=${accountHash} and created>now()-interval '24 hours'`
   if(rate.total>=5 || (rate.latest && Date.now()-new Date(rate.latest).getTime()<60_000)) return {code:429,why:'每分钟可提交一条，每 24 小时最多五条，请稍后再来。'}
   const author=displayName(account.name,accountHash).name
   const [row]=await tx`insert into champion_messages(id,event,account_hash,request_key,author,target,body) values(${randomUUID()},${CHAMPIONS.id},${accountHash},${key},${author},${target},${text}) returning id,status`
   return {code:200,row}
  })
  json(res,result.code,{ok:result.code===200,why:result.why,row:result.row});return true
 } }
}
