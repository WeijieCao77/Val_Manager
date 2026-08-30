import { useEffect, useMemo, useState } from 'react'
import { WORLD_PLAYERS, WORLD_TEAMS } from '../engine/world'
import { DOSSIER, dossierOf, honoursOf, loadRecords, placementsOf, recordsNow, tenuresOf, titleCount } from '../engine/dossier'
import type { Records } from '../engine/dossier'
import { BASE_PLAYER_CARDS, LEGEND_CARDS, RARITY_CN } from '../engine/cards'
import type { PlayerCard } from '../engine/cards'
import CardFace, { Flag, natName } from './Card'
import { AgentIcon, Panel, Bar, moneyFull } from './common'
import { agentCn } from '../engine/content'
import { ATTR_CN, ATTR_KEYS, REGION_CN, REGIONS } from '../engine/types'
import type { Region, Role } from '../engine/types'

const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫', '自由人']

// the ordinary card, never the彩卡 version: this screen lists people
const cardOf = new Map(BASE_PLAYER_CARDS.map((c) => [c.playerId, c]))

/** playerId -> the彩卡 that exist of him, for the ★ in the list. */
const legendsOf = new Map<string, typeof LEGEND_CARDS>()
for (const c of LEGEND_CARDS) {
  const list = legendsOf.get(c.playerId) ?? []
  list.push(c)
  legendsOf.set(c.playerId, list)
}
const teamOf = new Map(WORLD_TEAMS.map((t) => [t.id, t]))

/**
 * The reference half of the game: everyone in it, and what they have actually
 * done.
 *
 * Every line on this screen is a real record — clubs and dates from
 * Liquipedia, placements and prize money from vlr.gg. Nothing is generated,
 * and where a source has nothing the screen says so rather than filling it in.
 */
