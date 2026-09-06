import { useEffect, useRef, useState } from 'react'
import type { PouchMotion } from './pouchRenderer'
import { POSITION_PACKS, positionPackStyle } from './positionPackDesign'
import type { PackPosition } from './positionPackDesign'
import type { Card } from '../../engine/cards'

export default function PackPouch({ count, kind, position, progress, torn, pose }: {
  count: number; kind: Card['kind']; position?: PackPosition; progress: number; torn: boolean; pose: { x: number; y: number }
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const motion = useRef<PouchMotion>({ progress, torn, pose })
  const requestFrame = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)
  motion.current = { progress, torn, pose }
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    setReady(false)
    void import('./pouchRenderer').then(({ createPouchRenderer }) => {
      if (cancelled || !canvas.current) return
      try {
        const renderer = createPouchRenderer(canvas.current, count, kind, () => motion.current, () => setReady(false), position)
        dispose = renderer.dispose
        requestFrame.current = renderer.invalidate
        setReady(true)
      } catch { /* The seal still opens when WebGL isn't available. */ }
    }).catch(() => { /* A failed optional renderer must not trap a paid pack. */ })
    return () => { cancelled = true; requestFrame.current = null; dispose?.() }
  }, [count, kind, position])
  useEffect(() => { requestFrame.current?.() }, [progress, torn, pose])
  return <div className={`pack-pouch pack-pouch-${kind}${position ? ' pack-pouch-position' : ''}${ready ? ' ready' : ''}`} style={positionPackStyle(position)} aria-hidden="true">
    <div className="pack-pouch-fallback"><span>VAL MANAGER</span><b>{kind === 'coach' ? '教练包' : position ? `${POSITION_PACKS[position].label}包` : '开瓦包'}</b><small>{count} 张收藏卡</small></div>
    <canvas ref={canvas} />
  </div>
}
