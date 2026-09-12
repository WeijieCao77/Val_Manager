import { useState } from 'react'
import PackPouch from './PackPouch'

const REST = { x: 5, y: -22 }

/** The same filled, sealed pouch used by the actual opening scene. */
export default function SeoulPackDisplay() {
  const [pose, setPose] = useState(REST)
  return <div className="sc24-pack-object" role="img" aria-label="首尔 2024 立体卡包，可移动指针查看包装反光"
    onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      setPose({ x: REST.x - ((event.clientY - rect.top) / rect.height - .5) * 16,
        y: REST.y + ((event.clientX - rect.left) / rect.width - .5) * 48 })
    }} onPointerLeave={() => setPose(REST)}>
    <PackPouch seoul count={3} kind="player" progress={0} torn={false} pose={pose} />
  </div>
}