export default function Dossier({
  playerId, onOpen, onClose,
}: {
  /** when set, the screen opens straight onto this player */
  playerId?: string | null
  onOpen: (id: string | null) => void
  /** shown as a back button when the dossier was reached from somewhere else */
  onClose?: () => void
}) {
  const [q, setQ] = useState('')
  const [region, setRegion] = useState<Region | 'all'>('all')
  const [role, setRole] = useState<Role | 'all'>('all')
  const [sort, setSort] = useState<'rating' | 'honours' | 'winnings' | 'age'>('rating')

  const rows = useMemo(() => {
    const text = q.trim().toLowerCase()
    return BASE_PLAYER_CARDS
      .filter((c) => {
        if (region !== 'all' && c.region !== region) return false
        if (role !== 'all' && !c.roles.includes(role)) return false
        if (!text) return true
        const hay = `${c.ign} ${c.realName ?? ''} ${c.clubTag ?? ''} ${natName(c.nat)} ${c.nat ?? ''}`
        return hay.toLowerCase().includes(text)
      })
      .map((c) => ({
        card: c,
        // counted at build time so the list can sort by silverware without
        // pulling in the 850KB records file
        titles: titleCount(c.playerId),
        winnings: dossierOf(c.playerId)?.win ?? 0,
      }))
      .sort((a, b) => {
        if (sort === 'honours') return b.titles - a.titles || b.card.rating - a.card.rating
        if (sort === 'winnings') return b.winnings - a.winnings || b.card.rating - a.card.rating
        if (sort === 'age') return a.card.age - b.card.age || b.card.rating - a.card.rating
        return b.card.rating - a.card.rating
      })
  }, [q, region, role, sort])

  const open = playerId ? cardOf.get(playerId) : null
  if (open) return <Detail card={open} onBack={() => onOpen(null)} />

  return (
    <Panel
      title="选手资料库"
      actions={
        <div className="row" style={{ gap: 8 }}>
          <span className="tiny muted mono">{rows.length} / {WORLD_PLAYERS.length}</span>
          {onClose && <button className="ghost sm" onClick={onClose}>返回</button>}
        </div>
      }
    >
      <p className="tiny faint" style={{ marginTop: 0, lineHeight: 1.7 }}>
        {DOSSIER.meta.players} 名选手的照片、国籍、生涯队伍、荣誉与赛事记录。
        名次、奖金与 {DOSSIER.meta.photos - (DOSSIER.meta.lpPhotos ?? 0)} 张照片取自 vlr.gg；
        队伍履历与另外 {DOSSIER.meta.lpPhotos ?? 0} 张照片取自 Liquipedia（图片依 CC BY-SA 3.0 使用）。
        共收录 {DOSSIER.meta.events} 项赛事。
      </p>

      <div className="row wrap" style={{ gap: 8, margin: '12px 0' }}>
        <input
          style={{ width: 200 }}
          placeholder="搜 ID / 真名 / 战队 / 国籍"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select style={{ width: 'auto' }} value={region} onChange={(e) => setRegion(e.target.value as Region | 'all')}>
          <option value="all">全部赛区</option>
          {REGIONS.map((r) => <option key={r} value={r}>{REGION_CN[r]}</option>)}
        </select>
        <select style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value as Role | 'all')}>
          <option value="all">全部位置</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="seg">
          <button className={sort === 'rating' ? 'on' : ''} onClick={() => setSort('rating')}>能力</button>
          <button className={sort === 'honours' ? 'on' : ''} onClick={() => setSort('honours')}>冠军</button>
          <button className={sort === 'winnings' ? 'on' : ''} onClick={() => setSort('winnings')}>奖金</button>
          <button className={sort === 'age' ? 'on' : ''} onClick={() => setSort('age')}>年龄</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>选手</th>
              <th>真名</th>
              <th>国籍</th>
              <th>战队</th>
              <th>位置</th>
              <th className="right">能力</th>
              <th className="right">冠军</th>
              <th className="right">奖金</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map(({ card, titles, winnings }) => (
              <tr key={card.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(card.playerId)}>
                <td>
                  <b>{card.ign}</b>
                  {legendsOf.has(card.playerId) && (
                    <span
                      className="cf-star"
                      style={{ position: 'static', marginLeft: 5, fontSize: 11 }}
                      title={legendsOf.get(card.playerId)!.map((l) => l.legend!.title).join('、')}
                    >
                      ★
                    </span>
                  )}
                  {card.isIgl && <span className="tag t2" style={{ marginLeft: 5 }}>IGL</span>}
                </td>
                <td className="muted small">{card.realName ?? '—'}</td>
                <td className="small"><Flag nat={card.nat} /> {natName(card.nat)}</td>
                <td>{card.clubTag ?? <span className="faint">自由人</span>}</td>
                <td className="small">{card.roles.join('/')}</td>
                <td className="right mono">{card.rating}</td>
                <td className="right mono">{titles || <span className="faint">—</span>}</td>
                <td className="right mono small">{winnings ? moneyFull(winnings) : <span className="faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 300 && <p className="tiny faint" style={{ marginTop: 10 }}>只列出了前 300 人，搜一下缩小范围。</p>}
    </Panel>
  )
}

function Detail({ card, onBack }: { card: PlayerCard; onBack: () => void }) {
  const d = dossierOf(card.playerId)
  const player = WORLD_PLAYERS.find((p) => p.id === card.playerId)
  const club = card.clubId ? teamOf.get(card.clubId) : null

  // The club history and the tournament list live in a file that is only
  // fetched when somebody actually opens a dossier. Everything above the fold
  // renders immediately; these two panels say they are loading.
  const [records, setRecords] = useState<Records | null>(recordsNow)
  useEffect(() => {
    if (records) return
    let alive = true
    void loadRecords().then((r) => { if (alive) setRecords(r) })
    return () => { alive = false }
  }, [records])

  const honours = records ? honoursOf(records, card.playerId) : []
  const placements = records ? placementsOf(records, card.playerId) : []
  const tenures = records ? tenuresOf(records, card.playerId) : []

  const byYear = useMemo(() => {
    const m = new Map<number, typeof placements>()
    for (const p of placements) {
      const y = p.year ?? 0
      const list = m.get(y) ?? []
      list.push(p)
      m.set(y, list)
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [placements])

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="ghost sm" onClick={onBack}>← 返回资料库</button>
      </div>

      <Panel title={card.ign}>
        <div className="dossier-head">
          <CardFace card={card} size="lg" />
          <div style={{ flex: 1, minWidth: 250 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{card.realName ?? card.ign}</div>
            <div className="small muted" style={{ marginTop: 6, lineHeight: 1.9 }}>
              <Flag nat={card.nat} /> {natName(card.nat)} · {REGION_CN[card.region]}
              <br />
              {card.age} 岁
              {player?.birth ? `（${player.birth}）` : player?.ageEstimated ? '（生日未知，年龄为估算）' : ''}
              {' · '}
              {club ? club.name : '自由人'}
              <br />
              {card.roles.join(' / ')}{card.isIgl && ' · 队内指挥'}
              {' · '}{RARITY_CN[card.rarity]} {card.rating}
            </div>
            {!!legendsOf.get(card.playerId)?.length && (
              <div
                className="small"
                style={{
                  marginTop: 10, padding: '8px 11px', borderRadius: 4, lineHeight: 1.7,
                  background: 'rgba(180,120,255,.10)',
                  border: '1px solid rgba(180,120,255,.35)',
                }}
              >
                <b>★ 彩卡</b>
                {legendsOf.get(card.playerId)!.map((l) => (
                  <div key={l.id} className="tiny" style={{ marginTop: 3 }}>
                    {l.legend!.title}
                    <span className="faint"> · {l.legend!.clubTag} · 评分 {l.rating}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              {titleCount(card.playerId) > 0 && (
                <span className="trait" data-good="y">{titleCount(card.playerId)} 座冠军</span>
              )}
              {!!d?.win && <span className="trait" data-good="y">生涯奖金 {moneyFull(d.win)}</span>}
              {placements.length > 0 && <span className="trait">{placements.length} 项赛事记录</span>}
              {tenures.length > 0 && <span className="trait">{tenures.length} 段队伍经历</span>}
            </div>
            {d?.vlr && (
              <a
                className="tiny"
                style={{ display: 'inline-block', marginTop: 10 }}
                href={`https://www.vlr.gg/player/${d.vlr}/`}
                target="_blank"
                rel="noreferrer noopener"
              >
                在 vlr.gg 上查看原始资料 ↗
              </a>
            )}
          </div>
        </div>
      </Panel>

      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Panel title="能力">
          {ATTR_KEYS.map((k) => (
            <div key={k} className="row" style={{ gap: 10, margin: '5px 0' }}>
              <span className="tiny faint" style={{ width: 30 }}>{ATTR_CN[k]}</span>
              <div style={{ flex: 1 }}><Bar value={card.attrs[k]} /></div>
              <b className="mono tiny" style={{ width: 20, textAlign: 'right' }}>{card.attrs[k]}</b>
            </div>
          ))}
          {player?.vlr?.rating != null && (
            <p className="tiny faint" style={{ marginTop: 12, marginBottom: 0, lineHeight: 1.7 }}>
              这些数值由真实数据分位映射得出：vlr.gg 记录的 Rating {player.vlr.rating}
              {player.vlr.acs != null && ` · ACS ${player.vlr.acs}`}
              {player.vlr.rounds ? ` · ${player.vlr.rounds} 回合` : ''}。
            </p>
          )}
          {!!player?.agentPool?.length && (
            <div style={{ marginTop: 12 }}>
              <div className="tiny faint" style={{ marginBottom: 5 }}>真实英雄池</div>
              <div className="row wrap" style={{ gap: 4 }}>
                {player.agentPool.map((a) => (
                  <span key={a} className="chiplet row" style={{ gap: 4, alignItems: 'center' }}>
                    <AgentIcon name={a} size={16} />{agentCn(a)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="荣誉">
          {!records ? (
            <p className="empty">读取中…</p>
          ) : honours.length === 0 ? (
            <p className="empty">还没有拿过冠军。</p>
          ) : (
            <div className="grid" style={{ gap: 6 }}>
              {honours.map((h, i) => (
                <div key={i} className={`trophy${h.major ? ' major' : ''}`}>
                  <span>{h.major ? '🏆' : '🥇'}</span>
                  <span className="small">{h.event}</span>
                  <span className="yr mono">{h.year ?? ''}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Panel title="生涯队伍">
          {!records ? (
            <p className="empty">读取中…</p>
          ) : tenures.length === 0 ? (
            <p className="empty">Liquipedia 上没有这名选手的队伍履历。</p>
          ) : (
            <ul className="cv">
              {tenures.map((t, i) => (
                <li key={i} className={t.current ? 'now' : ''}>
                  <div className="small">
                    <b>{t.club}</b>
                    {t.current && <span className="tag t1" style={{ marginLeft: 6 }}>现役</span>}
                  </div>
                  <div className="yrs">
                    {t.from ?? '?'} → {t.to ?? '至今'}
                    {t.months != null && t.months > 0 && ` · ${
                      t.months >= 12 ? `${Math.floor(t.months / 12)} 年${t.months % 12 ? ` ${t.months % 12} 个月` : ''}` : `${t.months} 个月`
                    }`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="赛事记录" actions={<span className="tiny muted">{records ? `${placements.length} 项` : ''}</span>}>
          {!records ? (
            <p className="empty">读取中…</p>
          ) : placements.length === 0 ? (
            <p className="empty">vlr.gg 上没有这名选手的参赛记录。</p>
          ) : (
            byYear.map(([year, list]) => (
              <div key={year} style={{ marginBottom: 12 }}>
                <div className="tiny faint" style={{ marginBottom: 4 }}>{year || '年份不明'}</div>
                {list.map((p, i) => (
                  <div
                    key={i}
                    className="row"
                    style={{
                      justifyContent: 'space-between', gap: 10,
                      padding: '4px 0', borderBottom: '1px solid var(--line-soft)',
                    }}
                  >
                    <span className="small" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.won && '🥇 '}{p.event}
                      {p.club && <span className="tiny faint"> · {p.club}</span>}
                    </span>
                    <span
                      className="tiny mono"
                      style={{ color: p.won ? 'var(--warn)' : p.podium ? 'var(--win)' : 'var(--muted)' }}
                    >
                      {p.place ?? p.stage ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </Panel>
      </div>
    </>
  )
}
