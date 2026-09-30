import { useState } from 'react'
import PackPouch from './PackPouch'

const REST = { x: 5, y: -22 }

/** The 曼谷包 on the 抽卡 shelf: the pouch the opening scene tears, as SeoulPackDisplay is for 首尔. */
export default function BangkokShelfPack() {
  const [pose, setPose] = useState(REST)
  return <div className="pack-pouch-object" role="img" aria-label="曼谷 2025 立体铝箔卡包，可移动指针查看包装反光"
    onPointerMove={event => {
      if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const rect = event.currentTarget.getBoundingClientRect()
      setPose({ x: REST.x - ((event.clientY - rect.top) / rect.height - .5) * 16,
        y: REST.y + ((event.clientX - rect.left) / rect.width - .5) * 48 })
    }} onPointerLeave={() => setPose(REST)}>
    <PackPouch bangkok count={3} kind="player" progress={0} torn={false} pose={pose} />
  </div>
}
