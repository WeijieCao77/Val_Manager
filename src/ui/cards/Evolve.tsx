/**
 * 进修: a +5 player card, one attribute, five spare copies eaten (engine/evolve.ts has the rules and the why).
 *
 * Three steps on one page — the card, the attribute, the five — and the numbers the choice turns on shown where
 * the choice is made: what a point of each attribute is worth to THIS card's position, and what the five chosen so
 * far would buy. Nothing is spent until the sheet at the end names every card going.
 */
import { useEffect, useMemo, useState } from 'react'
import { useCards, EVO_TARGET } from './ctx'
import CardFace from '../Card'
import { Panel } from '../common'
import { useDialogFocus } from './useDialogFocus'
import { collection, playLevelOf } from '../../engine/gacha'
import {
  EVO_FEED, EVO_GAIN, EVO_HIGH, EVO_STEPS, cleanEvo, evoAttrs, evoPreview, evoWorth, feedReason,
} from '../../engine/evolve'
import type { AttrKey, Evo } from '../../engine/evolve'
import { MAX_LEVEL, POWER_PER_POINT, RARITY_CN, cardById, cardName, cardPower, isPlayerCard } from '../../engine/cards'
import type { PlayerCard } from '../../engine/cards'
import { ATTR_CN, ATTR_KEYS } from '../../engine/types'

const coin = (n: number) => Math.round(n).toLocaleString('en-US')
/** 战力 one point of this attribute adds to this card */
const powerPer = (card: PlayerCard, k: AttrKey) => evoWorth(card, k) * POWER_PER_POINT

