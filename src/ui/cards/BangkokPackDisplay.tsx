import { useEffect, useRef, useState } from 'react'
import { BangkokPackArtwork } from './BangkokDesign'
import { paintBangkokPack } from './bangkokPackTexture'
import type { PouchMotion } from './pouchRenderer'

export default function BangkokPackDisplay() {
  const [angle, setAngle] = useState(-24)
  const [pose, setPose] = useState({ x: 6, y: -24 })
  const [ready, setReady] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const motion = useRef<PouchMotion>({ progress: 0, torn: false, pose })
  const invalidate = useRef<(() => void) | null>(null)
  motion.current.pose = pose
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    void import('./pouchRenderer').then(({ createPouchRenderer }) => {
      if (cancelled || !canvas.current) return
      try {
        const renderer = createPouchRenderer(canvas.current, 3, 'player', () => motion.current, () => setReady(false), undefined, false, { paint: paintBangkokPack, edgeColor: 0x9475b5 })
        dispose = renderer.dispose; invalidate.current = renderer.invalidate; setReady(true)
      } catch { setReady(false) }
    }).catch(() => setReady(false))
    return () => { cancelled = true; invalidate.current = null; dispose?.() }
  }, [])
  useEffect(() => { invalidate.current?.() }, [pose])
  return <div className="bk25-physical-pack">
    <div data-export="pack" className={`bk25-pouch-stage${ready ? ' is-ready' : ''}`} role="img" aria-label="曼谷 2025 立体铝箔卡包"
      onPointerMove={event => {
        if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
        const rect = event.currentTarget.getBoundingClientRect()
        setPose({ x: 6 - ((event.clientY - rect.top) / rect.height - .5) * 12, y: angle + ((event.clientX - rect.left) / rect.width - .5) * 30 })
      }} onPointerLeave={() => setPose({ x: 6, y: angle })}>
      <div className="bk25-pouch-fallback"><BangkokPackArtwork /></div><canvas ref={canvas} />
    </div>
    <div className="bk25-pouch-views" aria-label="卡包视角">{[{ label: '正面', angle: -24 }, { label: '侧面', angle: -68 }, { label: '背面', angle: -180 }].map(view => <button key={view.label} aria-pressed={angle === view.angle} onClick={() => { setAngle(view.angle); setPose({ x: 6, y: view.angle }) }}>{view.label}</button>)}</div>
  </div>
}
