import { useEffect, useState } from 'react'

/**
 * The game answers on three hostnames and the browser keeps a separate
 * localStorage for each, so a career saved on www.vctgames.com is invisible
 * on vctgames.com and a card account remembered on the railway.app address
 * asks for its ID again on the real one — 「像换号」. A visitor with nothing
 * stored here is sent to the real address at once. One with a save or an ID
 * stored under this address is told, once per visit, how to carry it over:
 * the career exports to a file and imports on the other side, the card game
 * only needs its ID typed in. Nothing is moved for them — a redirect would
 * have stranded exactly the data this is about.
 *
 * Both only happen once the real address has answered from here. On
 * 2026-09-07 the edge IP behind vctgames.com was blocked from mainland China
 * while www and the railway.app address still opened — and this file was
 * bouncing every new visitor from the doors that worked to the one that did
 * not. So the real address is probed first; if it does not answer within a
 * few seconds, this address is the door, and nothing is said.
 */
const CANONICAL = 'vctgames.com'
/** how long the real address gets to answer before this one keeps the visitor */
const PROBE_MS = 4000

const offHost = (): boolean => {
  const h = location.hostname
  return h === `www.${CANONICAL}` || h.endsWith('.up.railway.app')
}

const hasLocalData = (): boolean => {
  try {
    return !!localStorage.getItem('valmanager:save:autosave') || !!localStorage.getItem('valmanager:card:id')
  } catch { return false }
}

const cardId = (): string | null => {
  try { return localStorage.getItem('valmanager:card:id') } catch { return null }
}

export default function DomainNotice() {
  const [gone, setGone] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reachable, setReachable] = useState(false)
  useEffect(() => {
    if (!offHost()) return
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), PROBE_MS)
    // an opaque cross-origin fetch: it resolves when the address answers at
    // all and rejects when the network never gets there, which is the question
    fetch(`https://${CANONICAL}/api/card/day`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
      .then(() => {
        if (!hasLocalData()) location.replace(`https://${CANONICAL}${location.pathname}${location.search}`)
        else setReachable(true)
      }, () => { /* unreachable from here — this address is the door, say nothing */ })
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); ctl.abort() }
  }, [])
  if (!offHost() || gone || !reachable) return null
  const id = cardId()
  return (
    <div className="domain-notice" role="status">
      <div className="update-body">
        <b>这个网址以后会停用，请改用 {CANONICAL}</b>
        <span>
          这个网址下的存档不会自动搬过去。
          生涯存档请到「存档」页<b>导出为文件</b>，再到 {CANONICAL} 的开始页导入；
          开瓦包在那边输入 ID 即可。
          {id && <>{' '}你的 ID：<code>{id}</code></>}
        </span>
      </div>
      {id && (
        <button className="sm" onClick={async () => {
          try { await navigator.clipboard.writeText(id); setCopied(true) } catch { /* no clipboard */ }
        }}>{copied ? '已复制' : '复制 ID'}</button>
      )}
      <button className="sm primary" onClick={() => { location.href = `https://${CANONICAL}${location.pathname}` }}>去 {CANONICAL}</button>
      <button className="sm ghost" onClick={() => setGone(true)} aria-label="先关掉">先关掉</button>
    </div>
  )
}
