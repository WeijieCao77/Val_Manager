/**
 * The dashboard, served as one self-contained page.
 *
 * No build step and no libraries: it is a page the owner opens a few times a
 * week, and a chart library would be more code than the whole server. Every
 * panel names the decision it supports, because a number nobody would act on
 * is a number that should not be on the screen.
 */
export const dashboardHtml = () => `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>VAL MANAGER · 游玩数据</title>
<style>
  :root {
    --bg:#0b1017; --panel:#16202c; --panel-2:#1b2735; --line:#26333f;
    --text:#e8eef5; --muted:#8ea2b8; --faint:#5d6f83;
    --accent:#ff4655; --win:#3dd68c; --warn:#f6c445;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; padding:18px; background:var(--bg); color:var(--text);
    font:14px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  h1 { font-size:15px; letter-spacing:.18em; text-transform:uppercase; margin:0 0 2px; }
  h1 span { color:var(--accent); }
  .sub { color:var(--faint); font-size:12px; margin-bottom:16px; }
  /* align-items:start, or every panel in a row is stretched to the tallest
     one in it — a ten-row referrer list made the four panels beside it a
     thousand pixels of empty. */
  .grid { display:grid; gap:12px; align-items:start;
          grid-template-columns:repeat(auto-fit,minmax(270px,1fr)); }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:13px; }
  .wx-row { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }
  .wx-side { flex:1 1 300px; min-width:260px; }
  .wx-preview { flex:0 0 200px; text-align:center; }
  .wx-preview img { width:200px; height:200px; object-fit:contain;
                    background:#fff; border-radius:4px; }
  .wx-toggle { display:flex; align-items:center; gap:7px; cursor:pointer; }
  #grant input[type=text], #grant input[type=number], #grant select,
  #wechat input[type=text], #wechat input[type=file] {
    width:100%; background:var(--panel-2); color:var(--text);
    border:1px solid var(--line); border-radius:3px; padding:7px 9px; font:inherit;
  }
  .panel h2 {
    font-size:11px; letter-spacing:.14em; text-transform:uppercase;
    color:var(--muted); margin:0 0 10px; font-weight:700;
  }
  .why { color:var(--faint); font-size:11px; margin-top:9px; line-height:1.5; }
  .big { font-size:34px; font-weight:800; font-variant-numeric:tabular-nums; line-height:1.1; }
  .big small { font-size:13px; color:var(--muted); font-weight:400; margin-left:6px; }
  .hero { border-left:2px solid var(--accent); }
  /* A panel is a glance, not a document. The long lists — referrers, clubs,
     screens, unlocks — ran to fifteen rows and made the whole row of panels
     as tall as the longest one in it. They scroll inside their own box now,
     so nothing is dropped and no panel is taller than a screenful. */
  .tw { max-height:300px; overflow-y:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--faint); font-size:10px; letter-spacing:.1em;
       text-transform:uppercase; padding:5px 6px; border-bottom:1px solid var(--line);
       position:sticky; top:0; background:var(--panel); z-index:1; }
  td { padding:5px 6px; border-bottom:1px solid rgba(255,255,255,.04); }
  td.n { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .bar { height:7px; background:var(--accent); border-radius:2px; min-width:2px; }
  .bar.g { background:var(--win); }
  .spark { display:flex; align-items:flex-end; gap:2px; height:56px; margin-top:4px; }
  /* height:100% is load-bearing. align-items:flex-end stops the columns being
     stretched, and their only child is absolutely positioned — so they were
     zero pixels tall, the bar inside was a percentage OF zero, and the daily
     chart had been rendering as an empty box. */
  .spark i { flex:1; height:100%; background:var(--panel-2); border-radius:1px 1px 0 0; position:relative; }
  .spark i b { position:absolute; inset:auto 0 0 0; background:var(--accent); border-radius:1px 1px 0 0; display:block; }
  .muted { color:var(--muted); }
  .empty { color:var(--faint); padding:14px 0; text-align:center; }
  a { color:var(--accent); }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  button { background:var(--panel-2); color:var(--text); border:1px solid var(--line);
           border-radius:3px; padding:5px 11px; font:inherit; font-size:12px; cursor:pointer; }
  button.on { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:650; }
</style>
</head>
<body>
<h1>VAL<span>MANAGER</span> · 游玩数据</h1>
<div class="sub">
  身份是浏览器首次访问时生成的匿名 ID，服务端不记录、不存储 IP 地址。
  「时长」只累计确认活跃的分钟数——标签页挂着过夜不算。
</div>
<div class="row" style="margin-bottom:14px">
  <span class="muted" style="font-size:12px">时间范围</span>
  <button data-d="7">7 天</button>
  <button data-d="30" class="on">30 天</button>
  <button data-d="90">90 天</button>
  <span id="status" class="muted" style="font-size:12px;margin-left:auto"></span>
</div>
<div class="panel" id="wechat" style="margin-bottom:14px">
  <h2>微信群二维码 · 首页那个浮窗</h2>
  <div class="wx-row">
    <div class="wx-side">
      <label class="wx-toggle">
        <input type="checkbox" id="wxOn"> <span>在首页显示「微信群」按钮</span>
      </label>
      <p class="why" style="margin:6px 0 10px">
        关掉之后首页就没有这个按钮了。没传二维码时也不会显示——
        与其给一个打不开的空框，不如干脆没有。
      </p>
      <input type="file" id="wxFile" accept="image/png,image/jpeg,image/webp">
      <p class="why" style="margin:6px 0 10px">
        微信群二维码<b>七天过期</b>，过期了在这里换一张就行，不用重新部署。
        PNG / JPG / WebP，不超过 600KB。
      </p>
      <input type="text" id="wxNote" maxlength="60" placeholder="二维码下面那行小字（可留空）">
      <div class="row" style="margin-top:10px">
        <button id="wxSave" class="on">保存</button>
        <button id="wxDrop">删掉二维码</button>
        <span id="wxMsg" class="muted" style="font-size:12px"></span>
      </div>
    </div>
    <div class="wx-preview">
      <div class="why" style="margin-bottom:6px">预览</div>
      <img id="wxImg" alt="" style="display:none">
      <div id="wxNone" class="empty" style="padding:30px 10px">还没有二维码</div>
    </div>
  </div>
</div>
<div class="panel" id="grant" style="margin-bottom:14px">
  <h2>给玩家发东西</h2>
  <div class="wx-row">
    <div class="wx-side">
      <input type="text" id="gWho" placeholder="8 位对战码，或者完整的账号 ID">
      <p class="why" style="margin:6px 0 10px">
        <b>优先用对战码</b>（玩家在「好友」页能复制）。账号 ID 也认，但那串是他登录用的，
        能不经手就不经手。
      </p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <select id="gPack">
          <option value="">不发卡包</option>
          <option value="scout">试训包</option>
          <option value="elite" selected>选拔包</option>
          <option value="ten">十连包</option>
          <option value="coach">教练包</option>
          <option value="cn">中国包</option>
          <option value="pac">太平洋包</option>
          <option value="ame">美洲包</option>
          <option value="emea">EMEA 包</option>
        </select>
        <input type="number" id="gCount" value="1" min="1" max="50" style="width:80px" title="几个">
        <input type="number" id="gCoins" placeholder="金币（可空）" style="width:130px">
      </div>
      <input type="text" id="gNote" maxlength="80" placeholder="附言，玩家会看到（可空）" style="margin-top:8px">
      <div class="row" style="margin-top:10px">
        <button id="gSend" class="on">发放</button>
        <span id="gMsg" class="muted" style="font-size:12px"></span>
      </div>
      <p class="why" style="margin-top:10px">
        发放会进玩家的<b>信箱</b>，他下次打开卡池自动收下并看到提示。
        不会直接改他的存档——那是他客户端的事，这条规矩是上次存档被覆盖之后定下的。
      </p>
    </div>
  </div>
</div>
<div id="app"></div>
<footer style="margin-top:20px;padding-top:14px;border-top:1px solid var(--line);
               color:var(--faint);font-size:11px;text-align:center;line-height:1.8">
  作者：<b style="color:var(--muted)">猪之家</b>出品 ·
  小红书<b style="color:var(--muted)">@点点点点点点点点</b> ·
  抖音<b style="color:var(--muted)">@点点点点点点点点</b>
</footer>

<script>
const $ = (s) => document.querySelector(s)
// The token arrives once, in the link that opens this page, and is then
// taken out of the address bar: a URL gets copied, screenshotted and logged,
// and every request from here sends it as a header instead.
const token = (() => {
  const q = new URLSearchParams(location.search)
  let t = q.get('token') || ''
  try {
    if (t) sessionStorage.setItem('admin_token', t)
    else t = sessionStorage.getItem('admin_token') || ''
  } catch { /* storage blocked: the token lives for this page load only */ }
  if (q.has('token')) {
    q.delete('token')
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''))
  }
  return t
})()
const auth = () => ({ Authorization: 'Bearer ' + token })
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0)
// A cohort from yesterday has not had a seventh day yet. Printing 0% there
// reads as "nobody came back" when the honest answer is "not knowable yet".
const age = (cohort, needDays, value) => {
  const days = (Date.now() - new Date(cohort).getTime()) / 86400000
  return days < needDays ? '<span class="muted">—</span>' : value + '%'
}

function panel(title, inner, why) {
  return '<div class="panel"><h2>' + title + '</h2>' + inner +
    (why ? '<div class="why">' + why + '</div>' : '') + '</div>'
}

function table(head, rows) {
  if (!rows.length) return '<div class="empty">还没有数据</div>'
  return '<div class="tw"><table><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
}

function render(d) {
  const h = d.headline || {}, s = d.sessions || {}, f = d.funnel || {}, dep = d.depth || {}
  const max = Math.max(1, ...(d.daily || []).map((x) => x.visitors))

  const spark = (d.daily || []).map((x) =>
    '<i title="' + esc(String(x.day).slice(0, 10)) + '：' + x.visitors + ' 人（新 ' + x.new_visitors + '）">' +
    '<b style="height:' + Math.round(100 * x.visitors / max) + '%"></b></i>').join('')

  const steps = [
    ['打开页面', f.arrived], ['开了职业生涯', f.started], ['推进过至少一回合', f.advanced],
    ['看过比赛', f.played], ['打完一个赛段', f.finished_stage], ['打完一个赛季', f.finished_season],
  ]
  const funnelRows = steps.map(([label, n]) =>
    '<tr><td>' + label + '</td><td class="n">' + (n ?? 0) + '</td>' +
    '<td style="width:38%"><div class="bar" style="width:' + pct(n ?? 0, f.arrived || 1) + '%"></div></td>' +
    '<td class="n muted">' + pct(n ?? 0, f.arrived || 1) + '%</td></tr>')

  const ret = (d.retention || []).slice(-10).map((r) =>
    '<tr><td>' + String(r.cohort).slice(5, 10) + '</td><td class="n">' + r.size + '</td>' +
    '<td class="n">' + age(r.cohort, 1, pct(r.d1, r.size)) + '</td>' +
    '<td class="n">' + age(r.cohort, 7, pct(r.d7, r.size)) + '</td></tr>')

  const simple = (rows, k, v) => rows.map((r) =>
    '<tr><td>' + esc(r[k]) + '</td><td class="n">' + r[v] + '</td></tr>')

  // ---- the front page, which is the first choice anybody makes now
  // Named hm, not h: headline already owns h at the top of this function.
  // Worth knowing why that slipped through — this whole script sits inside a
  // template literal, so node --check parses the module around it and never
  // reads a line of it. A duplicate const is a SyntaxError that blanks the
  // entire dashboard, and nothing in the suite looked. (Nor can a comment in
  // here use backticks: they close the literal.)
  const hm = d.home || {}
  const homeSteps = [
    ['进了 VCT电竞经理', hm.career], ['进了开瓦包', hm.cards],
    ['两个都玩过', hm.both], ['两个都没点', hm.neither],
  ]
  const homeRows = homeSteps.map(([label, n]) =>
    '<tr><td>' + label + '</td><td class="n">' + (n ?? 0) + '</td>' +
    '<td style="width:38%"><div class="bar" style="width:' + pct(n ?? 0, hm.visitors || 1) + '%"></div></td>' +
    '<td class="n muted">' + pct(n ?? 0, hm.visitors || 1) + '%</td></tr>')

  // ---- how careers end, which had no event at all before this release
  const car = d.careers || {}
  const acc = d.accounts || {}
  const mid = d.midReview || {}
  const sz = d.saveSize || {}
  const careerRows = [
    ['走完十年', car.finished ?? 0], ['中途下课', car.sacked ?? 0],
    ['平均在任赛季', car.avg_seasons ?? 0], ['平均冠军数', car.avg_honours ?? 0],
    ['五年之约：继续带下去', mid.continued ?? 0],
    ['五年之约：就此收官', mid.settled ?? 0],
    ['创建了账号', acc.made ?? 0], ['用 ID 找回账号', acc.restored ?? 0],
  ].map(([label, n]) =>
    '<tr><td>' + label + '</td><td class="n">' + n + '</td></tr>')

  // ---- 开瓦包. Four names, not sixty-five: the pull event sends the pack it
  // was, and a four-row lookup is cheaper than making the client send a label
  // with every pull. Anything unrecognised prints its own key.
  const PACK_CN = { scout: '试训包', elite: '选拔包', ten: '十连包', coach: '教练包' }
  const MODE_CN = { ladder: '天梯', cup: '杯赛' }
  const cm = d.cards || {}
  const cf = cm.funnel || {}
  const ca = cm.accounts || {}
  const cardSteps = [
    ['点进开瓦包', cf.touched], ['进了游戏', cf.entered], ['开过卡包', cf.pulled],
    ['打过比赛', cf.fought], ['签过到', cf.signed],
  ]
  const cardRows = cardSteps.map(([label, n]) =>
    '<tr><td>' + label + '</td><td class="n">' + (n ?? 0) + '</td>' +
    '<td style="width:34%"><div class="bar" style="width:' + pct(n ?? 0, cf.touched || 1) + '%"></div></td>' +
    '<td class="n muted">' + pct(n ?? 0, cf.touched || 1) + '%</td></tr>')

  const packRows = (cm.packs || []).map((r) =>
    '<tr><td>' + esc(PACK_CN[r.kind] || r.kind) + '</td>' +
    '<td class="n">' + r.opens + '</td>' +
    '<td class="n muted">' + r.visitors + '</td>' +
    '<td class="n">' + r.gold + '</td>' +
    // per pack, not per cent: a ten-pull deals ten cards, so 「重复率」 read
    // 273% on the pack that is most worth watching
    '<td class="n muted">' + (r.dupes / (r.opens || 1)).toFixed(1) + '</td></tr>')

  const CH_CN = { player: '猜选手', team: '猜战队', map: '猜地图', agent: '猜英雄' }
  const chRows = (cm.challenge || []).map((r) =>
    '<tr><td>' + esc(CH_CN[r.kind] || r.kind) + '</td>' +
    '<td class="n">' + r.visitors + '</td>' +
    '<td class="n">' + pct(r.solved, r.played || 1) + '%</td>' +
    '<td class="n muted">' + r.avg_tries + '</td></tr>')

  const matchRows = (cm.matches || []).map((r) =>
    '<tr><td>' + esc(MODE_CN[r.mode] || r.mode) + '</td>' +
    '<td class="n">' + r.played + '</td>' +
    '<td class="n muted">' + r.visitors + '</td>' +
    '<td class="n">' + pct(r.wins, r.played || 1) + '%</td></tr>')

  const collRows = [
    ['卡牌账号总数', ca.accounts ?? 0],
    ['这段时间新建', ca.fresh ?? 0],
    ['这段时间来过', ca.active ?? 0],
    ['建号之后又回来存过档', ca.came_back ?? 0],
    ['人均收藏（张）', ca.avg_owned ?? 0],
    ['最大收藏（张）', ca.max_owned ?? 0],
    ['人均抽卡（次）', ca.avg_pulls ?? 0],
    ['最高天梯段位（0 青铜起）', ca.max_div ?? 0],
    ['最长连续签到（天）', ca.max_streak ?? 0],
  ].map(([label, n]) => '<tr><td>' + label + '</td><td class="n">' + n + '</td></tr>')

  // Saves whose match count does not fit in the hours the account has existed.
  // The ceiling is arithmetic, not suspicion: 15 体力 banked, one point every
  // 50 minutes, 2 a match. Reported so it can be looked at — the one honest
  // way to trip it is a long stretch played offline and only then connected.
  const overRows = (cm.overplayed || []).map((r) =>
    '<tr><td>' + esc(r.name || '无名经理')
    + ' <span class="muted">#' + esc(String(r.id_hash).slice(0, 4).toUpperCase()) + '</span></td>'
    + '<td class="n">' + r.played + '</td>'
    + '<td class="n muted">' + r.ceiling + '</td>'
    + '<td class="n">' + (r.played - r.ceiling) + '</td>'
    + '<td class="n muted">' + r.hours + ' 小时</td></tr>')

  // The game sends the title with the key, so this never keeps its own copy of
  // sixty-five names — the key is only a fallback for events sent before that.
  const unlockRows = (data, kind) => (data.unlocks || [])
    .filter((r) => r.kind === kind)
    .map((r) => '<tr><td>' + esc(r.name || r.key) + '</td>' +
      '<td class="n">' + r.visitors + '</td></tr>')

  $('#app').innerHTML = '<div class="grid">' +
    panel('回访率 · 最关键的一个数',
      '<div class="big">' + (h.return_pct ?? 0) + '%<small>的人第二天还回来</small></div>' +
      '<div class="muted" style="font-size:12px;margin-top:6px">' +
      (h.visitors ?? 0) + ' 人来过 · ' + (h.returned ?? 0) + ' 人来过 2 天以上 · ' +
      (h.regulars ?? 0) + ' 人来过 4 天以上</div>',
      '一次访问只是点了个链接，第二天再来才是主动选择玩它。这个数掉了，说明留不住人，先看下面的漏斗断在哪一步。') +

    panel('每日人数',
      '<div class="spark">' + spark + '</div>' +
      '<div class="muted" style="font-size:11px;margin-top:6px">柱高＝当日人数，鼠标悬停看新老拆分</div>',
      '发帖后能看到尖峰，尖峰之后掉回多少，才是这次推广真正留下的人。') +

    panel('单次时长',
      '<div class="big">' + (s.median_min ?? 0) + '<small>分钟（中位）</small></div>' +
      '<div class="muted" style="font-size:12px;margin-top:6px">' +
      (s.n ?? 0) + ' 次 · 平均 ' + (s.avg_min ?? 0) + ' 分 · ' +
      // the </div> matters: without it this panel never closed, and the browser
      // parked 「玩到多深」 inside 「单次时长」 as a box within a box
      '不到 1 分钟就走 ' + (s.under_1min ?? 0) + ' 次 · 超过 15 分钟 ' + (s.over_15min ?? 0) + ' 次</div>',
      '中位数比平均值可靠——少数几个挂着页面不动的人会把平均值拉飞。') +

    panel('玩到多深',
      '<div class="big">' + (dep.avg_game_day ?? 0) + '<small>天（游戏内，平均）</small></div>' +
      '<div class="muted" style="font-size:12px;margin-top:6px">最深 ' +
      (dep.max_game_day ?? 0) + ' 天 · 人均推进 ' + (dep.avg_turns ?? 0) + ' 回合</div>',
      '一个赛季 336 天。平均只到几十天，说明大多数人没撑到第一个赛段结束。') +
  '</div>' +

  '<div class="grid" style="margin-top:12px">' +
    panel('流失漏斗', table(['步骤', '人数', '', '占比'], funnelRows),
      '哪一步掉得最狠，下一步就该修哪里。「开了职业生涯但一回合没推进」是最贵的一种流失——人已经进来了。') +
    panel('留存（按首次到访分组）', table(['首日', '人数', '次日', '第 7 天'], ret),
      '同一批人隔天/隔周还回来的比例。比总回访率更能看出改动有没有效果。') +
  '</div>' +

  '<div class="grid" style="margin-top:12px">' +
    panel('设备', table(['类型', '人数'], simple(d.devices || [], 'device', 'visitors')),
      '手机占比决定值不值得继续花时间在小屏上。') +
    panel('来源', table(['来自', '人数'], simple(d.referrers || [], 'ref', 'visitors')),
      '哪个渠道真的带来了人。微信和小红书的内置浏览器会把来源抹掉，所以「直接打开」里也有它们。') +
    panel('域名', table(['打开的是哪个域名', '人数'], simple(d.hosts || [], 'host', 'visitors')),
      '几个域名指向的是同一个服务、同一个数据库，所以数据一直都在，只是以前分不出是从哪个域名进来的。'
      + '这一列从这次更新才开始记，之前的行都归到「(这次改动之前)」。') +
    panel('选了哪些队', table(['俱乐部', '次数'], (d.clubs || []).map((r) =>
      '<tr><td>' + esc(r.club) + ' <span class="muted">' + esc(r.tier || '') + '</span></td>' +
      '<td class="n">' + r.n + '</td></tr>')),
      '大家想执教谁。冷门队没人选，可以考虑给点理由。') +
    panel('去过哪些页面', table(['页面', '次数'], simple(d.screens || [], 'screen', 'n')),
      '没人打开的页面，要么没做好，要么不该做。') +
  '</div>' +

  '<div class="grid" style="margin-top:12px">' +
    panel('首页去了哪', table(['去向', '人数', '', '占比'], homeRows),
      '首页现在挡在两个游戏前面，所以这是每个人做的第一个选择。'
      + '「两个都没点」是最贵的一格——人已经到门口了。') +
    panel('生涯怎么结束的', table(['结果', '数量'], careerRows),
      '走完十年 vs 中途下课。十年改版就是为了前者，而它之前根本没有被记录。') +
  '</div>' +

  '<div class="grid" style="margin-top:12px">' +
    panel('开瓦包 · 从进门到开包', table(['步骤', '人数', '', '占比'], cardRows),
      '首页只说了有多少人点进去，点进去之后发生了什么一直是空白。'
      + '隔天还回来开包的有 <b>' + (cf.came_back ?? 0) + '</b> 人——抽卡游戏的命就是这个数。') +
    panel('开瓦包 · 卡包', table(['卡包', '开出', '人数', '金卡', '重复/包'], packRows),
      '金卡是概率公示的那一栏在真实样本上的样子。「重复/包」是平均每包开出几张已有的卡——'
      + '它一路涨上去，说明卡池对这批人来说已经不够深了。') +
    panel('开瓦包 · 每日挑战', table(['题型', '人数', '解开率', '平均次数'], chRows),
      '一天一道，每个账号的题不一样（以前是全服同题，被人拿一个答案去小号刷奖励），入场 300 金币。'
      + '解开率太低说明题出难了——没人解得开的谜题，'
      + '第二天就没人回来了；太高说明奖励白送。平均次数看的是有没有在「猜」。') +
    panel('开瓦包 · 天梯与杯赛', table(['模式', '场次', '人数', '胜率'], matchRows),
      '开了包不打比赛，卡就只是图片。胜率长期该在五成上下，明显偏一边说明对手强度没配平。') +
    panel('开瓦包 · 收藏库', table(['指标', '数值'], collRows),
      '这一格读的是服务器上真正的存档，不是事件——手机没报上来的也在里面。'
      + '「建号之后又回来存过档」是瓦包自己的留存。') +
    (function () {
      const h = d.history || {}
      const t = h.totals || {}
      const rows = (h.days || []).slice(0, 30).map((r) =>
        '<tr><td class="muted">' + String(r.day).slice(5, 10) + '</td>' +
        '<td class="n">' + r.visitors + '</td>' +
        '<td class="n">' + r.new_visitors + '</td>' +
        '<td class="n muted">' + r.sessions + '</td>' +
        '<td class="n muted">' + r.active_min + '</td>' +
        '<td class="n muted">' + r.card_pulls + '</td></tr>')
      return panel('永久留存 · 明细删了也还在',
        '<div class="big">' + (t.players ?? 0).toLocaleString()
        + '<small>个玩家，从开服到现在</small></div>'
        + '<div class="muted" style="font-size:12px;margin:6px 0 10px">'
        + '近 7 天活跃 ' + (t.active7 ?? 0).toLocaleString() + ' 人'
        + (t.since ? ' · 最早一条 ' + String(t.since).slice(0, 10) : '') + '</div>'
        + table(['日期', '人数', '新增', '会话', '分钟', '开包'], rows),
        '事件明细是滚动窗口，四百万行到顶就从最老的开始删——按现在的量大约只装得下一天。'
        + '<b>这一格的数字是在删之前算好、单独存起来的，删多少次都不会掉。</b>'
        + '「累计玩家数」尤其只能这样来：人已经删了，就再也数不出有多少个不同的人了。'
        + '8/31 丢掉的一个月就是这么没的，现在补上了。')
    })() +
    panel('开瓦包 · 场次对不上账',
      table(['玩家', '声称场次', '最多可能', '超出', '建号至今'], overRows),
      '存档在浏览器里，是可以改的——这一格不是抓人，是算术：体力每 50 分钟回 1 点、'
      + '最多存 15 点、天梯一场 2 点，所以一天最多打 14 场左右。建号时间是服务器写的，'
      + '玩家改不了，拿它去对玩家能改的场次，超出多少一目了然。'
      + '空的就是没人对不上。有一种情况会误伤：一直在「仅本机」模式下玩了很久、'
      + '最近才联网，那样建号时间是新的而场次是旧的——所以这里只报，不做任何处理。') +
  '</div>' +

  '<div class="grid" style="margin-top:12px">' +
    panel('解锁排行 · 结局', table(['结局', '人数'], unlockRows(d, 'end')),
      '没出现在这里的结局，就是还没有人见过的内容。') +
    panel('解锁排行 · 成就', table(['成就', '人数'], unlockRows(d, 'ach')),
      '排在最上面的如果太容易，说明门槛低了；一直不出现的说明要么太难要么没人找得到。') +
  '</div>' +

  '<div class="grid" style="margin-top:12px">' +
    (() => {
      const st = d.storage || {}
      const gb = (n) => (n / 1e9).toFixed(2) + ' GB'
      const days = st.oldest
        ? Math.max(0, Math.round((Date.now() - new Date(st.oldest).getTime()) / 86400000))
        : 0
      const rowPct = pct(st.rows || 0, st.maxRows || 1)
      const nearly = rowPct >= 80
      return panel('数据库 · 这里存着多少历史',
        '<div class="big">' + days + '<small>天的历史</small></div>' +
        '<div class="muted" style="font-size:12px;margin-top:6px">' +
        '最早一条 ' + (st.oldest ? esc(String(st.oldest).slice(0, 10)) : '—') +
        ' · ' + (st.rows || 0).toLocaleString() + ' 行（上限 ' +
        (st.maxRows || 0).toLocaleString() + '，' + rowPct + '%）' +
        ' · 占盘 ' + gb(st.bytes || 0) + '</div>' +
        (nearly
          ? '<div style="font-size:12px;margin-top:6px;color:var(--warn)">'
            + '⚠ 快到上限了，最旧的数据随时会被清掉。</div>'
          : ''),
        '2026-08-31 之前的三十天在这里丢过一次：旧的清理逻辑按文件体积删行，而 DELETE 根本'
        + '不会让文件变小，于是它每次重启都删四百万行，一天八次部署就把历史删光了。现在只按'
        + '「过期」和「行数上限」删，两者都会停。这一格是为了让同样的事不会再没人看见——'
        + '「占盘」比行数大很多说明有膨胀，那是该手动跑一次 VACUUM FULL，不是该删数据。')
    })() +
    panel('存档体积 · 对着浏览器的上限看',
      '<div class="big">' + (sz.p50 ?? 0) + '<small>KB（中位）</small></div>' +
      '<div class="muted" style="font-size:12px;margin-top:6px">' +
      (sz.careers ?? 0) + ' 份生涯 · 90% 分位 ' + (sz.p90 ?? 0) + ' KB · 最大 ' +
      (sz.max_kb ?? 0) + ' KB · 其中超过 1500 KB 的 ' + (sz.over_1500 ?? 0) + ' 份</div>' +
      '<div class="muted" style="font-size:12px;margin-top:4px">' +
      '写不进去、被迫清掉旧比赛记录才存下的：<b>' + (sz.shrunk ?? 0) + '</b> 份' +
      '（这是兜底生效，不是丢档）</div>',
      '存档写在 localStorage 里，iOS Safari 给每个站点 5MB，按 UTF-16 算就是 250 万个字符——'
      + '自动存档、手动存档、教程存的那一份和开瓦包都挤在这里面，而四分之三的人在手机上。'
      + '满了浏览器就拒绝写入，进度直接停在那一刻。这一列从这次更新才开始记。') +
    ((d.errors || []).length
      ? panel('前端报错', table(['信息', '人数', '次数'], (d.errors || []).map((r) =>
        '<tr><td>' + esc(r.msg) + '</td><td class="n">' + r.visitors + '</td>' +
        '<td class="n muted">' + r.n + '</td></tr>')),
        '玩家不会来报的那些错。看「人数」而不是「次数」：存档写不进去这种错，'
        + '一个人每点一下就报一次，一份倒霉的生涯能刷出上万条。')
      : '') +
  '</div>'
}

async function load(days) {
  $('#status').textContent = '加载中…'
  try {
    const r = await fetch('/api/stats?days=' + days, { headers: auth() })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const d = await r.json()
    render(d)
    $('#status').textContent = '最近 ' + d.days + ' 天 · ' + new Date().toLocaleTimeString('zh-CN')
  } catch (e) {
    $('#app').innerHTML = '<div class="panel"><div class="empty">读不到数据：' + esc(e.message) + '</div></div>'
    $('#status').textContent = ''
  }
}

// ---- 给玩家发东西 -------------------------------------------------------
$('#gSend').onclick = async () => {
  const who = $('#gWho').value.trim()
  if (!who) { $('#gMsg').textContent = '先填对战码或账号 ID'; return }
  $('#gMsg').textContent = '发送中…'
  try {
    const r = await fetch('/api/admin/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify({
        who,
        pack: $('#gPack').value || null,
        count: Number($('#gCount').value) || 1,
        coins: Number($('#gCoins').value) || 0,
        note: $('#gNote').value || null,
      }),
    })
    const text = await r.text()
    let j = null
    try { j = JSON.parse(text) } catch { j = null }
    // A 200 of HTML means the route did not exist and the static handler
    // answered instead — which is what /api/admin/grant did on the day it
    // shipped, and 「HTTP 200」 was a useless thing to be told about it.
    if (!j) throw new Error(/^\s*</.test(text) ? '这个接口没接上（服务器返回的是页面，不是数据）' : ('HTTP ' + r.status))
    if (!j.ok) throw new Error(j.why || ('HTTP ' + r.status))
    $('#gMsg').textContent = '已发给 ' + j.to + ' · ' + new Date().toLocaleTimeString('zh-CN')
    $('#gCoins').value = ''; $('#gNote').value = ''
  } catch (e) {
    $('#gMsg').textContent = '没发出去：' + e.message
  }
}

// ---- 微信群二维码 -------------------------------------------------------
//
// Everything here is one row in site_config. The image travels as a data URL
// because this server has no multipart parser, and adding one for a single
// upload would be more code than the whole feature.
const wx = { on: false, img: null, note: null }

function wxDraw() {
  $('#wxOn').checked = !!wx.on
  $('#wxNote').value = wx.note || ''
  const img = $('#wxImg')
  if (wx.img) { img.src = wx.img; img.style.display = ''; $('#wxNone').style.display = 'none' }
  else { img.removeAttribute('src'); img.style.display = 'none'; $('#wxNone').style.display = '' }
}

async function wxLoad() {
  try {
    const r = await fetch('/api/admin/wechat', { headers: auth() })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const j = await r.json()
    Object.assign(wx, j.config || {})
    wxDraw()
  } catch (e) {
    $('#wxMsg').textContent = '读不到设置：' + e.message
  }
}

async function wxSave(body) {
  $('#wxMsg').textContent = '保存中…'
  try {
    const r = await fetch('/api/admin/wechat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth() },
      body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j || !j.ok) throw new Error((j && j.why) || ('HTTP ' + r.status))
    Object.assign(wx, j.config || {})
    wxDraw()
    $('#wxMsg').textContent = '已保存 · ' + new Date().toLocaleTimeString('zh-CN')
  } catch (e) {
    $('#wxMsg').textContent = '没保存成功：' + e.message
  }
}

$('#wxFile').onchange = () => {
  const f = $('#wxFile').files && $('#wxFile').files[0]
  if (!f) return
  if (f.size > 600 * 1024) { $('#wxMsg').textContent = '这张图 ' + Math.round(f.size / 1024) + 'KB，超过 600KB 了'; return }
  const fr = new FileReader()
  fr.onload = () => {
    // shown before it is saved, so a wrong file is obvious without a round trip
    wx.img = String(fr.result)
    wxDraw()
    $('#wxMsg').textContent = '预览中，点「保存」才会生效'
  }
  fr.readAsDataURL(f)
}
$('#wxSave').onclick = () => wxSave({ on: $('#wxOn').checked, note: $('#wxNote').value, img: wx.img })
$('#wxDrop').onclick = () => { if (confirm('删掉二维码？首页的按钮会一起消失。')) wxSave({ img: null }) }
wxLoad()

document.querySelectorAll('button[data-d]').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('button[data-d]').forEach((x) => x.classList.remove('on'))
    b.classList.add('on')
    load(b.dataset.d)
  }
})
load(30)
</script>
</body>
</html>`