export default function Evolve() {
  const { g, version, act, toast, go } = useCards()
  // 卡牌详情's 去进修 leaves the card here; read once, cleared after (not in the initializer: StrictMode runs it twice)
  const [target, setTarget] = useState<string | null>(() => {
    try { return sessionStorage.getItem(EVO_TARGET) } catch { return null }
  })
  useEffect(() => { try { sessionStorage.removeItem(EVO_TARGET) } catch { /* nothing kept */ } }, [])
  const [attr, setAttr] = useState<AttrKey | null>(null)
  const [feed, setFeed] = useState<string[]>([])
  const [only, setOnly] = useState<'all' | 'role' | 'attr'>('all')
  const [shown, setShown] = useState(60)
  const [asking, setAsking] = useState(false)
  const [washing, setWashing] = useState(false)
  const [busy, setBusy] = useState(false)

  const mine = useMemo(() => collection(g), [g, version])
  const maxed = useMemo(() => mine.filter((x) => isPlayerCard(x.card) && x.owned.level >= MAX_LEVEL), [mine])
  const card = target ? cardById(target) : undefined
  const owned = target ? g.cards[target] : undefined
  const sel = isPlayerCard(card) && owned && owned.level >= MAX_LEVEL ? card : null
  const evo = owned ? cleanEvo(owned.evo) : undefined
  const full = (evo?.n ?? 0) >= EVO_STEPS

  // every spare copy that could go in, best at the attribute first
  const materials = useMemo(() => {
    if (!sel || !attr) return []
    return mine
      .filter((x) => isPlayerCard(x.card) && x.owned.dupes > 0)
      .map((x) => ({ card: x.card as PlayerCard, dupes: x.owned.dupes, why: feedReason(sel, attr, x.card as PlayerCard) }))
      .filter((x) => x.why)
      .sort((a, b) => b.card.attrs[attr] - a.card.attrs[attr] || a.card.rating - b.card.rating)
  }, [mine, sel, attr])
  const listed = materials.filter((m) => only === 'all' || m.why === only)
  const used = (id: string) => feed.filter((x) => x === id).length

  const preview = sel && attr && feed.length === EVO_FEED ? evoPreview(g, sel.id, attr, feed) : null
  const avg = attr && feed.length ? feed.reduce((s, id) => s + ((cardById(id) as PlayerCard | undefined)?.attrs[attr] ?? 0), 0) / feed.length : 0

  const pick = (id: string | null) => { setTarget(id); setAttr(null); setFeed([]); setShown(60) }
  const add = (id: string, dupes: number) => {
    if (feed.length >= EVO_FEED) { toast(`已经放满 ${EVO_FEED} 张，点上面的卡可以拿下来。`); return }
    if (used(id) >= dupes) return
    setFeed([...feed, id])
  }
  const removeAt = (i: number) => setFeed(feed.filter((_, k) => k !== i))
  // The cheapest five that still buy the most this attribute has room for: the weakest copies that clear the
  // tier, never a 彩卡 — a player hands those over one by one or not at all.
  const autofill = () => {
    if (!sel || !attr) return
    const copies = materials
      .filter((m) => m.card.rarity !== 'mythic')
      .flatMap((m) => Array.from({ length: m.dupes }, () => m.card))
      .sort((a, b) => a.attrs[attr] - b.attrs[attr] || a.rating - b.rating)
    const room = 99 - evoAttrs(sel, evo)[attr]
    const want = Math.min(EVO_GAIN[0].gain, room)
    // tiers from the smallest gain up: the first that reaches `want` with five copies, else the best there is
    const tiers = [...EVO_GAIN].reverse()
    const fits = (at: number) => copies.filter((c) => c.attrs[attr] >= at).slice(0, EVO_FEED)
    const tier = tiers.find((t) => t.gain >= want && fits(t.at).length === EVO_FEED)
      ?? [...EVO_GAIN].find((t) => fits(t.at).length === EVO_FEED)
    const out = tier ? fits(tier.at).map((c) => c.id) : copies.slice(0, EVO_FEED).map((c) => c.id)
    if (out.length < EVO_FEED) toast(`能用的重复卡不够 ${EVO_FEED} 张（彩卡要自己点）。`)
    setFeed(out)
  }

  const run = async () => {
    if (!sel || !attr) return
    setBusy(true)
    const r = await act('evolve', { cardId: sel.id, attr, feed })
    setBusy(false)
    setAsking(false)
    if (!r.ok) { toast(r.why); return }
    const gain = (r.result as { gain: number }).gain
    toast(`进修完成：${sel.ign} ${ATTR_CN[attr]} +${gain}，战力 +${coin(gain * powerPer(sel, attr))}。`)
    setFeed([])
  }

  // 洗掉进修: back to a plain +5 with all five 进修 free again; the cards it ate stay eaten
  const wash = async () => {
    if (!sel) return
    setBusy(true)
    const r = await act('evo_wash', { cardId: sel.id })
    setBusy(false)
    setWashing(false)
    if (!r.ok) { toast(r.why); return }
    toast(`${sel.ign} 的进修已洗掉，可以重新进修。`)
    setAttr(null)
    setFeed([])
  }

  if (!sel) {
    return (
      <Panel title="选一张满级卡">
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.75 }}>
          选手卡升到 <b>+{MAX_LEVEL}</b> 以后还能<b>进修</b>：挑一项能力，喂 <b>{EVO_FEED} 张重复卡</b>，这项能力 <b>+1～+3</b>，
          战力跟着涨。每张卡最多进修 <b>{EVO_STEPS} 次</b>。喂进去的卡会被吃掉。
        </p>
        {maxed.length === 0 ? (
          <div className="cm-empty" role="status">
            <p>还没有 +{MAX_LEVEL} 的选手卡。升满以后回来。</p>
            <button onClick={() => go('collection')}>去收藏</button>
          </div>
        ) : (
          <div className="cm-grid">
            {maxed.map(({ card: c, owned: o }) => {
              const e = cleanEvo(o.evo)
              return (
                <CardFace
                  key={c.id}
                  card={c}
                  level={playLevelOf(g, c.id)}
                  onClick={() => pick(c.id)}
                  footer={e ? `进修 ${e.n}/${EVO_STEPS}` : '未进修'}
                />
              )
            })}
          </div>
        )}
      </Panel>
    )
  }

  const attrs = evoAttrs(sel, evo)
  const top = [...ATTR_KEYS].sort((a, b) => evoWorth(sel, b) - evoWorth(sel, a)).slice(0, 3)

  return (
    <>
      <Panel
        title={`进修 · ${sel.ign}`}
        actions={
          <>
            {evo && <button className="sm" onClick={() => setWashing(true)} disabled={busy}>洗掉进修</button>}
            <button className="sm" onClick={() => pick(null)}>换一张</button>
          </>
        }
      >
        <div className="row evo-head" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <CardFace card={sel} level={playLevelOf(g, sel.id)} size="lg" />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="small" style={{ marginBottom: 6 }}>
              {sel.roles.join(' / ')} · 战力 <b>{coin(cardPower(sel, playLevelOf(g, sel.id)))}</b>
              <span className="faint"> · 进修 {evo?.n ?? 0}/{EVO_STEPS}</span>
            </div>
            <p className="tiny muted" style={{ margin: '0 0 10px', lineHeight: 1.7 }}>
              {full
                ? `这张卡已经进修满 ${EVO_STEPS} 次。`
                : <>选一项能力。<b>{sel.role}</b>最看重的能力，每点加的战力最多。</>}
            </p>
            <div className="evo-attrs" role="radiogroup" aria-label="进修哪一项能力">
              {ATTR_KEYS.map((k) => {
                const capped = attrs[k] >= 99
                return (
                  <button
                    key={k}
                    role="radio"
                    aria-checked={attr === k}
                    className={`evo-attr${attr === k ? ' on' : ''}`}
                    disabled={full || capped}
                    onClick={() => { setAttr(k); setFeed([]); setShown(60) }}
                  >
                    <span className="evo-attr-name">
                      {ATTR_CN[k]}
                      {top.includes(k) && <i className="evo-key">看重</i>}
                    </span>
                    <b className="mono">
                      {attrs[k]}
                      {!!evo?.add[k] && <small style={{ color: 'var(--win)' }}> ↑{evo.add[k]}</small>}
                    </b>
                    <span className="tiny faint">{capped ? '已满' : `每点战力 +${coin(powerPer(sel, k))}`}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Panel>

      {attr && !full && (
        <Panel title={`放 ${EVO_FEED} 张卡 · ${ATTR_CN[attr]}`}>
          <p className="tiny muted" style={{ marginTop: 0, lineHeight: 1.7 }}>
            只用<b>重复卡</b>，收藏里那张不会动。能放的卡：<b>同位置</b>（{sel.roles.join(' / ')}），或<b>{ATTR_CN[attr]} {EVO_HIGH} 以上</b>。
            五张的{ATTR_CN[attr]}平均 {EVO_GAIN[1].at} 起 +{EVO_GAIN[1].gain}，{EVO_GAIN[0].at} 起 +{EVO_GAIN[0].gain}，否则 +{EVO_GAIN[2].gain}。
          </p>

          <div className="cm-squad evo-tray">
            {Array.from({ length: EVO_FEED }, (_, i) => {
              const id = feed[i]
              const c = id ? cardById(id) : undefined
              return c ? (
                <CardFace key={i} card={c} size="sm" onClick={() => removeAt(i)} footer={`${ATTR_CN[attr]} ${(c as PlayerCard).attrs[attr]} · 拿下`} />
              ) : (
                <div key={i} className="evo-slot" aria-label={`第 ${i + 1} 个空位`}>{i + 1}</div>
              )
            })}
          </div>

          <div className="row wrap evo-sum" style={{ gap: 8, alignItems: 'center', marginTop: 12 }}>
            <span className="small">
              {feed.length
                ? <>已放 {feed.length}/{EVO_FEED} · {ATTR_CN[attr]}平均 <b>{Math.round(avg)}</b></>
                : `还没放卡`}
              {preview?.ok && (
                <> → <b style={{ color: 'var(--win)' }}>{ATTR_CN[attr]} +{preview.gain}</b>，战力 +{coin(preview.rating * POWER_PER_POINT)}</>
              )}
            </span>
            <div className="spacer" />
            <button className="sm" onClick={autofill} disabled={!materials.length}>自动放入</button>
            {feed.length > 0 && <button className="sm" onClick={() => setFeed([])}>清空</button>}
            <button
              className="primary sm"
              disabled={!preview?.ok || busy}
              title={preview && !preview.ok ? preview.why : undefined}
              onClick={() => setAsking(true)}
            >
              进修
            </button>
          </div>
          {preview && !preview.ok && <p className="tiny" style={{ color: 'var(--loss)' }}>{preview.why}</p>}

          <div className="row wrap" style={{ gap: 6, margin: '16px 0 10px', alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="材料筛选">
              <button className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>全部 {materials.length}</button>
              <button className={only === 'role' ? 'on' : ''} onClick={() => setOnly('role')}>同位置</button>
              <button className={only === 'attr' ? 'on' : ''} onClick={() => setOnly('attr')}>{ATTR_CN[attr]}高</button>
            </div>
            <span className="tiny faint">点一下放一张，同一张卡有几张重复就能放几次</span>
          </div>

          {listed.length === 0 ? (
            <div className="cm-empty" role="status"><p>没有能放的重复卡。多开几包，或者换一项能力。</p></div>
          ) : (
            <div className="cm-grid sm">
              {listed.slice(0, shown).map((m) => {
                const left = m.dupes - used(m.card.id)
                return (
                  <CardFace
                    key={m.card.id}
                    card={m.card}
                    size="sm"
                    dimmed={left <= 0}
                    onClick={left > 0 ? () => add(m.card.id, m.dupes) : undefined}
                    footer={`${ATTR_CN[attr]} ${m.card.attrs[attr]} · ${m.why === 'role' ? '同位置' : '能力高'} · 余 ${left}`}
                  />
                )
              })}
            </div>
          )}
          {listed.length > shown && (
            <div className="cm-pagination">
              <button onClick={() => setShown(shown + 60)}>再显示 60 张（共 {listed.length}）</button>
            </div>
          )}
        </Panel>
      )}

      {asking && attr && preview?.ok && (
        <EvoConfirm
          sel={sel}
          attr={attr}
          feed={feed}
          from={attrs[attr]}
          gain={preview.gain}
          power={preview.rating * POWER_PER_POINT}
          busy={busy}
          onConfirm={() => void run()}
          onClose={() => { if (!busy) setAsking(false) }}
        />
      )}

      {washing && evo && (
        <WashConfirm
          sel={sel}
          evo={evo}
          busy={busy}
          onConfirm={() => void wash()}
          onClose={() => { if (!busy) setWashing(false) }}
        />
      )}
    </>
  )
}

/** What washing takes off, said before anything happens: the cards fed in do not come back. */
function WashConfirm({ sel, evo, busy, onConfirm, onClose }: {
  sel: PlayerCard; evo: Evo; busy: boolean; onConfirm: () => void; onClose: () => void
}) {
  const dialogRef = useDialogFocus(() => { if (!busy) onClose() })
  const adds = ATTR_KEYS.filter((k) => evo.add[k]).map((k) => `${ATTR_CN[k]} +${evo.add[k]}`)
  return (
    <div className="modal-bg" style={{ zIndex: 70 }} onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="确认洗掉进修" tabIndex={-1} className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>洗掉进修</h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose}>关闭</button>
        </div>
        <div className="modal-body">
          <p className="small" style={{ marginTop: 0, lineHeight: 1.7 }}>
            <b>{sel.ign}</b> 的 {evo.n} 次进修（{adds.join('，')}）全部清掉，回到普通 +{MAX_LEVEL}，可以重新进修 {EVO_STEPS} 次。
          </p>
          <p className="tiny" style={{ color: 'var(--loss)' }}>进修吃掉的卡不会退回。</p>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <div className="spacer" />
            <button className="sm" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary sm" onClick={onConfirm} disabled={busy}>{busy ? '洗掉中…' : '确认洗掉'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Every card going, and what it buys — nothing is eaten before this is pressed. */
function EvoConfirm({ sel, attr, feed, from, gain, power, busy, onConfirm, onClose }: {
  sel: PlayerCard; attr: AttrKey; feed: string[]; from: number; gain: number; power: number
  busy: boolean; onConfirm: () => void; onClose: () => void
}) {
  const dialogRef = useDialogFocus(() => { if (!busy) onClose() })
  const lines = [...new Set(feed)].map((id) => ({ card: cardById(id)!, n: feed.filter((x) => x === id).length }))
  const mythic = lines.some((l) => l.card.rarity === 'mythic')
  return (
    <div className="modal-bg" style={{ zIndex: 70 }} onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="确认进修" tabIndex={-1} className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>确认进修</h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose}>关闭</button>
        </div>
        <div className="modal-body">
          <p className="small" style={{ marginTop: 0 }}>
            <b>{sel.ign}</b> {ATTR_CN[attr]} {from} → <b style={{ color: 'var(--win)' }}>{Math.min(99, from + gain)}</b>，战力 +{coin(power)}
          </p>
          <p className="tiny faint">下面 {EVO_FEED} 张重复卡会被吃掉，换不回来。{mythic && <b style={{ color: 'var(--loss)' }}>里面有彩卡。</b>}</p>
          <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table>
              <tbody>
                {lines.map(({ card: c, n }) => (
                  <tr key={c.id}>
                    <td><span className={`tag r-${c.rarity}`}>{RARITY_CN[c.rarity]}</span></td>
                    <td><b>{cardName(c)}</b>{isPlayerCard(c) && c.legend ? <span className="tiny muted"> {c.legend.title}</span> : c.clubTag ? <span className="tiny muted"> {c.clubTag}</span> : null}</td>
                    <td className="right mono">{isPlayerCard(c) ? `${ATTR_CN[attr]} ${c.attrs[attr]}` : ''}</td>
                    <td className="right mono">×{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <div className="spacer" />
            <button className="sm" onClick={onClose} disabled={busy}>取消</button>
            <button className="primary sm" onClick={onConfirm} disabled={busy}>{busy ? '进修中…' : '确认进修'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
