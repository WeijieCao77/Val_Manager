/**
 * The 信箱, as a thing you can open.
 *
 * Everything the trading post owes and everything the owner hands out arrives
 * through one server-side inbox, and the client has always collected it on
 * boot and applied it in one step. What it never had was a place to read it:
 * a toast said 「已处理」 for three seconds and that was the whole of the
 * mailbox the changelog had announced. The group went looking for a tab.
 *
 * This is the button in the top bar — unread count on it — and the list
 * behind it: what came, when, and the note it came with. Opening it also
 * collects, so mail that arrived while the page was open does not wait for
 * a reload.
 */
import { useEffect, useState } from 'react'
import { useCards } from './ctx'
import { mailLine, unreadMail } from '../../engine/market'
import type { MailItem } from '../../engine/market'

const when = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function MailBox() {
  const { g, cloud, act, toast } = useCards()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const unread = unreadMail(g)
  const list = g.mail ?? []

  // the server applies a delivery to the account and hands the account back
  const collect = async () => {
    if (!cloud || busy) return
    setBusy(true)
    const r = await act('mail_take')
    setBusy(false)
    if (!r.ok) { toast(r.why); return }
    const got = ((r.result as { mail?: MailItem[] } | undefined)?.mail ?? [])
    if (got.length) {
      toast(got.length === 1 ? `${mailLine(got[0])}。已收下。` : `信箱收到 ${got.length} 条，已收下。`)
    }
  }

  useEffect(() => {
    if (!open) return
    // reading is what marks it read — not the arrival, and not the toast
    if (unreadMail(g) > 0 && cloud) void act('mail_seen')
    void collect()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <div
        className={`chip mail-chip${unread ? ' own' : ''}`}
        role="button" tabIndex={0}
        title="交易区的成交、退款，以及官方发放的东西，都在这里"
        onClick={() => setOpen((x) => !x)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((x) => !x) } }}
      >
        ✉ 信箱{unread > 0 && <b style={{ color: 'var(--accent)' }}>{' '}{unread}</b>}
      </div>

      {open && (
        <>
          <div className="support-veil" onClick={() => setOpen(false)} />
          <div className="support-card mail-card" role="dialog" aria-label="信箱">
            <div className="support-head">
              <h3>信箱</h3>
              <button className="sm ghost" disabled={!cloud || busy} onClick={() => void collect()}>
                {busy ? '收取中…' : '收取'}
              </button>
              <button className="sm ghost" onClick={() => setOpen(false)}>关闭 ✕</button>
            </div>
            <p className="small muted" style={{ lineHeight: 1.8 }}>
              交易区的成交、退款、被拒的报价，和<b>官方发放的卡包、金币、卡</b>都从这里进来。
              打开卡池时自动收下并记在这里；东西已经到账，这里是给你看一眼的。
            </p>
            {!cloud && (
              <p className="small" style={{ color: 'var(--warn)' }}>服务器连不上，信箱暂时收不了。</p>
            )}
            {list.length === 0 ? (
              <div className="empty">还没有收到过东西。</div>
            ) : (
              <div className="mail-list">
                {list.map((m, i) => (
                  <div key={`${m.at}-${i}`} className={`mail-item${m.kind === 'grant' ? ' grant' : ''}`}>
                    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                      <span className="tiny faint mono">{when(m.at)}</span>
                      {m.kind === 'grant' && (
                        <span className="tag" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>官方</span>
                      )}
                    </div>
                    <div className="small" style={{ marginTop: 2 }}>{m.text}</div>
                    {m.note && <div className="small muted" style={{ marginTop: 2 }}>附言：{m.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
