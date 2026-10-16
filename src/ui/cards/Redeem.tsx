import { useEffect, useRef, useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import CardFace from '../Card'
import { EGG_CARDS } from '../../engine/cards'

/**
 * 口令领卡, at the top of 账号 and at vctgames.com/cards#redeem: the code from
 * the owner's groups, checked by the server (redeem-codes.js), one card per
 * account. The page knows nothing about the code — only what it gives.
 */
export default function Redeem() {
  const { g, act, toast, cloud, version } = useCards()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const card = EGG_CARDS[0]
  const done = !!g.redeemed?.includes('lukxo-rewind')
  void version

  // the link from the group lands here
  useEffect(() => {
    if (window.location.hash === '#redeem') box.current?.scrollIntoView({ block: 'start' })
  }, [])

  const submit = async () => {
    const typed = code.trim()
    if (!typed) { toast('先输入口令。'); return }
    if (busy) return
    setBusy(true)
    const r = await act('redeem', { code: typed })
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    setCode('')
    toast(`领到了：${card?.ign ?? ''}「${card?.egg?.title ?? '彩蛋卡'}」，在收藏里。`)
  }

  if (!card) return null
  return <div ref={box} id="redeem">
    <Panel title="口令领卡">
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 120, flexShrink: 0 }}><CardFace card={card} size="sm" /></div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
            <b>彩蛋卡 · {card.egg?.title}</b>（{card.ign}，总评 {card.rating}）<br />
            口令在站长的微信群、抖音群里。输入正确就能领，每个账号一次。
          </p>
          {done
            ? <p className="small" style={{ margin: 0 }}>✓ 已领取，在收藏里。</p>
            : <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
                placeholder="输入口令"
                maxLength={40}
                autoComplete="off"
                style={{ flex: 1, minWidth: 160 }}
                aria-label="口令"
              />
              <button className="primary sm" disabled={busy || !cloud} onClick={() => void submit()}>
                {busy ? '领取中…' : '领取'}
              </button>
            </div>}
        </div>
      </div>
    </Panel>
  </div>
}
