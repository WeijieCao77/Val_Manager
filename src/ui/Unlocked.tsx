/**
 * The moment something unlocks.
 *
 * It used to be a toast — one line, three seconds, gone, and only if you
 * happened to be on the dashboard when the turn ticked over. For the payoff of
 * a system with 43 badges in it, that is nothing. This is a card that lands in
 * the corner, names what you did and what it took, and waits to be dismissed.
 *
 * Several can unlock on the same turn — winning Champions can be four at once —
 * so they queue rather than overwrite, and the card says how many are behind
 * it. Clicking through is one tap each; 全部知道了 clears the lot.
 */
import { useEffect } from 'react'
import { achievementBy } from '../engine/achievements'
import type { Ending } from '../engine/endings'

export interface UnlockItem {
  kind: '成就' | '结局'
  key: string
  title: string
  brief: string
  hard?: boolean
}

/** Turn freshly-recorded keys into things worth showing. */
export function toItems(
  achievements: string[], endings: string[], endingsById: Ending[],
): UnlockItem[] {
  const out: UnlockItem[] = []
  for (const k of achievements) {
    const a = achievementBy(k)
    if (a) out.push({ kind: '成就', key: k, title: a.title, brief: a.brief, hard: a.hard })
  }
  for (const k of endings) {
    const e = endingsById.find((x) => x.key === k)
    if (e) out.push({ kind: '结局', key: k, title: e.title, brief: e.brief })
  }
  return out
}

export default function Unlocked(
  { queue, onNext, onClearAll }:
  { queue: UnlockItem[]; onNext: () => void; onClearAll: () => void },
) {
  const top = queue[0]

  // Enter or Escape moves on, so a stack of four is four keypresses and not a
  // hunt for the button.
  useEffect(() => {
    if (!top) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClearAll()
      else if (e.key === 'Enter') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [top, onNext, onClearAll])

  if (!top) return null

  return (
    <div className={`unlock${top.hard ? ' hard' : ''}`} role="status" aria-live="polite">
      <div className="unlock-mark" aria-hidden="true">{top.kind === '结局' ? '🏁' : '🏅'}</div>
      <div className="unlock-body">
        <span className="k">
          {top.kind === '结局' ? '解锁结局' : '成就解锁'}
          {top.hard && <em> · 稀有</em>}
        </span>
        <b>{top.title}</b>
        <span className="tiny muted">{top.brief}</span>
      </div>
      <div className="unlock-side">
        <button className="sm" onClick={onNext}>
          {queue.length > 1 ? `知道了（还有 ${queue.length - 1}）` : '知道了'}
        </button>
        {queue.length > 1 && (
          <button className="sm ghost" onClick={onClearAll}>全部知道了</button>
        )}
      </div>
    </div>
  )
}
