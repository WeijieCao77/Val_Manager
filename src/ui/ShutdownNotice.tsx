import { useEffect, useState } from 'react'

/**
 * 停服公告, 2026-10-20: the owner received a lawyer's letter and closes the
 * site at 2:00 on 2026-10-22 (Beijing). Shown on every page, once per visit —
 * closing it lasts until the tab is opened again.
 */
const SEEN = 'valmanager:shutdown-notice'

const seen = (): boolean => {
  try { return sessionStorage.getItem(SEEN) === '1' } catch { return false }
}

/**
 * 2:00 on 10-22: a tab left open across the moment reloads onto the closed
 * page. The device clock only says when to start asking; the server's
 * X-Site-Closed header (shutdown-page.js) decides, so a fast clock cannot
 * reload a tab into a game that is still running. VITE_SHUTDOWN_AT moves
 * it for a local test, like SHUTDOWN_AT on the server.
 */
const CLOSE_AT = Date.parse(import.meta.env.VITE_SHUTDOWN_AT || '2026-10-22T02:00:00+08:00')

function useReloadWhenClosed() {
  useEffect(() => {
    let timer: number | undefined
    let stopped = false
    const ask = async () => {
      if (stopped) return
      try {
        const r = await fetch('/', { method: 'HEAD', cache: 'no-store' })
        if (r.headers.get('X-Site-Closed') === '1') { location.reload(); return }
      } catch { /* offline: try again */ }
      timer = window.setTimeout(ask, 60_000)
    }
    timer = window.setTimeout(ask, Math.max(0, CLOSE_AT - Date.now()))
    // a phone asleep through 2:00 wakes with its timer far behind
    const wake = () => {
      if (document.visibilityState !== 'visible' || Date.now() < CLOSE_AT) return
      window.clearTimeout(timer)
      void ask()
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])
}

export default function ShutdownNotice() {
  const [gone, setGone] = useState(seen)
  useReloadWhenClosed()
  if (gone) return null
  return (
    <div className="domain-notice shutdown-notice" role="status">
      <div className="update-body">
        <b>停服公告</b>
        <span>收到律师函，游戏只能做到这里了，会在 10 月 22 日 2:00 关服，感谢大家的支持。后续我们会推出一个自己打造的 IP 游戏，老玩家在里面会有回馈的，大家可以在群里等候通知。感谢大家支持，江湖有缘再见！</span>
      </div>
      <button className="sm" onClick={() => {
        try { sessionStorage.setItem(SEEN, '1') } catch { /* private mode */ }
        setGone(true)
      }}>知道了</button>
    </div>
  )
}
