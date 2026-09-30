import { useMemo, useState } from 'react'
import CardFace, { CardBack } from '../Card'
import { BANGKOK_CARDS } from '../../engine/cards'
import { BANGKOK_TEAMS, BANGKOK_TOTAL } from '../../engine/bangkok2025'
import { BangkokSources } from './BangkokDesign'
import BangkokPackDisplay from './BangkokPackDisplay'
import './seoul2024.css'

/** /bangkok-2025 — the whole series, laid out as /seoul-2024 lays out 首尔, in the lotus palette. */
export default function BangkokCollection() {
  const [team, setTeam] = useState('all')
  const [q, setQ] = useState('')
  const [back, setBack] = useState(false)
  const cards = useMemo(() => BANGKOK_CARDS.filter(c => (team === 'all' || c.clubTag === team) && `${c.ign} ${c.realName ?? ''} ${c.clubTag}`.toLowerCase().includes(q.trim().toLowerCase())), [team, q])
  const hero = [...BANGKOK_CARDS].filter(c => c.clubTag === 'T1').sort((a, b) => b.rating - a.rating)[0]
  return <main className="seoul-exhibit bk25-exhibit">
    <nav className="seoul-nav"><a href="/cards">← 返回开瓦包</a><span>EVENT COLLECTION / 002</span><span className="bk25-eyebrow">MASTERS BANGKOK</span></nav>
    <section className="seoul-hero">
      <div className="seoul-hero-copy"><span className="seoul-eyebrow">VALORANT MASTERS · 2025</span><h1>曼谷 2025<br /><span>大师赛</span>系列</h1><p>当届 8 支战队、{BANGKOK_TOTAL} 位登场选手，每人一张赛事卡。<br />卡包在开瓦包「抽卡」页。</p><div className="seoul-hero-meta"><span><b>8</b>参赛战队</span><span><b>{BANGKOK_TOTAL}</b>独立编号</span><span><b>2025</b>02.20 — 03.02</span></div><a className="seoul-cta" href="#seoul-roster">浏览完整系列 ↗</a></div>
      <div className="seoul-hero-objects"><div className="seoul-object-back"><CardBack bangkok /></div><div className="seoul-object-pack bk25-object-pack"><BangkokPackDisplay /></div>{hero && <div className="seoul-object-front bk25-object-front"><CardFace card={hero} size="lg" /></div>}</div>
    </section>
    <section className="seoul-roster" id="seoul-roster"><div className="seoul-roster-head"><div><span className="seoul-eyebrow">THE COMPLETE COLLECTION</span><h2>全部 {BANGKOK_TOTAL} 张</h2></div><button onClick={() => setBack(v => !v)} aria-pressed={back}>{back ? '查看选手正面' : '查看专属卡背'} ↻</button></div>
      <div className="seoul-filter"><label><span>搜索选手</span><input placeholder="选手 ID / 姓名 / 战队" value={q} onChange={e => setQ(e.target.value)} /></label><label><span>当届战队</span><select value={team} onChange={e => setTeam(e.target.value)}><option value="all">全部 8 支战队</option>{BANGKOK_TEAMS.map(t => <option value={t.tag} key={t.tag}>{t.tag} · {t.name}</option>)}</select></label><span>{cards.length} / {BANGKOK_TOTAL} 张</span></div>
      <div className="seoul-card-grid">{cards.map(c => <div key={c.id}>{back ? <CardBack bangkok /> : <CardFace card={c} size="lg" />}<span className="seoul-caption">{String(c.bangkok!.number).padStart(3, '0')} / {c.ign} · {c.clubTag}</span></div>)}</div>
      {!cards.length && <p className="seoul-empty">没有匹配的选手。<button onClick={() => { setQ(''); setTeam('all') }}>清除筛选</button></p>}
    </section><BangkokSources /><footer className="seoul-footer">BANGKOK 2025 · 曼谷大师赛纪念系列</footer>
  </main>
}
