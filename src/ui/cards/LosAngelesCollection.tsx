import { useMemo, useState } from 'react'
import CardFace, { CardBack } from '../Card'
import { LOS_ANGELES_CARDS } from '../../engine/cards'
import { LOS_ANGELES_TEAMS, LOS_ANGELES_TOTAL } from '../../engine/losangeles2023'
import { LosAngelesSources } from './LosAngelesDesign'
import LosAngelesShelfPack from './LosAngelesShelfPack'
import './seoul2024.css'

/** /los-angeles-2023 — the whole series, laid out as /seoul-2024 and /bangkok-2025 lay theirs out, in the sunset palette. */
export default function LosAngelesCollection() {
  const [team, setTeam] = useState('all')
  const [q, setQ] = useState('')
  const [back, setBack] = useState(false)
  const cards = useMemo(() => LOS_ANGELES_CARDS.filter(c => (team === 'all' || c.clubTag === team) && `${c.ign} ${c.realName ?? ''} ${c.clubTag}`.toLowerCase().includes(q.trim().toLowerCase())), [team, q])
  const hero = [...LOS_ANGELES_CARDS].filter(c => c.clubTag === 'EG').sort((a, b) => b.rating - a.rating)[0]
  return <main className="seoul-exhibit la-exhibit">
    <nav className="seoul-nav"><a href="/cards">← 返回开瓦包</a><span>EVENT COLLECTION / 003</span><span className="la-eyebrow">CHAMPIONS LOS ANGELES</span></nav>
    <section className="seoul-hero">
      <div className="seoul-hero-copy"><span className="seoul-eyebrow">VALORANT CHAMPIONS · 2023</span><h1>洛杉矶 2023<br /><span>冠军赛</span>系列</h1><p>当届 16 支战队、{LOS_ANGELES_TOTAL} 位登场选手，每人一张赛事卡。<br />卡包在开瓦包「抽卡」页。</p><div className="seoul-hero-meta"><span><b>16</b>参赛战队</span><span><b>{LOS_ANGELES_TOTAL}</b>独立编号</span><span><b>2023</b>08.06 — 08.26</span></div><a className="seoul-cta" href="#seoul-roster">浏览完整系列 ↗</a></div>
      <div className="seoul-hero-objects"><div className="seoul-object-back"><CardBack losAngeles /></div><div className="seoul-object-pack la-object-pack"><LosAngelesShelfPack /></div>{hero && <div className="seoul-object-front la-object-front"><CardFace card={hero} size="lg" /></div>}</div>
    </section>
    <section className="seoul-roster" id="seoul-roster"><div className="seoul-roster-head"><div><span className="seoul-eyebrow">THE COMPLETE COLLECTION</span><h2>全部 {LOS_ANGELES_TOTAL} 张</h2></div><button onClick={() => setBack(v => !v)} aria-pressed={back}>{back ? '查看选手正面' : '查看专属卡背'} ↻</button></div>
      <div className="seoul-filter"><label><span>搜索选手</span><input placeholder="选手 ID / 姓名 / 战队" value={q} onChange={e => setQ(e.target.value)} /></label><label><span>当届战队</span><select value={team} onChange={e => setTeam(e.target.value)}><option value="all">全部 16 支战队</option>{LOS_ANGELES_TEAMS.map(t => <option value={t.tag} key={t.tag}>{t.tag} · {t.name}</option>)}</select></label><span>{cards.length} / {LOS_ANGELES_TOTAL} 张</span></div>
      <div className="seoul-card-grid">{cards.map(c => <div key={c.id}>{back ? <CardBack losAngeles /> : <CardFace card={c} size="lg" />}<span className="seoul-caption">{String(c.losAngeles!.number).padStart(3, '0')} / {c.ign} · {c.clubTag}</span></div>)}</div>
      {!cards.length && <p className="seoul-empty">没有匹配的选手。<button onClick={() => { setQ(''); setTeam('all') }}>清除筛选</button></p>}
    </section><LosAngelesSources /><footer className="seoul-footer">LOS ANGELES 2023 · 洛杉矶冠军赛纪念系列</footer>
  </main>
}
