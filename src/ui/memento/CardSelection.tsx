import { useState } from 'react'
import CardFace from '../Card'
import { cardName, RARITY_CN } from '../../engine/cards'
import type { MementoData } from './model'

export default function CardSelection({ data, onChange }: { data: MementoData; onChange: (data: MementoData) => void }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  // a card taken out leaves its place: the next pick goes back there, so swapping the middle card keeps it in the middle
  const [hole, setHole] = useState<number | null>(null)
  const collection = data.collection ?? []
  const selected = data.selectedCardIds ?? []
  const filtered = collection.filter(({ card }) => `${cardName(card)} ${card.clubTag ?? ''} ${RARITY_CN[card.rarity]} ${'event' in card ? card.event ?? '' : ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const change = (ids: string[]) => {
    const cards = ids.map(id => collection.find(item => item.card.id === id)!).filter(Boolean)
    onChange({ ...data, selectedCardIds: cards.map(c => c.card.id), cardImages: undefined,
      lineup: cards.map(c => cardName(c.card)), coach: undefined,
      members: cards.map(({card, level}) => ({ name: cardName(card), face: card.face, level, rarity: card.rarity, rating: card.rating })) })
  }
  return <section className="memento-picker" aria-label="从我的收藏选卡">
    <div className="memento-pick-heading"><b>从我的收藏选卡</b><span aria-live="polite">已选 {selected.length}/5</span></div>
    <p className="memento-note">按选择顺序排列，第三张放在中央。可以选同一选手的不同版本。</p>
    <div className="memento-picked">{selected.map((id, i) => {
      const item = collection.find(c => c.card.id === id)!
      return <button key={id} onClick={() => { setHole(i); change(selected.filter(x => x !== id)) }} aria-label={`移除第${i + 1}张 ${cardName(item.card)}`}>{i + 1}. {cardName(item.card)} ×</button>
    })}</div>
    <label>搜索我的收藏<input value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="选手、战队、稀有度" /></label>
    {collection.length < 5 && <p role="status">目前拥有 {collection.length} 种选手卡，集齐五种后即可制作五卡纪念图。</p>}
    {!filtered.length && <p role="status">没有找到匹配的收藏卡。</p>}
    <div className="memento-pick-grid">{filtered.slice(page * 12, page * 12 + 12).map(({card, level}) => {
      const picked = selected.includes(card.id)
      return <button className="memento-pick-card" key={card.id} aria-label={`${picked ? '取消选择' : '选择'} ${cardName(card)} ${RARITY_CN[card.rarity]} ${card.rating}`} aria-pressed={picked} disabled={!picked && selected.length >= 5} onClick={() => {
        if (picked) { setHole(selected.indexOf(card.id)); change(selected.filter(id => id !== card.id)); return }
        const at = hole !== null && hole <= selected.length ? hole : selected.length
        setHole(null); change([...selected.slice(0, at), card.id, ...selected.slice(at)])
      }}>
        <CardFace card={card} level={level} /><span>{picked ? `已选 ${selected.indexOf(card.id) + 1}` : '选择此卡'}</span>
      </button>
    })}</div>
    {filtered.length > 12 && <div className="memento-pages"><button disabled={!page} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page + 1}/{Math.ceil(filtered.length / 12)}</span><button disabled={(page + 1) * 12 >= filtered.length} onClick={() => setPage(p => p + 1)}>下一页</button></div>}
  </section>
}
