/**
 * A quiet way to say thank you.
 *
 * The game is free and stays free — this is a button in the corner, not a
 * wall in front of anything. It opens a small panel with the 爱发电 page and
 * a code to scan, and it remembers being closed: dismiss it and it shrinks to
 * a link in the footer instead of asking again every session.
 *
 * The QR is drawn inline rather than shipped as an image so it costs one
 * network request less, inherits the page's colour, and stays crisp at any
 * size. It encodes exactly the same URL as the link beside it — decoded and
 * checked against the link before shipping.
 */
import { useEffect, useState } from 'react'
import { Ext } from './ext'

/** No scheme: see Ext. The 小工具 build prints this rather than linking it. */
export const AFDIAN = 'ifdian.net/a/pighome'
const DISMISSED = 'valmgr.support.hidden'

function Qr() {
  return (
    <svg
      viewBox="0 0 33 33"
      className="qr"
      role="img"
      aria-label="爱发电赞助页二维码"
      shapeRendering="crispEdges"
    >
      <rect width="33" height="33" fill="#fff" />
      <path className="qrline" stroke="currentColor" d="M2 2.5h7m2 0h1m2 0h2m4 0h1m3 0h7m-29 1h1m5 0h1m4 0h6m2 0h1m2 0h1m5 0h1m-29 1h1m1 0h3m1 0h1m1 0h4m1 0h2m1 0h2m2 0h1m1 0h1m1 0h3m1 0h1m-29 1h1m1 0h3m1 0h1m4 0h1m4 0h1m1 0h2m2 0h1m1 0h3m1 0h1m-29 1h1m1 0h3m1 0h1m1 0h1m4 0h3m2 0h1m3 0h1m1 0h3m1 0h1m-29 1h1m5 0h1m1 0h2m1 0h1m1 0h2m1 0h1m2 0h2m1 0h1m5 0h1m-29 1h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7m-20 1h1m1 0h1m4 0h5m-20 1h1m2 0h1m1 0h1m1 0h1m2 0h1m6 0h4m1 0h2m1 0h1m-27 1h2m1 0h1m4 0h2m6 0h3m3 0h3m1 0h3m-29 1h1m1 0h1m1 0h1m1 0h1m3 0h5m1 0h2m2 0h2m1 0h1m4 0h1m-28 1h1m3 0h1m2 0h4m2 0h1m1 0h6m1 0h1m3 0h2m-29 1h1m3 0h1m1 0h1m2 0h1m2 0h1m1 0h1m1 0h2m2 0h1m2 0h1m1 0h1m2 0h1m-29 1h1m4 0h1m1 0h3m1 0h1m2 0h1m1 0h1m1 0h1m3 0h1m1 0h1m1 0h3m-29 1h1m1 0h2m1 0h2m2 0h2m1 0h1m1 0h1m1 0h2m2 0h2m2 0h1m3 0h1m-28 1h1m2 0h1m2 0h2m2 0h1m1 0h1m2 0h2m4 0h2m1 0h1m2 0h1m-29 1h4m2 0h1m3 0h1m4 0h1m2 0h1m1 0h2m1 0h1m3 0h1m-28 1h6m7 0h1m2 0h1m1 0h1m3 0h3m3 0h1m-26 1h1m1 0h3m2 0h1m1 0h1m1 0h1m1 0h2m6 0h3m1 0h1m-27 1h1m2 0h1m1 0h1m2 0h2m2 0h1m2 0h2m5 0h2m1 0h2m-29 1h2m4 0h1m1 0h1m3 0h1m1 0h2m1 0h1m2 0h6m1 0h2m-21 1h1m3 0h2m1 0h6m3 0h1m1 0h1m1 0h1m-29 1h7m2 0h1m1 0h2m1 0h3m1 0h3m1 0h1m1 0h1m3 0h1m-29 1h1m5 0h1m2 0h1m3 0h2m4 0h2m3 0h2m1 0h1m-28 1h1m1 0h3m1 0h1m1 0h1m1 0h2m1 0h4m2 0h6m2 0h2m-29 1h1m1 0h3m1 0h1m4 0h2m1 0h1m2 0h2m4 0h1m1 0h3m-28 1h1m1 0h3m1 0h1m2 0h2m3 0h2m2 0h4m3 0h1m1 0h2m-29 1h1m5 0h1m1 0h1m2 0h7m2 0h1m1 0h2m3 0h2m-29 1h7m3 0h1m2 0h2m2 0h2m1 0h3m1 0h2m1 0h1"/>
    </svg>
  )
}

export default function Support({ raised = false }: { raised?: boolean }) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(DISMISSED) === '1' } catch { return false }
  })

  // Escape closes it, like every other panel in the game
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const hide = () => {
    setOpen(false)
    setHidden(true)
    try { localStorage.setItem(DISMISSED, '1') } catch { /* fine either way */ }
  }

  return (
    <>
      {!hidden && (
        <button
          className={`support-fab${open ? ' on' : ''}${raised ? ' raised' : ''}`}
          onClick={() => setOpen((x) => !x)}
          aria-expanded={open}
          title="游戏永久免费——如果你愿意支持一下"
        >
          <span className="ico" aria-hidden="true">⚡</span>
          <span className="lbl">支持作者</span>
        </button>
      )}

      {open && (
        <>
          <div className="support-veil" onClick={() => setOpen(false)} />
          <div className="support-card" role="dialog" aria-label="支持作者">
            <div className="support-head">
              <h3>游戏是免费的，以后也是</h3>
              <button className="sm ghost" onClick={() => setOpen(false)}>关闭 ✕</button>
            </div>
            <p className="small muted">
              这个游戏我做着玩，也做给群里的各位玩，<b>所有内容永久免费，不卖数值、不卖抽卡</b>。
              如果它让你开心过，欢迎请我喝杯咖啡——不请也完全没关系，
              继续在群里提 bug 和建议就是最大的支持。
            </p>
            <div className="support-body">
              <Qr />
              <div className="support-side">
                <Ext
                  className={__MINITOOL__ ? 'small' : 'button primary sm'}
                  to={AFDIAN}
                  offline={<>爱发电：<b>{AFDIAN}</b></>}
                >
                  打开爱发电 ↗
                </Ext>
                <p className="tiny faint" style={{ margin: 0 }}>
                  {__MINITOOL__ ? '手机扫码，或在浏览器里打开上面的地址。' : '手机扫码，或直接点上面的按钮。'}<br />
                  ¥10/月 可以提前玩到新版本、进专属群；也可以自选金额，一次就好。
                </p>
              </div>
            </div>
            <div className="support-foot">
              <button className="sm ghost" onClick={hide}>不用了，别再提示</button>
              <span className="tiny faint">数据来自 vlr.gg / Liquipedia，游戏内容为程序模拟，与现实无关</span>
            </div>
          </div>
        </>
      )}
    </>
  )
}
