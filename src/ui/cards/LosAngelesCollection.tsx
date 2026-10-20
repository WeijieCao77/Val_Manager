import { useEffect, useMemo, useState } from 'react'
import CardFace, { CardBack } from '../Card'
import { LOS_ANGELES_CARDS } from '../../engine/cards'
import { ACS_WEIGHT, LOS_ANGELES_TEAMS, LOS_ANGELES_TOTAL, losAngelesBreakdown } from '../../engine/losangeles2023'
import type { LosAngelesBreakdown } from '../../engine/losangeles2023'
import { LosAngelesSources } from './LosAngelesDesign'
import LosAngelesShelfPack from './LosAngelesShelfPack'
import './seoul2024.css'

/** /los-angeles-2023 — the whole series, laid out as /seoul-2024 and /bangkok-2025 lay theirs out, in the sunset palette. */
const RARITY = { gold: '金卡', silver: '银卡', bronze: '铜卡', mythic: '彩卡' }
const pct = Math.round(ACS_WEIGHT * 100)
const ROWS: [string, (b: LosAngelesBreakdown) => number, (n: number) => string, string?][] = [
  ['出场地图', b => b.maps, n => `${n} 张`],
  ['当届 Rating 2.0', b => b.rating, n => n.toFixed(2)],
  ['当届 ACS', b => b.acs, n => n.toFixed(0)],
  ['按轮次加权的 Rating', b => b.stageRating, n => n.toFixed(3), '后面的轮次更重'],
  ['按轮次加权的 ACS', b => b.stageAcs, n => n.toFixed(1)],
  ['向全场平均靠拢后的 Rating', b => b.settledRating, n => n.toFixed(3), '打得少的靠得多'],
  ['向全场平均靠拢后的 ACS', b => b.settledAcs, n => n.toFixed(1)],
  [`混合（Rating ${100 - pct}% · ACS ${pct}%）`, b => b.mixed, n => n.toFixed(3), '换算成 Rating 的尺度'],
  ['战斗分', b => b.combat, n => n.toFixed(1), '70 + (混合 − 0.75) × 45'],
  ['指挥加分', b => b.call, n => n ? `+${n}` : '—'],
  ['先锋加分', b => b.lift, n => n ? `+${n}` : '—'],
  ['赛事 MVP', b => b.mvp, n => n ? `+${n}` : '—'],
]

/** 评分怎么算: the rule in a few lines, and any two players' numbers side by side. */
function RatingRules({ pair, setPair }: { pair: [string, string]; setPair: (p: [string, string]) => void }) {
  const cards = [...LOS_ANGELES_CARDS].sort((a, b) => a.ign.localeCompare(b.ign))
  const picked = pair.map(id => LOS_ANGELES_CARDS.find(c => c.losAngeles!.vlrId === id)!)
  const bd = picked.map(c => losAngelesBreakdown(c.losAngeles!.vlrId)!)
  return <section className="la-rules" id="la-rules">
    <div className="seoul-roster-head"><div><span className="seoul-eyebrow">HOW THE NUMBERS ARE MADE</span><h2>评分怎么算</h2></div></div>
    <ol>
      <li>只看本届：洛杉矶冠军赛每张图的 VLR 数据，每张图按回合数算。</li>
      <li>后面的轮次更重：小组赛 ×1，胜者组四分之一决赛和败者组前两轮 ×1.5，胜者组半决赛到败者组决赛 ×2，总决赛 ×3。</li>
      <li>打得少的向全场平均靠：每人加上 6 张全场平均水平的图再算。打 4 张图的保留 40% 的差距，打 24 张的保留 80%。</li>
      <li>战斗分：Rating 2.0 占 {100 - pct}%，ACS 占 {pct}%。</li>
      <li>加分：指挥按名次 +1 到 +6；先锋按 KAST 和助攻，最多 +3；赛事 MVP Demon1 +5。</li>
      <li>金卡 ≥84，银卡 ≥76，其余铜卡。首尔、曼谷系列用的是同一套，只是不算 ACS。</li>
    </ol>
    <h3>两位选手对比</h3>
    <p className="la-rules-hint">选两位选手，或者点上面的卡片。</p>
    <div className="la-rules-pick">{[0, 1].map(i => <select key={i} value={pair[i]} onChange={e => setPair(i ? [pair[0], e.target.value] : [e.target.value, pair[1]])}>
      {cards.map(c => <option key={c.id} value={c.losAngeles!.vlrId}>{c.ign} · {c.clubTag}</option>)}</select>)}</div>
    <table className="la-rules-table"><thead><tr><th></th>{picked.map(c => <th key={c.id}>{c.ign}<small>{c.clubTag} · {c.role}</small></th>)}</tr></thead>
      <tbody>{ROWS.map(([label, get, fmt, note]) => {
        const [a, b] = bd.map(get)
        return <tr key={label}><th>{label}{note && <small>{note}</small>}</th>{[a, b].map((v, i) => <td key={i} className={a !== b && v === Math.max(a, b) && label !== '出场地图' ? 'up' : ''}>{fmt(v)}</td>)}</tr>
      })}
        <tr className="la-rules-total"><th>卡面</th>{picked.map(c => <td key={c.id}><b>{c.rating}</b> {RARITY[c.rarity]}</td>)}</tr></tbody></table>
  </section>
}

