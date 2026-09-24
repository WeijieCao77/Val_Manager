export const championsAdminHtml = `
<section class="panel" id="champ-admin" style="margin:20px 0;padding:22px;border-top:3px solid #d3a691">
 <div class="row" style="justify-content:space-between"><div><h2 style="font-size:21px;margin:0">上海冠军赛 · 留言审核</h2><p class="why">待审核留言不会对外展示。已通过的留言也可以撤下；每次审核都会保留记录。</p></div><a href="/champions" target="_blank" rel="noreferrer">查看应援墙 ↗</a></div>
 <div class="row" style="gap:8px;margin:14px 0"><button data-champ-status="pending" class="on">待审核</button><button data-champ-status="approved">已通过</button><button data-champ-status="rejected">未通过 / 已撤下</button><button id="champ-refresh">刷新</button><span id="champ-counts" class="muted"></span></div>
 <p id="champ-admin-msg" role="status"></p><div id="champ-review-list"></div><div class="row" style="margin-top:12px"><button id="champ-prev">上一页</button><button id="champ-next">下一页</button></div>
 <details style="margin-top:24px;border-top:1px solid var(--line);padding-top:16px"><summary style="cursor:pointer;font-weight:bold">每日弹窗与赛程管理</summary>
 <p class="why">赛程自动从公开赛事日历同步，每 30 分钟检查一次。手动保存某一天后，以你填写的赛程为准；恢复自动同步即可取消该日覆盖。所有时间为北京时间。</p>
 <div class="row" style="gap:16px"><label><input type="checkbox" id="champ-enabled"> 开放留言投稿</label><label><input type="checkbox" id="champ-popup"> 每日赛事提醒</label><button id="champ-switch-save">保存开关</button></div>
 <div class="row" style="margin-top:16px"><label>比赛日期 <input type="date" id="champ-date" min="2026-09-24" max="2026-10-18"></label><span id="champ-feed-state" class="muted"></span></div>
 <div id="champ-schedule-editor" style="margin:14px 0"></div><div class="row" style="gap:8px"><button id="champ-add-match">添加一场</button><button id="champ-save-day" class="on">保存当天赛程</button><button id="champ-reset-day">恢复当天自动同步</button></div>
 </details>
</section>`
export const championsAdminScript = String.raw`
let champStatus='pending', champOffset=0, champConfig=null, champFeed=null, champMore=false, champBusy=false, champLoadId=0
async function champApi(body) {
 const r=await fetch('/api/admin/champions'+(body?'':'?status='+champStatus+'&offset='+champOffset),{method:body?'POST':'GET',headers:{...auth(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
 const d=await r.json(); if(!r.ok||!d.ok)throw new Error(d.why||'请求失败，请稍后重试'); return d
}
function champSay(s){$('#champ-admin-msg').textContent=s}
async function champLoad() {
 const loadId=++champLoadId, loadedStatus=champStatus
 try {
  const d=await champApi(); if(loadId!==champLoadId)return; champConfig=d.config;champMore=d.more
  $('#champ-counts').textContent=d.counts.map(x=>({pending:'待审核',approved:'已通过',rejected:'未通过'}[x.status])+': '+x.count).join(' · ')
  $('#champ-enabled').checked=d.config.enabled;$('#champ-popup').checked=d.config.popup
  $('#champ-review-list').innerHTML=d.rows.length?d.rows.map(m=>'<article style="padding:18px;margin:10px 0;background:var(--panel-2);border:1px solid var(--line);border-radius:8px" data-message="'+esc(m.id)+'"><div class="row" style="justify-content:space-between"><b>'+esc(m.author)+' → '+esc(m.target)+'</b><span class="muted">'+esc(new Date(m.created).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+'</span></div><p style="font-size:17px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere">'+esc(m.body)+'</p><div class="row" style="gap:8px"><input aria-label="审核说明" maxlength="200" placeholder="审核说明（可选，会展示给投稿者）" value="'+esc(m.reason)+'" style="flex:1;min-width:180px;padding:10px;background:var(--panel);color:var(--text);border:1px solid var(--line)">'+(m.status!=='approved'?'<button data-review="approved" class="on">通过并公开</button>':'')+(m.status!=='rejected'?'<button data-review="rejected">'+(m.status==='approved'?'撤下留言':'不通过')+'</button>':'')+'</div></article>').join(''):'<p class="why" style="padding:24px;text-align:center">这一栏暂无留言。</p>'
  $('#champ-prev').disabled=champOffset===0;$('#champ-next').disabled=!champMore
  $('#champ-review-list').querySelectorAll('[data-review]').forEach(b=>b.onclick=async()=>{
   if(champBusy)return;champBusy=true;b.disabled=true
   const row=b.closest('[data-message]')
   try{await champApi({action:'review',id:row.dataset.message,status:b.dataset.review,expected:loadedStatus,reason:row.querySelector('input').value});champSay(b.dataset.review==='approved'?'已通过，留言现已公开。':'已处理，留言不会对外显示。');await champLoad()}catch(e){champSay(e.message);b.disabled=false}finally{champBusy=false}
  })
 }catch(e){champSay(e.message)}
}
async function champLoadFeed(){try{const r=await fetch('/api/site/champions');champFeed=await r.json();if(!champFeed.ok)throw new Error('赛程暂不可用');if(!$('#champ-date').value)$('#champ-date').value=champFeed.today<champFeed.event.start?champFeed.event.start:champFeed.today>champFeed.event.end?champFeed.event.end:champFeed.today;champDrawDay()}catch(e){champSay(e.message)}}
function champAdd(m={time:'17:00',a:'',b:''}){
 const row=document.createElement('div');row.className='row';row.style.cssText='gap:8px;margin:8px 0'
 row.innerHTML='<input type="time" aria-label="北京时间" value="'+esc(m.time)+'"><input maxlength="60" aria-label="队伍一" placeholder="队伍一" value="'+esc(m.a)+'"><span>VS</span><input maxlength="60" aria-label="队伍二" placeholder="队伍二" value="'+esc(m.b)+'"><button type="button">移除</button>'
 row.querySelectorAll('input').forEach(i=>i.style.cssText='min-height:40px;max-width:100%;padding:8px;background:var(--panel-2);color:var(--text);border:1px solid var(--line)')
 row.querySelector('button').onclick=()=>row.remove();$('#champ-schedule-editor').appendChild(row)
}
function champDrawDay(){if(!champFeed)return;const day=$('#champ-date').value;$('#champ-schedule-editor').innerHTML='';champFeed.matches.filter(m=>m.day===day).forEach(champAdd);$('#champ-feed-state').textContent=(champConfig?.overrides?.[day]?'手动赛程':'自动赛程')+' · 最近同步 '+new Date(champFeed.syncedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}
async function champConfigSave(body){if(champBusy)return;champBusy=true;try{await champApi({action:'config',...body});champSay('设置已保存。');await champLoad();await champLoadFeed()}catch(e){champSay(e.message)}finally{champBusy=false}}
$('#champ-switch-save').onclick=()=>champConfigSave({enabled:$('#champ-enabled').checked,popup:$('#champ-popup').checked})
$('#champ-date').onchange=champDrawDay;$('#champ-add-match').onclick=()=>champAdd()
$('#champ-save-day').onclick=()=>{const matches=[...$('#champ-schedule-editor').children].map(r=>{const x=r.querySelectorAll('input');return{time:x[0].value,a:x[1].value,b:x[2].value}});if(!matches.length&&!confirm('将这一天设为无比赛？'))return;champConfigSave({day:$('#champ-date').value,matches})}
$('#champ-reset-day').onclick=()=>champConfigSave({day:$('#champ-date').value,reset:true})
document.querySelectorAll('[data-champ-status]').forEach(b=>b.onclick=()=>{champStatus=b.dataset.champStatus;champOffset=0;document.querySelectorAll('[data-champ-status]').forEach(x=>x.classList.toggle('on',x===b));champLoad()})
$('#champ-refresh').onclick=champLoad;$('#champ-prev').onclick=()=>{champOffset=Math.max(0,champOffset-30);champLoad()};$('#champ-next').onclick=()=>{champOffset+=30;champLoad()}
champLoad().then(champLoadFeed)
`
