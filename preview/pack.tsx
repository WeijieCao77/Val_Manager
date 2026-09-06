import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PackStage } from '../src/ui/cards/Packs'
import { CardBack } from '../src/ui/Card'
import CardTilt from '../src/ui/cards/CardTilt'
import { PLAYER_CARDS, COACH_CARDS } from '../src/engine/cards'
import type { Card, Rarity } from '../src/engine/cards'
import { Rng } from '../src/engine/rng'
import { PACK_POSITIONS, POSITION_PACKS, positionPackStyle } from '../src/ui/cards/positionPackDesign'
import type { PackPosition } from '../src/ui/cards/positionPackDesign'
import '../src/styles.css'

// Uses the real pack components with demonstration cards; never writes a save.
function samples(count: number, kind: Card['kind'], position?: PackPosition) {
  const rng = new Rng(crypto.getRandomValues(new Uint32Array(1))[0])
  const pool: Card[] = kind === 'coach' ? COACH_CARDS : position ? PLAYER_CARDS.filter(c => c.roles.includes(position)) : PLAYER_CARDS
  const rarities: Rarity[] = kind === 'coach' ? ['gold', 'bronze', 'silver'] : ['gold', 'bronze', 'silver', 'mythic']
  return rng.shuffle(Array.from({ length: count }, (_, index) => ({
    card: rng.pick(pool.filter(card => card.rarity === rarities[index % rarities.length]).length ? pool.filter(card => card.rarity === rarities[index % rarities.length]) : pool),
    dupe: false, salvage: 0,
  })))
}
const positionQuery = new URLSearchParams(location.search).get('position')
const initialPosition = PACK_POSITIONS.find(p => POSITION_PACKS[p].english.toLowerCase() === positionQuery)
const initialKind = !initialPosition && new URLSearchParams(location.search).get('kind') === 'coach' ? 'coach' : 'player'
const initialCount = initialPosition || initialKind === 'coach' ? 1 : 10
const options = [
  { count: 1, kind: 'player', label: '选手单张' },
  { count: 3, kind: 'player', label: '选拔包' },
  { count: 10, kind: 'player', label: '十连包' },
  { count: 1, kind: 'coach', label: '教练包' },
] as const

function PackPreview() {
  const [kind, setKind] = useState<Card['kind']>(initialKind)
  const [position, setPosition] = useState<PackPosition | undefined>(initialPosition)
  const [allBacks, setAllBacks] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [pulled, setPulled] = useState(() => samples(initialCount, initialKind, initialPosition))
  const [shown, setShown] = useState(1)
  const [cycle, setCycle] = useState(0)
  const [done, setDone] = useState(false)
  const [backOnly, setBackOnly] = useState(false)
  const restart = (next = count, nextKind = kind, nextPosition: PackPosition | null | undefined = position) => {
    setCount(next); setKind(nextKind); setPosition(nextPosition ?? undefined); setAllBacks(false); setPulled(samples(next, nextKind, nextPosition ?? undefined))
    setShown(1); setDone(false); setBackOnly(false); setCycle(value => value + 1)
  }
  return <>
    <style>{`
      .pack-stage { bottom: 138px; }
      .preview-controls { position: fixed; inset: auto 0 0; z-index: 70; height: 138px;
        display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px;
        padding: 8px 12px; background: #101923; border-top: 1px solid #263344; }
      .preview-label { text-align: center; color: #8299b1; font-size: 10px; }
      .preview-row .position-option[aria-pressed="true"] { background: var(--position-band); border-color: var(--position-light); }
      .preview-row .position-option { border-bottom: 2px solid var(--position-band); }
      .preview-row { display: flex; gap: 6px; }
      .preview-controls button { padding: 4px 10px; font-size: 12px; }
      .preview-complete { min-height: calc(100dvh - 138px); display: grid; place-content: center;
        justify-items: center; gap: 16px; }
      .preview-back { display: grid; place-content: center; justify-items: center; gap: 28px; }
      .preview-back .card-tilt { width: 184px; height: 268px; }
      .preview-back p { color: #9babac; font-size: 12px; }
      .preview-overview { overflow: auto; padding: 24px 12px; display: grid; grid-template-columns: repeat(2, 148px);
        justify-content: center; align-content: center; gap: 20px 32px; }
      .preview-mini { width: 148px; height: 215px; }
      .preview-mini .card-tilt { width: 184px; height: 268px; transform: scale(.8); transform-origin: left top; }
      .preview-position-caption { color: #adbac5; font-size: 11px; margin-top: 10px; text-align: center; }
      @media (max-width: 360px) {
        .preview-overview { grid-template-columns: repeat(2, 128px); column-gap: 20px; }
        .preview-mini { width: 128px; height: 187px; }
        .preview-mini .card-tilt { transform: scale(.69565); }
      }
      @media (max-height: 690px) { .preview-overview { align-content: start; } }
    `}</style>
    {allBacks ? <div className="pack-stage preview-overview">
      {PACK_POSITIONS.map(p => <div key={p}>
        <div className="preview-mini"><CardTilt><CardBack position={p} /><span className="card-specular" /></CardTilt></div>
        <div className="preview-position-caption">{POSITION_PACKS[p].label} · {POSITION_PACKS[p].english}</div>
      </div>)}
    </div> : backOnly ? <div className="pack-stage preview-back">
      <CardTilt><CardBack kind={kind} position={position} /><span className="card-specular" /></CardTilt>
      <p>{kind === 'coach' ? '教练' : position ? POSITION_PACKS[position].label : '选手'}卡背 · 移动鼠标查看倾角与反光</p>
    </div> : !done ? <PackStage position={position} key={cycle} pulled={pulled} shown={shown}
      onNext={() => setShown(value => value + 1)} onDone={() => setDone(true)} onSellAll={() => setDone(true)} />
      : <div className="preview-complete"><span>本包已看完</span><button className="primary" onClick={() => restart()}>再看一次</button></div>}
    <div className="preview-controls">
      <span className="preview-label">效果预览 · 演示卡片，不计入收藏</span>
      <div className="preview-row">{PACK_POSITIONS.map(p => <button key={p} className="position-option"
        style={positionPackStyle(p)} aria-pressed={position === p} onClick={() => restart(1, 'player', p)}>
        {POSITION_PACKS[p].label}包</button>)}</div>
      <div className="preview-row">{options.map(option =>
        <button key={option.label} className={!position && count === option.count && kind === option.kind ? 'primary' : ''}
          aria-pressed={!position && count === option.count && kind === option.kind}
          onClick={() => { restart(option.count, option.kind, null) }}>{option.label}</button>)}</div>
      <div className="preview-row">
        <button aria-pressed={backOnly} onClick={() => { setAllBacks(false); setBackOnly(value => !value) }}>{backOnly ? '返回卡包' : '查看卡背'}</button>
        <button aria-pressed={allBacks} onClick={() => setAllBacks(value => !value)}>四款卡背</button>
        <button onClick={() => restart()}>重新播放</button>
      </div>
    </div>
  </>
}

const root = createRoot(document.getElementById('root')!)
root.render(<PackPreview />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