export default function LosAngelesCollection() {
  const [pair, setPair] = useState<[string, string]>(['15559', '3520'])
  const pickCard = (vid: string) => setPair(pair[0] === vid ? pair : [vid, pair[0]])
  // the page renders after the browser looked for #la-rules / #seoul-roster, and a tap on the hash it already
  // has does nothing — so the page jumps itself, on load and on every in-page link
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  useEffect(() => { const id = location.hash.slice(1); if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' })) }, [])
  const anchor = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); history.replaceState(null, '', `#${id}`); jump(id) }
  const [team, setTeam] = useState('all')
  const [q, setQ] = useState('')
  const [back, setBack] = useState(false)
  const cards = useMemo(() => LOS_ANGELES_CARDS.filter(c => (team === 'all' || c.clubTag === team) && `${c.ign} ${c.realName ?? ''} ${c.clubTag}`.toLowerCase().includes(q.trim().toLowerCase())), [team, q])
  const hero = [...LOS_ANGELES_CARDS].filter(c => c.clubTag === 'EG').sort((a, b) => b.rating - a.rating)[0]
  return <main className="seoul-exhibit la-exhibit">
    <nav className="seoul-nav"><a href="/cards">← 返回开瓦包</a><span>EVENT COLLECTION / 003</span><span className="la-eyebrow">CHAMPIONS LOS ANGELES</span></nav>
    <section className="seoul-hero">
      <div className="seoul-hero-copy"><span className="seoul-eyebrow">VALORANT CHAMPIONS · 2023</span><h1>洛杉矶 2023<br /><span>冠军赛</span>系列</h1><p>当届 16 支战队、{LOS_ANGELES_TOTAL} 位登场选手，每人一张赛事卡。<br />卡包在开瓦包「抽卡」页。</p><div className="seoul-hero-meta"><span><b>16</b>参赛战队</span><span><b>{LOS_ANGELES_TOTAL}</b>独立编号</span><span><b>2023</b>08.06 — 08.26</span></div><a className="seoul-cta" href="#seoul-roster" onClick={anchor('seoul-roster')}>浏览完整系列 ↗</a> <a className="seoul-cta la-cta-rules" href="#la-rules" onClick={anchor('la-rules')}>评分怎么算</a></div>
      <div className="seoul-hero-objects"><div className="seoul-object-back"><CardBack losAngeles /></div><div className="seoul-object-pack la-object-pack"><LosAngelesShelfPack /></div>{hero && <div className="seoul-object-front la-object-front"><CardFace card={hero} size="lg" /></div>}</div>
    </section>
    <section className="seoul-roster" id="seoul-roster"><div className="seoul-roster-head"><div><span className="seoul-eyebrow">THE COMPLETE COLLECTION</span><h2>全部 {LOS_ANGELES_TOTAL} 张</h2></div><button onClick={() => setBack(v => !v)} aria-pressed={back}>{back ? '查看选手正面' : '查看专属卡背'} ↻</button></div>
      <div className="seoul-filter"><label><span>搜索选手</span><input placeholder="选手 ID / 姓名 / 战队" value={q} onChange={e => setQ(e.target.value)} /></label><label><span>当届战队</span><select value={team} onChange={e => setTeam(e.target.value)}><option value="all">全部 16 支战队</option>{LOS_ANGELES_TEAMS.map(t => <option value={t.tag} key={t.tag}>{t.tag} · {t.name}</option>)}</select></label><span>{cards.length} / {LOS_ANGELES_TOTAL} 张</span></div>
      <div className="seoul-card-grid">{cards.map(c => <div key={c.id}>{back ? <CardBack losAngeles /> : <CardFace card={c} size="lg" onClick={() => { pickCard(c.losAngeles!.vlrId); jump('la-rules') }} />}<span className="seoul-caption">{String(c.losAngeles!.number).padStart(3, '0')} / {c.ign} · {c.clubTag}</span></div>)}</div>
      {!cards.length && <p className="seoul-empty">没有匹配的选手。<button onClick={() => { setQ(''); setTeam('all') }}>清除筛选</button></p>}
    </section><RatingRules pair={pair} setPair={setPair} /><LosAngelesSources /><footer className="seoul-footer">LOS ANGELES 2023 · 洛杉矶冠军赛纪念系列</footer>
  </main>
}
