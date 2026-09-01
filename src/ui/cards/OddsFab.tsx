/**
 * The rates, one tap from wherever you are.
 *
 * They already had a tab. The trouble with a tab is that the moment somebody
 * wants to know the odds is the moment they are staring at a pack they just
 * opened — and leaving the pack screen to go and read a table is enough
 * friction that most people simply do not. Same numbers, same measurement,
 * reachable without leaving anything.
 *
 * Deliberately not remembered as "seen": unlike the changelog there is nothing
 * new to notice here, so it carries no dot and keeps no state at all.
 */
import { useEffect, useState } from 'react'
import { OddsTables, OddsWhy } from './Odds'

export default function OddsFab() {
  const [open, setOpen] = useState(false)
  // measured lazily — thirty thousand packs is a moment of work, and nobody
  // who never opens this should pay for it
  const [everOpened, setEverOpened] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        className={`support-fab odds-fab${open ? ' on' : ''}`}
        onClick={() => { setOpen((x) => !x); setEverOpened(true) }}
        aria-expanded={open}
        title="每种包的实测概率"
      >
        <span className="ico" aria-hidden="true">🎲</span>
        <span className="lbl">概率</span>
      </button>

      {open && (
        <>
          <div className="support-veil" onClick={() => setOpen(false)} />
          <div className="support-card odds-card" role="dialog" aria-label="概率公示">
            <div className="support-head">
              <h3>概率公示</h3>
              <button className="sm ghost" onClick={() => setOpen(false)}>关闭 ✕</button>
            </div>
            <p className="small muted" style={{ margin: 0, lineHeight: 1.9 }}>
              下面每个数字都是<b>实测</b>的：用游戏里同一套开包代码各开三万包统计出来，
              不是抄的配置表。所以它永远等于你真正抽到的东西。
            </p>
            {everOpened && <OddsTables />}
            <h4 style={{ margin: '4px 0 0', fontSize: 'var(--t-body)' }}>为什么实测和基础值不一样</h4>
            <OddsWhy />
          </div>
        </>
      )}
    </>
  )
}
