import { useState } from 'react'

/**
 * 停服公告, 2026-10-20: the owner received a lawyer's letter and closes the
 * site at 2:00 on 2026-10-22 (Beijing). Shown on every page, once per visit —
 * closing it lasts until the tab is opened again.
 */
const SEEN = 'valmanager:shutdown-notice'

const seen = (): boolean => {
  try { return sessionStorage.getItem(SEEN) === '1' } catch { return false }
}

export default function ShutdownNotice() {
  const [gone, setGone] = useState(seen)
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
