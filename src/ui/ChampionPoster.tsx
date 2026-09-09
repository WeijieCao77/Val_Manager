import { Crest } from './common'
import type { TitlePoster } from '../engine/types'

/**
 * 夺冠海报。
 *
 * 晋级已经有一张（QualifyPoster）——「确认晋级 Masters」是赛季的一个节点，而
 * 拿下冠军是赛季本身。这里用同一套版式，只把分量往上抬一级：三档赛事各有自己
 * 的色带和眉标，国际赛还带主办城市。
 *
 * 跟晋级那张一样，这是一张卡片不是一个弹窗：上面没有任何需要决定的东西。
 */
/**
 * 三档各自的色带、眉标和一行定性。
 *
 * 没有奖杯角标：那是 emoji 当图标用，而且色带、眉标和这一行已经把等级说完了，
 * 角标只是压在队徽上多一个东西。
 */
const TIER = {
  ascension: { eyebrow: 'Promoted', lead: '升入一级联赛', band: 'var(--sentinel)' },
  regional: { eyebrow: 'Champions', lead: '赛区冠军', band: 'var(--accent)' },
  international: { eyebrow: 'World Champions', lead: '国际赛冠军', band: 'var(--initiator)' },
} as const

export default function ChampionPoster({
  p, club, tag, onClose,
}: { p: TitlePoster; club: string; tag: string; onClose: () => void }) {
  const t = TIER[p.tier]
  return (
    <div
      className="poster-bg"
      role="dialog"
      aria-label={`${club} 夺得 ${p.name} 冠军`}
      onClick={onClose}
    >
      <div className={`poster poster-champ tier-${p.tier}`} onClick={(e) => e.stopPropagation()}>
        <div className="poster-band" aria-hidden="true" style={{ background: `linear-gradient(100deg, ${t.band}, color-mix(in srgb, ${t.band} 58%, #000))` }} />
        <div className="poster-eyebrow display">{t.eyebrow} · {p.year}</div>
        <div className="poster-crest"><Crest id={p.teamId} size={128} /></div>
        <div className="poster-club">{club} <span className="poster-tag">{tag}</span></div>
        <h2 className="poster-title">{p.name}</h2>
        <div className="poster-lead" style={{ color: t.band }}>{t.lead}</div>
        {p.city ? <div className="poster-city display">{p.city}</div> : null}
        <p className="poster-how">{p.how}</p>
        <button className="primary" onClick={onClose}>收下</button>
      </div>
    </div>
  )
}
