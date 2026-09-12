import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import PackPouch from '../src/ui/cards/PackPouch'
import { SeoulCardBack } from '../src/ui/cards/SeoulDesign'
import '../src/styles.css'
import './seoul.css'

function Preview() {
  const [angle, setAngle] = useState(-24)
  const [pose, setPose] = useState({ x: 6, y: -24 })
  return <main className="seoul-pack-preview">
    <header><small>CHAMPIONS SEOUL / 2024 COLLECTION</small><h1>首尔 2024 · 立体卡包</h1><p>转动包装，查看鼓起的袋身、压封褶皱与黑金覆膜反光。</p></header>
    <div className="preview-objects"><figure className="preview-pouch-figure">
      <div className="preview-pouch" role="img" aria-label="首尔立体卡包"
        onPointerMove={event => {
          if (event.pointerType === 'touch') return
          const rect = event.currentTarget.getBoundingClientRect()
          setPose({ x: 6 - ((event.clientY - rect.top) / rect.height - .5) * 16,
            y: angle + ((event.clientX - rect.left) / rect.width - .5) * 30 })
        }} onPointerLeave={() => setPose({ x: 6, y: angle })}>
        <PackPouch seoul count={3} kind="player" progress={0} torn={false} pose={pose} />
      </div><figcaption>立体卡包 <small>与其他款式共用袋身模型</small></figcaption>
      <label className="preview-angle">旋转角度 <input type="range" min="-180" max="180" value={angle}
        onChange={event => { const y = Number(event.target.value); setAngle(y); setPose({ x: 6, y }) }} /><output>{angle}°</output></label>
      <div className="preview-angles">{[{ label: '正面', value: 0 }, { label: '侧面厚度', value: -68 }, { label: '背面', value: -180 }].map(view =>
        <button key={view.label} onClick={() => { setAngle(view.value); setPose({ x: 6, y: view.value }) }}>{view.label}</button>)}</div>
    </figure><figure className="preview-back-figure"><SeoulCardBack /><figcaption>收藏卡背面<small>冠军赛标志 · 环绕金线</small></figcaption></figure></div>
  </main>
}

createRoot(document.getElementById('root')!).render(<Preview />)
