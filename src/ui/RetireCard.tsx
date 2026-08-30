import { useEffect, useState } from 'react'
import { useGame } from './ctx'
import { Modal, money } from './common'
import {
  dossierOf, faceUrl, honoursOf, loadRecords, recordsNow, tenuresOf,
} from '../engine/dossier'
import type { Records } from '../engine/dossier'
import { ratingOf } from '../engine/match'
import { natName } from './Card'
import type { RetireNote } from '../engine/types'

/**
 * The send-off.
 *
 * A retirement used to be one line of news about a player who no longer
 * existed. This is the card people asked to screenshot: the face, the clubs,
 * the trophies from his real career, and what he did in this save — shown
 * once for your own players and for stars, then kept in the news.
 */
export default function RetireCard({ note, onClose }: { note: RetireNote; onClose: () => void }) {
  const { game } = useGame()
  const d = dossierOf(note.id)
  const [records, setRecords] = useState<Records | null>(recordsNow)
  useEffect(() => {
    let alive = true
    void loadRecords().then((r) => { if (alive) setRecords(r) })
    return () => { alive = false }
  }, [])

  const honours = records ? honoursOf(records, note.id).slice(0, 6) : []
  const tenures = records ? tenuresOf(records, note.id) : []
  const c = note.career
  const kd = c.deaths ? (c.kills / c.deaths).toFixed(2) : '—'
  const rating = c.rounds ? ratingOf(c).toFixed(2) : null
  const mine = note.clubId === game.myTeam

  return (
    <Modal
      title={<span>👋 职业生涯谢幕 · {note.year}</span>}
      onClose={onClose}
      onBgClose={onClose}
    >
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', marginBottom: 14 }}>
        {d?.img && (
          <img
            src={faceUrl(d.img, d.v)}
            alt={note.ign}
            style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10, background: '#1b2836' }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{note.ign}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {d?.real ? `${d.real} · ` : ''}
            {d?.nat ? `${natName(d.nat)} · ` : ''}
            {note.age} 岁
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            {note.clubName && <span className="tag t1">最后一站 · {note.clubName}</span>}
            {mine && <span className="tag" style={{ borderColor: 'var(--accent-line)', color: 'var(--accent)' }}>你的队员</span>}
            {typeof d?.win === 'number' && d.win > 0 && (
              <span className="tag">生涯奖金 {money(d.win)}</span>
            )}
          </div>
        </div>
      </div>

      {tenures.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>效力履历</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {tenures.slice(0, 8).map((t, i) => (
              <span key={i} className="chiplet" title={t.from ? `${t.from} → ${t.to ?? '现在'}` : undefined}>
                {t.club}
              </span>
            ))}
          </div>
        </div>
      )}

      {honours.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>冠军荣誉</div>
          {honours.map((h, i) => (
            <div key={i} className="small" style={{ padding: '2px 0' }}>
              🏆 {h.year ?? ''} · {h.event}
            </div>
          ))}
        </div>
      )}

      {c.maps > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>2026 之后 · 本档生涯数据</div>
          <div className="grid c4" style={{ gap: 10 }}>
            <div className="stat"><span className="k">地图</span><span className="v sm">{c.maps}</span></div>
            <div className="stat"><span className="k">K/D</span><span className="v sm">{kd}</span></div>
            {rating && <div className="stat"><span className="k">评分</span><span className="v sm">{rating}</span></div>}
            <div className="stat"><span className="k">MVP</span><span className="v sm">{c.mvps}</span></div>
          </div>
        </div>
      )}

      <p className="tiny faint" style={{ marginTop: 12, marginBottom: 0 }}>
        {mine
          ? '他把最后一个赛季留在了你的更衣室。这张卡不会再出现——想留念就现在截图。'
          : '一个时代落幕。这张卡不会再出现——想留念就现在截图。'}
      </p>

      <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="primary sm" onClick={onClose}>目送他离开</button>
      </div>
    </Modal>
  )
}
