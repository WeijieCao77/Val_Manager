/**
 * 赛事预测: Champions Shanghai's groups, picked before a map is played.
 *
 * Drawn the way a bracket site draws a group — the two opening matches, then
 * the winners' match and the elimination match, then the decider — so the
 * only thing to learn is where to click. A pick flows on by itself: the
 * opening winners fill the winners' match, their losers the elimination
 * match. Each group is saved as a whole and closes at the shared event deadline.
 */
import { useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { crestUrl } from '../../engine/dossier'
import {
  CHAMPIONS_2026, cleanPicks, isLocked, lockAt, picksOf, sides, standing, confirmedResult, predictionReward,
  playoffReady, playoffLocked, playoffPlayed, playoffFinal,
} from '../../engine/predict'
import {
  CHAMPIONS_2026_PLAYOFFS, PLAYOFF_KEY, cleanPlayoffPicks, playoffSides, playoffPlacing, playoffReward,
} from '../../engine/predictPlayoffs'
import type { PPicks, PSlot } from '../../engine/predictPlayoffs'
import type { Picks, PredictGroup, SlotKey } from '../../engine/predict'
import SharePrediction from './SharePrediction'
import { fetchPredictTop } from '../../engine/account'
import type { PredictBoard } from '../../engine/account'
import './predict.css'

const EV = CHAMPIONS_2026
const PO = CHAMPIONS_2026_PLAYOFFS

/** 「09/24 17:00」 in Beijing time, which is where the matches are played */
const bj = (ms: number): string => new Date(ms).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

export default function Predict() {
  const { now } = useCards()
  const [stage, setStage] = useState<'groups' | 'playoffs'>(() => playoffReady(PO, now) ? 'playoffs' : 'groups')
  return (
    <>
      <div className="seg board-seg" role="group" aria-label="看哪个阶段的预测">
        <button className={stage === 'groups' ? 'on' : ''} aria-pressed={stage === 'groups'} onClick={() => setStage('groups')}>小组赛</button>
        <button className={stage === 'playoffs' ? 'on' : ''} aria-pressed={stage === 'playoffs'} onClick={() => setStage('playoffs')}>淘汰赛</button>
      </div>
      {stage === 'groups' ? <GroupStage /> : <Playoffs />}
    </>
  )
}

function GroupStage() {
  const { g, now } = useCards()
  const [sharing, setSharing] = useState(false)
  const saved = EV.groups.reduce((n, gr) => n + Object.keys(picksOf(g, EV.id, gr.key)).length, 0)
  const settled = EV.groups.filter((gr) => confirmedResult(EV.id, gr, now)).map((gr) => gr.key)
  return (
    <>
      <Panel title={`赛事预测 · ${EV.name}`} actions={<span className="tiny muted">每组最高 2 个十连包</span>}>
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
          16 支队伍分 4 组，组内双败，全部 BO3。胜者组决赛赢的是小组第一，决胜局赢的是小组第二，
          这 8 队进淘汰赛胜者组；小组第三是 9–12 名，第四是 13–16 名。
        </p>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.8 }}>
          点队伍选谁赢，每组保存一次，所有小组统一于北京时间 2026 年 9 月 24 日 16:00 截止，此后不能修改。已保存 <b>{saved}</b> / 20 场，时间是北京时间。
        </p>
        <div className="row" style={{ marginTop: 12, gap: 10 }}>
          <button className="primary sm" disabled={!saved} onClick={() => setSharing(true)}>分享我的预测</button>
          <span className="tiny muted">分享卡仅展示已保存的预测</span>
        </div>
        <div className="pd-rewards" aria-label="小组预测奖励">
          <b>每组独立结算，只发最高一档，不叠加</b>
          <ul>
            <li>两支晋级队伍和第一、第二名全对：<b>2 个十连包</b></li>
            <li>其中一支晋级队伍和名次都对：<b>1 个十连包</b></li>
            <li>两支晋级队伍猜中，但名次颠倒：<b>5 个选拔包</b></li>
            <li>只猜中一支晋级队伍，名次不对：<b>3 个选拔包</b></li>
          </ul>
          <span>按你保存的小组第一、第二名结算，不要求每场胜负都猜对。赛果确认后，在对应小组领取，卡包直接入库。</span>
        </div>
      </Panel>
      {sharing && <SharePrediction onClose={() => setSharing(false)} />}
      {settled.length > 0 && <Board eventId={EV.id} done={`已结算 ${settled.join('、')} 组`}
        note={<>按已结算小组的每场胜负算，没预测的场次算猜错。猜对场次相同名次并列。{settled.length < EV.groups.length && <>
          {EV.groups.map((gr) => gr.key).filter((k) => !settled.includes(k)).join('、')} 组打完后加入。</>}</>} />}
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
  const displayed = locked ? cleanPicks(group, saved) : draft
  const s = sides(group, displayed)
  const st = standing(group, displayed)
  const dirty = JSON.stringify(draft) !== savedKey
  const result = confirmedResult(EV.id, group, now)
  const reward = result ? predictionReward(group, saved, result) : null
  const claimed = !!g.predict?.[EV.id]?.[group.key]?.claimedAt
  const rewardText = reward?.ten ? `${reward.ten} 个十连包` : reward?.elite ? `${reward.elite} 个选拔包` : '未猜中晋级队伍'
  const claim = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await act('predict_claim', { event: EV.id, group: group.key })
      toast(r.ok ? `${group.key} 组预测奖励已入库：${rewardText}` : r.why)
    } finally { setBusy(false) }
  }

  const pick = (k: SlotKey, tag: string) => {
    if (locked) return
    setDraft((d) => cleanPicks(group, { ...d, [k]: tag }))
  }
  const save = async () => {
    if (busy || locked) return
    setBusy(true)
    try {
      const r = await act('predict', { event: EV.id, group: group.key, picks: draft })
      toast(r.ok ? `${group.key} 组预测已保存。` : r.why)
    } finally { setBusy(false) }
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
          const won = !!tag && displayed[k] === tag
          const lost = !!tag && !!displayed[k] && displayed[k] !== tag
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
      actions={<span className="tiny muted">{locked ? '已截止，锁定' : `${bj(lockAt(group))} 锁定`}</span>}
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
      {locked && (
        <div className="pd-settlement">
          {result ? <>
            <span className="small">实际晋级：第一 {result.first} · 第二 {result.second}</span>
            <span className="small">{claimed ? '已领取：' : '本组奖励：'}{rewardText}</span>
            {!!(reward?.elite || reward?.ten) && <button className="primary sm" disabled={claimed || busy || !cloud} onClick={() => void claim()}>
              {claimed ? '奖励已领取' : busy ? '领取中…' : '领取预测奖励'}
            </button>}
            {!cloud && !claimed && <span className="tiny faint">联网后领取</span>}
          </> : <span className="small muted">预测已锁定，赛果确认后可在这里领取奖励。</span>}
        </div>
      )}
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

/**
 * 正确率排行: matches called right across what has been settled so far, out of
 * every match in it — an unpicked match counts as missed. Accounts level on
 * matches share a rank.
 */
function Board({ eventId, done, note }: { eventId: string; done: string; note: React.ReactNode }) {
  const [board, setBoard] = useState<PredictBoard | null | 'loading'>('loading')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let alive = true
    setBoard('loading')
    void fetchPredictTop(eventId).then((b) => { if (alive) setBoard(b) })
    return () => { alive = false }
  }, [eventId, done, tries])
  const pct = (r: { correct: number; total: number }) => r.total ? `${Math.round((r.correct / r.total) * 100)}%` : '—'
  return (
    <Panel title="正确率排行" actions={<span className="tiny muted">{done}</span>}>
      <p className="tiny muted" style={{ margin: '0 0 10px', lineHeight: 1.8 }}>{note}</p>
      {board === 'loading' && <p className="empty">读取中…</p>}
      {board === null && (
        <div className="cm-empty" role="status"><p>暂时读不到排行，请检查网络后重试。</p><button onClick={() => setTries((n) => n + 1)}>重新加载</button></div>
      )}
      {board && board !== 'loading' && (board.rows.length === 0 ? <p className="empty">还没有人上榜。</p> : <>
        <ol className="last-board">
          {board.rows.map((r, i) => (
            <li key={i} className={`last-row${r.me ? ' me' : ''}${r.rank <= 3 ? ` podium p${r.rank}` : ''}`}>
              <span className="last-rank mono" aria-label={`第 ${r.rank} 名`}>{r.rank}</span>
              <span className="last-who">
                <b>{r.name}</b>
                <span className="tiny faint mono"> #{r.tag}</span>
                {r.me && <span className="tag t1" style={{ marginLeft: 5 }}>我</span>}
              </span>
              <span className="last-div small">{pct(r)}</span>
              <span className="last-wl mono tiny muted">{r.correct}/{r.total}</span>
            </li>
          ))}
        </ol>
        <p className="small" style={{ margin: '10px 0 0' }}>
          {board.mine
            ? <>你第 <b>{board.mine.rank}</b> 名 · 猜对 {board.mine.correct}/{board.mine.total} 场 · 正确率 {pct(board.mine)}</>
            : <span className="muted">已结算的比赛里你没有预测。</span>}
          <span className="tiny faint"> · 共 {board.players} 人上榜</span>
        </p>
      </>)}
    </Panel>
  )
}

