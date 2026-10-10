import { useState } from 'react'
import PackPouch from './PackPouch'

const REST = { x: 5, y: -22 }

/** The 退役选手包 on the 抽卡 shelf: the pouch the opening scene tears, as BangkokShelfPack is for 曼谷. */
export default function RetiredShelfPack() {
  const [pose, setPose] = useState(REST)
  return <div className="pack-pouch-object" role="img" aria-label="余晖退役选手包，可移动指针查看包装反光"
    onPointerMove={event => {
      if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const rect = event.currentTarget.getBoundingClientRect()
      setPose({ x: REST.x - ((event.clientY - rect.top) / rect.height - .5) * 16,
        y: REST.y + ((event.clientX - rect.left) / rect.width - .5) * 48 })
    }} onPointerLeave={() => setPose(REST)}>
    <PackPouch retired count={3} kind="player" progress={0} torn={false} pose={pose} />
  </div>
}
