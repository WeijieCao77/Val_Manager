// Development-only visual fixture: every kind of card face, at every size and in the
// grids that show them, so one proportion can be checked everywhere. No API calls.
import { createRoot } from 'react-dom/client'
import { ALL_CARDS, isPlayerCard, isCoachCard } from '../src/engine/cards'
import CardFace, { CardBack, CardSlot } from '../src/ui/Card'
import '../src/styles.css'
import '../src/ui/cards/cards-ux.css'
if (!import.meta.env.DEV) throw new Error('Development only')
const pick = (f: (c: any) => boolean) => ALL_CARDS.find(f)!
const cards = [
  pick(c => isPlayerCard(c) && c.rarity === 'gold' && !c.event && !c.legend && c.roles.length > 1),
  pick(c => isPlayerCard(c) && c.rarity === 'silver' && !c.event && !c.legend && c.isIgl),
  pick(c => isPlayerCard(c) && c.rarity === 'bronze' && !c.event && !c.legend && !c.face),
  pick(c => isPlayerCard(c) && c.rarity === 'mythic' && !!c.face),
  pick(c => isPlayerCard(c) && c.event === 'seoul-2024' && c.rarity === 'gold'),
  pick(c => isPlayerCard(c) && c.event === 'seoul-2024' && c.rarity === 'silver'),
  pick(c => isCoachCard(c) && c.rarity === 'gold'),
  pick(c => isCoachCard(c) && c.rarity === 'mythic'),
]
function Row({ size, footer, level }: { size: 'sm' | 'md' | 'lg'; footer?: string; level?: number }) {
  return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
    {cards.map(c => <CardFace key={c.id + size} card={c} size={size} level={level} dupes={1} footer={footer} />)}
  </div>
}
function Preview() {
  return <main style={{ padding: 16 }}>
    <h2>sm</h2><Row size="sm" footer="新卡" />
    <h2>md · +3</h2><Row size="md" level={3} />
    <h2>lg</h2><Row size="lg" />
    <h2>卡背（正面 lg 对照）</h2>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }} id="backs">
      <CardBack kind="player" /><CardBack kind="coach" /><CardBack kind="player" position="决斗者" /><CardBack kind="player" seoul /><CardFace card={cards[0]} size="lg" />
    </div>
    <h2>卡组（手机宽 375）</h2>
    <div style={{ width: 343, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} className="cm-squad" id="squad">
      {cards.slice(0, 5).map(c => <CardFace key={c.id} card={c} level={1} />)}
      <CardSlot label="哨卫" />
    </div>
    <h2>收藏（手机宽 375，两列）</h2>
    <div style={{ width: 355 }} className="cm-grid">
      {cards.map(c => <CardFace key={c.id} card={c} level={2} dupes={1} />)}
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
