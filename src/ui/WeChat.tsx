/**
 * The way into the group, on the page people land on.
 *
 * Almost everything in this game came out of that group — the bugs, the
 * balance complaints, half the features — and until now the only way in was
 * knowing somebody who was already in it.
 *
 * The QR is fetched, not bundled: WeChat's group codes expire after seven days
 * (the image says so on its own bottom line), so one checked into the repo
 * would be wrong more often than right. It lives in the database and the owner
 * swaps it from the admin page, which is a Monday job rather than a deploy.
 *
 * The button only appears once the server says there is a code to show, so a
 * week where nobody has uploaded one is a week with no button, rather than a
 * button that opens an empty box.
 */
import { useEffect, useState } from 'react'

interface Group { on: boolean; note: string | null; v: number }

export default function WeChat() {
  const [group, setGroup] = useState<Group | null>(null)
  const [open, setOpen] = useState(false)
  const [broke, setBroke] = useState(false)

  useEffect(() => {
    let alive = true
    void fetch('/api/site/wechat')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Group | null) => { if (alive && j?.on) setGroup(j) })
      .catch(() => { /* offline, or served from a static host with no server */ })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!group) return null

  return (
    <>
      <button
        className={`support-fab wechat-fab${open ? ' on' : ''}`}
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        title="扫码进微信群"
      >
        <span className="ico" aria-hidden="true">💬</span>
        <span className="lbl">微信群</span>
      </button>

      {open && (
        <>
          <div className="support-veil" onClick={() => setOpen(false)} />
          <div className="support-card" role="dialog" aria-label="微信群">
            <div className="support-head">
              <h3>进群一起玩</h3>
              <button className="sm ghost" onClick={() => setOpen(false)}>关闭 ✕</button>
            </div>
            <p className="small muted" style={{ margin: 0, lineHeight: 1.8 }}>
              这个游戏大部分改动都来自群里的反馈——bug、平衡、想加的功能。
              有问题、有想法，或者只是想找人打好友房，都可以进来说。
            </p>
            {broke ? (
              // the server only turns the button on when there IS a code, so
              // this is a network failure rather than a missing picture — and
              // a blank white box would look like the group had closed
              <p className="empty" style={{ padding: '30px 10px' }}>二维码没加载出来，刷新一下试试。</p>
            ) : (
              <img
                className="wechat-qr"
                /* `v` is the moment it was last uploaded: the image is cached
                   hard, and this is what makes a new code show up immediately */
                src={`/api/site/wechat.img?v=${group.v}`}
                alt="微信群二维码"
                width={300}
                height={300}
                onError={() => setBroke(true)}
              />
            )}
            <p className="tiny faint" style={{ margin: 0, textAlign: 'center', lineHeight: 1.7 }}>
              {group.note || '微信扫码进群。群二维码七天一换，扫不进就过两天再来看看。'}
            </p>
          </div>
        </>
      )}
    </>
  )
}
