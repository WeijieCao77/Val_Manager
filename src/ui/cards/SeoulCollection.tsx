import { useMemo, useState } from 'react'
import { SEOUL_CARDS } from '../../engine/cards'
import { SEOUL_TEAMS } from '../../engine/seoul2024'
import { SeoulCard, SeoulCardBack, SeoulMark, SeoulSources } from './SeoulDesign'
import SeoulPackDisplay from './SeoulPackDisplay'

export default function SeoulCollection() {
  const [team, setTeam] = useState('all')
  const [q, setQ] = useState('')
  const [back, setBack] = useState(false)
  const cards = useMemo(() => SEOUL_CARDS.filter(c => (team === 'all' || c.clubTag === team) && `${c.ign} ${c.realName ?? ''} ${c.clubTag}`.toLowerCase().includes(q.trim().toLowerCase())), [team, q])
  return <main className="seoul-exhibit">
    <nav className="seoul-nav"><a href="/cards">← 返回开瓦包</a><span>EVENT COLLECTION / 001</span><SeoulMark /></nav>
    <section className="seoul-hero">
      <div className="seoul-hero-copy"><span className="seoul-eyebrow">VALORANT CHAMPIONS · 2024</span><h1>首尔 2024<br /><span>冠军赛</span>系列</h1><p>当届 16 支战队、80 位登场选手，每人一张赛事卡。<br />卡包在开瓦包「抽卡」页，「首尔征途」可以按当年赛程重打。</p><div className="seoul-hero-meta"><span><b>16</b>参赛战队</span><span><b>80</b>独立编号</span><span><b>2024</b>08.01 — 08.25</span></div><a className="seoul-cta" href="#seoul-roster">浏览完整系列 ↗</a></div>
      <div className="seoul-hero-objects"><div className="seoul-object-back"><SeoulCardBack /></div><div className="seoul-object-pack"><SeoulPackDisplay /></div><div className="seoul-object-front"><SeoulCard card={SEOUL_CARDS.find(c => c.ign === 'ZmjjKK')!} size="lg" /></div></div>
    </section>
    <section className="seoul-roster" id="seoul-roster"><div className="seoul-roster-head"><div><span className="seoul-eyebrow">THE COMPLETE COLLECTION</span><h2>全部 80 张</h2></div><button onClick={() => setBack(v => !v)} aria-pressed={back}>{back ? '查看选手正面' : '查看专属卡背'} ↻</button></div>
      <div className="seoul-filter"><label><span>搜索选手</span><input placeholder="选手 ID / 姓名 / 战队" value={q} onChange={e => setQ(e.target.value)} /></label><label><span>当届战队</span><select value={team} onChange={e => setTeam(e.target.value)}><option value="all">全部 16 支战队</option>{SEOUL_TEAMS.map(t => <option value={t.tag} key={t.tag}>{t.tag} · {t.name}</option>)}</select></label><span>{cards.length} / 80 张</span></div>
      <div className="seoul-card-grid">{cards.map(c => <div key={c.id}>{back ? <SeoulCardBack /> : <SeoulCard card={c} size="lg" />}<span className="seoul-caption">{String(c.seoul!.number).padStart(3, '0')} / {c.ign} · {c.clubTag}</span></div>)}</div>
      {!cards.length && <p className="seoul-empty">没有匹配的选手。<button onClick={() => { setQ(''); setTeam('all') }}>清除筛选</button></p>}
    </section><SeoulSources /><footer className="seoul-footer">SEOUL 2024 · 首尔冠军赛纪念系列</footer>
  </main>
}
