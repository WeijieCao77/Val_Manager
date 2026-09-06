import { useEffect, useRef } from 'react'
import type { ReactNode, PointerEvent } from 'react'

/** A stable hit area around the turning card; the light follows the same pose. */
export default function CardTilt({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const rect = useRef<DOMRect | null>(null)
  const pose = useRef({ x: 0, y: 0 })
  const target = useRef({ x: 0, y: 0 })
  const frame = useRef<number | null>(null)
  const reduced = useRef(false)
  const lastTime = useRef(0)

  const animate = (time: number) => {
    const dt = Math.min(50, time - (lastTime.current || time - 16))
    lastTime.current = time
    const ease = 1 - Math.exp(-dt / 85)
    pose.current.x += (target.current.x - pose.current.x) * ease
    pose.current.y += (target.current.y - pose.current.y) * ease
    const settled = Math.abs(target.current.x - pose.current.x) + Math.abs(target.current.y - pose.current.y) < .002
    if (settled) pose.current = { ...target.current }
    const { x, y } = pose.current
    const style = root.current?.style
    style?.setProperty('--card-rx', `${-y * 10}deg`)
    style?.setProperty('--card-ry', `${x * 14}deg`)
    style?.setProperty('--card-light-x', `${50 + x * 42}%`)
    style?.setProperty('--card-light-y', `${50 + y * 42}%`)
    style?.setProperty('--card-light-opacity', `${Math.min(1, Math.abs(x) + Math.abs(y)) * .32}`)
    frame.current = settled ? null : requestAnimationFrame(animate)
    if (settled) lastTime.current = 0
  }
  const aim = (x: number, y: number) => {
    if (reduced.current) return
    target.current = { x, y }
    if (frame.current === null) frame.current = requestAnimationFrame(animate)
  }
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reduced.current = media.matches
      if (media.matches) {
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = null
        lastTime.current = 0
        pose.current = target.current = { x: 0, y: 0 }
        root.current?.removeAttribute('style')
      }
    }
    sync()
    media.addEventListener('change', sync)
    return () => {
      media.removeEventListener('change', sync)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || reduced.current || !rect.current) return
    const box = rect.current
    const clamp = (n: number) => Math.max(-1, Math.min(1, n))
    aim(clamp((event.clientX - box.left) / box.width * 2 - 1), clamp((event.clientY - box.top) / box.height * 2 - 1))
  }
  return (
    <div className="card-tilt" ref={root}
      onPointerEnter={(event) => { rect.current = event.currentTarget.getBoundingClientRect(); move(event) }}
      onPointerMove={move} onPointerLeave={() => aim(0, 0)} onPointerCancel={() => aim(0, 0)}>
      <div className="card-tilt-plane">{children}</div>
    </div>
  )
}
