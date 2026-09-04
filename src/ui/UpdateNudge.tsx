import { useEffect, useState } from 'react'

/**
 * A quiet word when the game has been updated under an open tab.
 *
 * A phone that keeps yesterday's bundle keeps yesterday's rules: one did
 * exactly that across the day the card game moved to server settlement, and
 * a card it opened locally never existed anywhere else. The fix is to make an
 * old tab aware of the new build. The entry script's name carries a content
 * hash, so the page fetches its own index now and then and compares: a
 * different name means a deploy, and a banner asks for a refresh. Asks —
 * reloading somebody mid-match is worse than the staleness.
 *
 * Checked on a timer and whenever the tab comes back into view, which is
 * when a phone that has been in a pocket all afternoon most needs it. Under
 * the dev server the entry has no hash and nothing runs.
 */
const ENTRY = /assets\/index-[^"'/\s]+\.js/

const ownEntry = (): string | null => {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')
  const m = s?.getAttribute('src')?.match(ENTRY)
  return m ? m[0] : null
}

const EVERY = 10 * 60 * 1000
const AT_LEAST = 2 * 60 * 1000

export default function UpdateNudge() {
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    const mine = ownEntry()
    if (!mine) return
    let last = 0
    let stop = false
    const check = async () => {
      if (stop || Date.now() - last < AT_LEAST) return
      last = Date.now()
      try {
        const r = await fetch(`/?u=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const m = (await r.text()).match(ENTRY)
        if (m && m[0] !== mine) setFresh(true)
      } catch { /* offline: nothing to say */ }
    }
    const t = window.setInterval(check, EVERY)
    const onVis = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      stop = true
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [])

  if (!fresh) return null
  return (
    <div className="update-nudge" role="status" aria-live="polite">
      <div className="update-body">
        <b>游戏更新了</b>
        <span>刷新一下页面就能用上新版本，存档不受影响。</span>
      </div>
      <button className="primary sm" onClick={() => location.reload()}>刷新</button>
      <button className="sm ghost" onClick={() => setFresh(false)} aria-label="稍后再说">稍后</button>
    </div>
  )
}
