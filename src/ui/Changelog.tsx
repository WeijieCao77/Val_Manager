/**
 * What changed, in a corner where it does not interrupt anything.
 *
 * Most of this game's changes come from the group asking for them, and until
 * now the only way to find out something had been fixed was to hit the bug
 * again and notice it did not happen. This is the other half of that loop.
 *
 * A dot on the button when the newest entry is one you have not opened, and
 * nothing at all once you have — a permanent badge is just noise, and the last
 * date read is the whole of the state it keeps.
 */
import { useEffect, useState } from 'react'
import { CHANGELOG, LATEST } from '../data/changelog'
import Rich from './rich'

const SEEN = 'valmgr.changelog.seen'

const readSeen = (): string => {
  try { return localStorage.getItem(SEEN) ?? '' } catch { return '' }
}

export default function Changelog({ raised = false }: { raised?: boolean }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(readSeen)

  // Escape closes it, like every other panel in the game
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const fresh = !!LATEST && seen !== LATEST

  const toggle = () => {
    setOpen((x) => {
      // Marked read on open, not on close: someone who opens it and then hits
      // Escape has still seen what is new.
      if (!x && fresh) {
        setSeen(LATEST)
        try { localStorage.setItem(SEEN, LATEST) } catch { /* private mode */ }
      }
      return !x
    })
  }

  return (
    <>
      <button
        className={`support-fab log-fab${open ? ' on' : ''}${raised ? ' raised' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        title="看看这版改了什么"
      >
        <span className="ico" aria-hidden="true">📋</span>
        <span className="lbl">更新日志</span>
        {fresh && <span className="dot" aria-label="有新内容" />}
      </button>

      {open && (
        <>
          <div className="support-veil" onClick={() => setOpen(false)} />
          <div className="support-card log-card" role="dialog" aria-label="更新日志">
            <div className="support-head">
              <h3>更新日志</h3>
              <button className="sm ghost" onClick={() => setOpen(false)}>关闭 ✕</button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              这里大部分改动都来自群里的反馈。如果你提过某个 bug，多半能在下面找到。
            </p>

            <div className="log-list">
              {CHANGELOG.map((entry) => (
                <section key={entry.date + entry.title}>
                  <header>
                    <b>{entry.title}</b>
                    <span className="tiny faint mono">{entry.date}</span>
                  </header>
                  <ul>
                    {entry.changes.map((c, i) => (
                      <li key={i}>
                        <span className={`log-kind k-${c.kind}`}>{c.kind}</span>
                        <Rich text={c.text} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <div className="support-foot">
              <span className="tiny faint">
                猪之家出品 · 小红书/抖音 @点点点点点点点点 · 有问题欢迎在群里说
              </span>
            </div>
          </div>
        </>
      )}
    </>
  )
}
