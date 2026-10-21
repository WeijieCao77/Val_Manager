/**
 * 停服, 2:00 Beijing on 2026-10-22 (the lawyer's letter of 2026-10-20).
 *
 * From that moment every page on the domain — the front page, 电竞经理, 开瓦包,
 * /player — answers with the one page below, and every API call with 410.
 * The owner's routes (/admin, /api/admin/*) and the health checks stay up, so
 * a last backup can still be taken after the doors close.
 *
 * SHUTDOWN_AT moves the moment for a local test; production uses the date.
 */
export const SHUTDOWN_AT = Date.parse(process.env.SHUTDOWN_AT || '2026-10-22T02:00:00+08:00')

export const closed = (now = Date.now()) => now >= SHUTDOWN_AT

/** still served after the close: the owner's tools and Railway's checks */
export const stillOpen = (path) =>
  path === '/healthz' || path === '/readyz' || path === '/admin' || path.startsWith('/api/admin/')

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>游戏已暂停运营</title>
<style>
  :root {
    --bg: #f4f1ea; --card: #fffdf8; --ink: #1f1c18; --muted: #6f685d;
    --line: #e4ddd0; --accent: #d9677b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14120f; --card: #1d1a16; --ink: #f1ece2; --muted: #a39b8d;
      --line: #2f2a23; --accent: #f08da0;
    }
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    background: var(--bg); color: var(--ink);
    font: 16px/1.75 -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    display: flex; align-items: center; justify-content: center;
    padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
  }
  main {
    width: 100%; max-width: 440px; background: var(--card);
    border: 1px solid var(--line); border-radius: 20px;
    padding: 40px 28px 32px; text-align: center;
  }
  .mark { font-size: 44px; line-height: 1; }
  .date {
    margin-top: 18px; color: var(--muted); font-size: 13px; letter-spacing: .08em;
  }
  h1 { margin-top: 6px; font-size: 26px; line-height: 1.35; font-weight: 700; }
  .body { margin-top: 20px; text-align: left; }
  .body p + p { margin-top: 10px; }
  .next {
    margin-top: 24px; padding: 16px 18px; border-radius: 14px;
    border: 1px dashed var(--accent); text-align: left;
  }
  .next b { color: var(--accent); }
  .sign { margin-top: 28px; color: var(--muted); font-size: 14px; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true">🐷</div>
  <div class="date">2026.10.22 02:00</div>
  <h1>游戏已暂停运营</h1>
  <div class="body">
    <p>开瓦包、VCT 电竞经理和无畏契约选手生涯，到这里就先停下了。</p>
    <p>谢谢每一位来过的玩家：开过的包、打过的天梯、凌晨还在等的全服杯，我们都记得。</p>
  </div>
  <div class="next">
    后续请期待<b>猪之家自己 IP 的游戏</b>。老玩家会有回馈，消息在群里通知。
  </div>
  <div class="sign">江湖有缘再见 · 猪之家</div>
</main>
</body>
</html>
`

export const shutdownHtml = () => PAGE
