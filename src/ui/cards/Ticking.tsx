import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { serverNow } from '../../engine/account'

/**
 * Text that moves with the clock, on the server's time.
 *
 * The cup pages kept a second hand in the page itself, so every second
 * redrew the whole bracket, the boards and the lineups for the sake of one
 * countdown. This re-renders only what it wraps, and skips the tick while
 * the tab is hidden.
 */
export default function Ticking({ children }: { children: (now: number) => ReactNode }) {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState !== 'hidden') setNow(serverNow()) }, 1000)
    return () => window.clearInterval(t)
  }, [])
  return <>{children(now)}</>
}