/** A team on a bracket button: crest, tag and full name, or 待定. */
function TeamCell({ tag }: { tag: string | null }) {
  if (!tag) return <span className="faint">待定</span>
  const t = EV.teams[tag]
  const crest = t ? crestUrl(t.clubId) : null
  return (
    <>
      {crest ? <img src={crest} alt="" /> : <i className="pd-nocrest" />}
      <b>{tag}</b>
      <span>{t?.name ?? ''}</span>
    </>
  )
}

const PO_COLS: { title: string; slots: PSlot[] }[][] = [
  [{ title: '胜者组八强', slots: ['q1', 'q2', 'q3', 'q4'] }, { title: '胜者组半决赛', slots: ['s1', 's2'] },
    { title: '胜者组决赛', slots: ['uf'] }, { title: '总决赛', slots: ['gf'] }],
  [{ title: '败者组第一轮', slots: ['l1a', 'l1b'] }, { title: '败者组第二轮', slots: ['l2a', 'l2b'] },
    { title: '败者组第三轮', slots: ['l3'] }, { title: '败者组决赛', slots: ['lf'] }],
]

/**
 * 淘汰赛: the eight qualifiers' double-elimination bracket, picked whole
 * before the first quarterfinal. Closed, but drawn, until the draw is known.
 */
