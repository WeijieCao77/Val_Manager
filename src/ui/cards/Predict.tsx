/**
 * 赛事预测: Champions Shanghai's groups, picked before a map is played.
 *
 * Drawn the way a bracket site draws a group — the two opening matches, then
 * the winners' match and the elimination match, then the decider — so the
 * only thing to learn is where to click. A pick flows on by itself: the
 * opening winners fill the winners' match, their losers the elimination
 * match. Each group is saved as a whole and closes when its first match starts.
 */
import { useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { crestUrl } from '../../engine/dossier'
import {
  CHAMPIONS_2026, cleanPicks, isLocked, lockAt, picksOf, sides, standing,
} from '../../engine/predict'
import type { Picks, PredictGroup, SlotKey } from '../../engine/predict'
import './predict.css'

const EV = CHAMPIONS_2026

/** 「09/24 17:00」 in Beijing time, which is where the matches are played */
const bj = (ms: number): string => new Date(ms).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

export default function Predict() {
  const { g } = useCards()
  const saved = EV.groups.reduce((n, gr) => n + Object.keys(picksOf(g, EV.id, gr.key)).length, 0)
  return (
    <>
      <Panel title={`赛事预测 · ${EV.name}`} actions={<span className="tiny muted">奖励未定</span>}>
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
          16 支队伍分 4 组，组内双败，全部 BO3。胜者组决赛赢的是小组第一，决胜局赢的是小组第二，
          这 8 队进淘汰赛胜者组；小组第三是 9–12 名，第四是 13–16 名。
        </p>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.8 }}>
          点队伍选谁赢，每组保存一次，这组第一场开赛前都能改。已保存 <b>{saved}</b> / 20 场，时间是北京时间。
        </p>
      </Panel>
      <div className="pd-groups">
        {EV.groups.map((gr) => <Group key={gr.key} group={gr} />)}
      </div>
    </>
  )
}

function Group({ group }: { group: PredictGroup }) {
  const { g, act, toast, now, cloud } = useCards()
  const saved = picksOf(g, EV.id, group.key)
  const savedKey = JSON.stringify(cleanPicks(group, saved))
  const [draft, setDraft] = useState<Picks>(() => cleanPicks(group, saved))
  // what the server holds is what the board starts from, whenever it changes
  useEffect(() => { setDraft(JSON.parse(savedKey) as Picks) }, [savedKey])
  const [busy, setBusy] = useState(false)
  const locked = isLocked(group, now)
  const s = sides(group, draft)
  const st = standing(group, draft)
  const dirty = JSON.stringify(draft) !== savedKey

  const pick = (k: SlotKey, tag: string) => {
    if (locked) return
    setDraft((d) => cleanPicks(group, { ...d, [k]: tag }))
  }
  const save = async () => {
    setBusy(true)
    const r = await act('predict', { event: EV.id, group: group.key, picks: draft })
    setBusy(false)
    toast(r.ok ? `${group.key} 组预测已保存。` : r.why)
  }

  const team = (tag: string | null) => {
    if (!tag) return <span className="faint">待定</span>
    const t = EV.teams[tag]
    const crest = crestUrl(t.clubId)
    return (
      <>
        {crest ? <img src={crest} alt="" /> : <i className="pd-nocrest" />}
        <b>{tag}</b>
        <span>{t.name}</span>
      </>
    )
  }

  const match = (k: SlotKey) => {
    const [a, b] = s[k]
    const ready = !!a && !!b
    return (
      <div className="pd-match">
        <div className="pd-when"><span>{bj(group.at[k])}</span><span>BO3</span></div>
        {[a, b].map((tag, i) => {
          const won = !!tag && draft[k] === tag
          const lost = !!tag && !!draft[k] && draft[k] !== tag
          return (
            <button
              key={i}
              type="button"
              className={`pd-team${won ? ' won' : ''}${lost ? ' lost' : ''}`}
              disabled={locked || !ready}
              onClick={() => { if (tag) pick(k, tag) }}
            >
              {team(tag)}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <Panel
      title={`${group.key} 组`}
      actions={<span className="tiny muted">{locked ? '已开赛，锁定' : `${bj(lockAt(group))} 锁定`}</span>}
    >
      <div className="pd-bracket">
        <div className="pd-col">
          <div className="pd-col-title">首轮</div>
          {match('o1')}
          {match('o2')}
        </div>
        <div className="pd-col">
          <div className="pd-col-title">胜者组决赛</div>
          {match('w')}
          <div className="pd-col-title">败者组首轮</div>
          {match('e')}
        </div>
        <div className="pd-col">
          <div className="pd-col-title">决胜局</div>
          {match('d')}
          <div className="pd-result">
            <div><span className="pd-rank">第一</span>{st.first ?? '—'}</div>
            <div><span className="pd-rank">第二</span>{st.second ?? '—'}</div>
            <div className="faint">第三 {st.third ?? '—'} · 第四 {st.fourth ?? '—'}</div>
          </div>
        </div>
      </div>
      {!locked && (
        <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button className="primary sm" disabled={!dirty || busy || !cloud} onClick={() => void save()}>
            保存 {group.key} 组
          </button>
          {dirty && <span className="tiny warn">还没保存</span>}
          {!cloud && <span className="tiny faint">联网才能保存</span>}
        </div>
      )}
    </Panel>
  )
}
