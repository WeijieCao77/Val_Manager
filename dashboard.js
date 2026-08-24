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
  .grid { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:13px; }
  .panel h2 {
    font-size:11px; letter-spacing:.14em; text-transform:uppercase;
    color:var(--muted); margin:0 0 10px; font-weight:700;
  }
  .why { color:var(--faint); font-size:11px; margin-top:9px; line-height:1.5; }
  .big { font-size:34px; font-weight:800; font-variant-numeric:tabular-nums; line-height:1.1; }
  .big small { font-size:13px; color:var(--muted); font-weight:400; margin-left:6px; }
  .hero { border-left:2px solid var(--accent); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--faint); font-size:10px; letter-spacing:.1em;
       text-transform:uppercase; padding:5px 6px; border-bottom:1px solid var(--line); }
  td { padding:5px 6px; border-bottom:1px solid rgba(255,255,255,.04); }
  td.n { text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums; }
  .bar { height:7px; background:var(--accent); border-radius:2px; min-width:2px; }
  .bar.g { background:var(--win); }
  .spark { display:flex; align-items:flex-end; gap:2px; height:56px; margin-top:4px; }
  .spark i { flex:1; background:var(--panel-2); border-radius:1px 1px 0 0; position:relative; }
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
<div id="app"></div>
<footer style="margin-top:20px;padding-top:14px;border-top:1px solid var(--line);
               color:var(--faint);font-size:11px;text-align:center;line-height:1.8">
  作者：<b style="color:var(--muted)">猪之家</b>出品 ·
  小红书<b style="color:var(--muted)">@点点点点点点点点</b> ·
  抖音<b style="color:var(--muted)">@点点点点点点点点</b>
</footer>

<script>
const $ = (s) => document.querySelector(s)
const token = new URLSearchParams(location.search).get('token') || ''
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

function table(head, rows, why) {
  if (!rows.length) return '<div class="empty">还没有数据</div>'
  return '<table><thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table>'
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
      '不到 1 分钟就走 ' + (s.under_1min ?? 0) + ' 次 · 超过 15 分钟 ' + (s.over_15min ?? 0) + ' 次',
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
      '哪个渠道真的带来了人。') +
    panel('选了哪些队', table(['俱乐部', '次数'], (d.clubs || []).map((r) =>
      '<tr><td>' + esc(r.club) + ' <span class="muted">' + esc(r.tier || '') + '</span></td>' +
      '<td class="n">' + r.n + '</td></tr>')),
      '大家想执教谁。冷门队没人选，可以考虑给点理由。') +
    panel('去过哪些页面', table(['页面', '次数'], simple(d.screens || [], 'screen', 'n')),
      '没人打开的页面，要么没做好，要么不该做。') +
  '</div>' +

  ((d.errors || []).length ? '<div class="grid" style="margin-top:12px">' +
    panel('前端报错', table(['信息', '次数'], simple(d.errors, 'msg', 'n')),
      '玩家不会来报的那些错。') + '</div>' : '')
}

async function load(days) {
  $('#status').textContent = '加载中…'
  try {
    const r = await fetch('/api/stats?days=' + days + '&token=' + encodeURIComponent(token))
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const d = await r.json()
    render(d)
    $('#status').textContent = '最近 ' + d.days + ' 天 · ' + new Date().toLocaleTimeString('zh-CN')
  } catch (e) {
    $('#app').innerHTML = '<div class="panel"><div class="empty">读不到数据：' + esc(e.message) + '</div></div>'
    $('#status').textContent = ''
  }
}

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