function Playoffs() {
  const { g, act, toast, now, cloud } = useCards()
  const ready = playoffReady(PO, now)
  const locked = playoffLocked(PO, now)
  const row = g.predict?.[PO.id]?.[PLAYOFF_KEY]
  const savedKey = JSON.stringify(cleanPlayoffPicks(PO, row?.picks))
  const [draft, setDraft] = useState<PPicks>(() => JSON.parse(savedKey) as PPicks)
  useEffect(() => { setDraft(JSON.parse(savedKey) as PPicks) }, [savedKey])
  const [busy, setBusy] = useState(false)
  const displayed: PPicks = locked ? JSON.parse(savedKey) as PPicks : draft
  const s = playoffSides(PO, displayed)
  const place = playoffPlacing(PO, displayed)
  const dirty = JSON.stringify(draft) !== savedKey
  const played = playoffPlayed(PO, now)
  const final = playoffFinal(PO, now)
  const reward = final ? playoffReward(playoffPlacing(PO, JSON.parse(savedKey) as PPicks), final) : null
  const valid = !!row && row.at < PO.deadline
  const claimed = !!row?.claimedAt
  const rewardText = reward?.ten ? `${reward.ten} 个十连包` : reward?.elite ? `${reward.elite} 个选拔包` : '没有猜中决赛队伍'
  const count = Object.keys(JSON.parse(savedKey) as PPicks).length

  const pick = (k: PSlot, tag: string) => {
    if (locked || !ready) return
    setDraft((d) => cleanPlayoffPicks(PO, { ...d, [k]: tag }))
  }
  const save = async () => {
    if (busy || locked) return
    setBusy(true)
    try {
      const r = await act('predict', { event: PO.id, group: PLAYOFF_KEY, picks: draft })
      toast(r.ok ? '淘汰赛预测已保存。' : r.why)
    } finally { setBusy(false) }
  }
  const claim = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await act('predict_claim', { event: PO.id, group: PLAYOFF_KEY })
      toast(r.ok ? `淘汰赛预测奖励已入库：${rewardText}` : r.why)
    } finally { setBusy(false) }
  }

  const match = (k: PSlot) => {
    const [a, b] = s[k]
    const real = played?.[k]
    return (
      <div className="pd-match" key={k}>
        <div className="pd-when"><span>{bj(PO.at[k])}</span><span>BO{PO.bo[k]}</span></div>
        {[a, b].map((tag, i) => {
          const won = !!tag && displayed[k] === tag
          const lost = !!tag && !!displayed[k] && displayed[k] !== tag
          return (
            <button key={i} type="button"
              className={`pd-team${won ? ' won' : ''}${lost ? ' lost' : ''}${real && won ? (real === tag ? ' hit' : ' miss') : ''}`}
              disabled={locked || !ready || !a || !b} onClick={() => { if (tag) pick(k, tag) }}>
              <TeamCell tag={tag} />
            </button>
          )
        })}
        {real && <div className="pd-real">实际胜者 {real}</div>}
      </div>
    )
  }

  return (
    <>
      <Panel title={`赛事预测 · ${PO.name}`} actions={<span className="tiny muted">最高 3 个十连包</span>}>
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
          8 队双败淘汰，输两场出局。败者组决赛和总决赛 BO5，其余 BO3。胜者组八强对阵在小组赛结束后确定。
        </p>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.8 }}>
          {ready
            ? <>点队伍选谁赢，整张对阵一起保存，北京时间 10 月 7 日 16:00 截止，此后不能修改。已保存 <b>{count}</b> / 14 场。</>
            : <>小组赛 10 月 4 日打完、八强对阵确定后开放，北京时间 10 月 7 日 16:00 截止。</>}
        </p>
        <div className="pd-rewards" aria-label="淘汰赛预测奖励">
          <b>总决赛后结算，只发最高一档，不叠加</b>
          <ul>
            <li>冠军、亚军全对：<b>3 个十连包</b></li>
            <li>冠军猜对：<b>2 个十连包</b></li>
            <li>亚军猜对：<b>1 个十连包</b></li>
            <li>决赛两队都猜中，但冠亚颠倒：<b>5 个选拔包</b></li>
            <li>只猜中一支决赛队伍，名次不对：<b>3 个选拔包</b></li>
          </ul>
          <span>按你保存的冠军、亚军结算。总决赛结束、赛果确认后在这里领取，卡包直接入库。</span>
        </div>
      </Panel>
      {played && <Board eventId={PO.id} done={`已打 ${Object.keys(played).length} / 14 场`}
        note="按已打完的每场胜负算，没预测的场次算猜错。猜对场次相同名次并列。" />}
      <Panel title="淘汰赛对阵" actions={<span className="tiny muted">{locked ? '已截止，锁定' : ready ? `${bj(PO.deadline)} 锁定` : '未开放'}</span>}>
        {PO_COLS.map((row, i) => (
          <div key={i} className="pd-bracket po">
            {row.map((col) => (
              <div className="pd-col" key={col.title}>
                <div className="pd-col-title">{col.title}</div>
                {col.slots.map(match)}
              </div>
            ))}
          </div>
        ))}
        <div className="pd-result">
          <div><span className="pd-rank">冠军</span>{place.champion ?? '—'}</div>
          <div><span className="pd-rank">亚军</span>{place.runnerUp ?? '—'}</div>
          <div className="faint">季军 {place.third ?? '—'} · 殿军 {place.fourth ?? '—'}</div>
        </div>
        {locked && (
          <div className="pd-settlement">
            {final ? <>
              <span className="small">实际：冠军 {final.champion} · 亚军 {final.runnerUp}</span>
              {valid ? <>
                <span className="small">{claimed ? '已领取：' : '奖励：'}{rewardText}</span>
                {!!(reward?.elite || reward?.ten) && <button className="primary sm" disabled={claimed || busy || !cloud} onClick={() => void claim()}>
                  {claimed ? '奖励已领取' : busy ? '领取中…' : '领取预测奖励'}
                </button>}
              </> : <span className="small muted">你没有保存淘汰赛预测。</span>}
            </> : <span className="small muted">{valid ? '预测已锁定，总决赛赛果确认后可在这里领取奖励。' : '你没有保存淘汰赛预测。'}</span>}
          </div>
        )}
        {ready && !locked && (
          <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
            <button className="primary sm" disabled={!dirty || busy || !cloud} onClick={() => void save()}>保存淘汰赛预测</button>
            {dirty && <span className="tiny warn">还没保存</span>}
            {!cloud && <span className="tiny faint">联网才能保存</span>}
          </div>
        )}
      </Panel>
    </>
  )
}
