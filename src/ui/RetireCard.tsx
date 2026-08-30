import { useGame } from './ctx'
import { Modal } from './common'
import { dossierOf, faceUrl } from '../engine/dossier'
import { ratingOf } from '../engine/match'
import { natName } from './Card'
import type { RetireNote } from '../engine/types'

/**
 * The send-off.
 *
 * A retirement used to be one line of news about a player who no longer
 * existed. This is the card people asked to screenshot — and because it WILL
 * be screenshotted and passed around, every fact on it is from this save:
 * the clubs he served here, the titles he lifted here, the numbers he put up
 * here. Only the face and the name are the real person's. The 游戏内容 label
 * sits inside the card so no crop reads as real news about a real player.
 */
export default function RetireCard({ note, onClose }: { note: RetireNote; onClose: () => void }) {
  const { game } = useGame()
  const d = dossierOf(note.id)
  const c = note.career
  const kd = c.deaths ? (c.kills / c.deaths).toFixed(2) : '—'
  const rating = c.rounds ? ratingOf(c).toFixed(2) : null
  const mine = note.clubId === game.myTeam
  const stints = note.stints ?? []
  const titles = note.titles ?? []

  return (
    <Modal
      title={
        <span className="row" style={{ gap: 8 }}>
          <span>👋 职业生涯谢幕 · {note.year}</span>
          <span className="tag" title="本卡为《VCT电竞经理》游戏模拟内容">游戏内容</span>
        </span>
      }
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
          </div>
        </div>
      </div>

      {stints.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>本档效力履历 · 2026 起</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {stints.slice(-8).map((s, i) => (
              <span key={i} className="chiplet">
                {s.team} <span className="faint">{s.from === s.to ? s.from : `${s.from}–${s.to}`}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {titles.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>本档冠军荣誉 · {titles.length} 座</div>
          {titles.slice(-6).map((h, i) => (
            <div key={i} className="small" style={{ padding: '2px 0' }}>
              🏆 {h.year} · {h.title}
            </div>
          ))}
          {titles.length > 6 && (
            <div className="tiny faint" style={{ paddingTop: 2 }}>…以及更早的 {titles.length - 6} 座</div>
          )}
        </div>
      )}

      {c.maps > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>本档生涯数据</div>
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
        <br />
        《VCT电竞经理》· 履历、荣誉与数据均为本存档 2026 年起的游戏模拟，非真实资讯。
      </p>

      <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="primary sm" onClick={onClose}>目送他离开</button>
      </div>
    </Modal>
  )
}
