/**
 * 分享阵容 — the five as a picture, with the way back printed on it.
 *
 * The picture is drawn on a canvas here rather than screenshotted: a
 * screenshot carries whichever theme the sender happens to use, the browser
 * chrome, and no link. See shareCard.ts for the drawing.
 *
 * Three ways out, because they are three different platforms:
 *   - a phone saves it by long-pressing the image, which is why the image is
 *     shown full size rather than as a button that downloads something
 *   - 保存图片 is the desktop path, an <a download> off a blob
 *   - 分享 hands it to the system sheet where there is one (iOS, Android),
 *     which is the only route into WeChat and 小红书 that does not go through
 *     the camera roll first
 */
import { useEffect, useRef, useState } from 'react'
import { useCards } from './ctx'
import { paintShare, SHARE_URL } from './shareCard'
import { myCode } from '../../engine/account'
import { levelOf } from '../../engine/gacha'
import { chemistry, squadRating } from '../../engine/cards'

export default function ShareSquad({ onClose }: { onClose: () => void }) {
  const { g, toast } = useCards()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [png, setPng] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const filled = g.squad.slots.filter(Boolean).length

  useEffect(() => {
    let alive = true
    const el = canvas.current
    if (!el) return
    void paintShare(el, {
      squad: g.squad,
      level: (id) => levelOf(g, id),
      // the 对战码's first four, exactly what the leaderboard prints. NEVER
      // any part of the account id: the id is the whole of the login here,
      // and this picture is made to be posted in a group chat.
      who: { name: g.name || '无名经理', tag: (myCode() ?? '').slice(0, 4).toUpperCase() || undefined },
      rating: squadRating(g.squad, (id) => levelOf(g, id)),
      chem: chemistry(g.squad).score,
    })
      .then(() => { if (alive) setPng(el.toDataURL('image/png')) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [g])

  // toBlob hands the blob to its callback and RETURNS undefined, so the old
  // `canvas.current?.toBlob(cb) ?? resolve(null)` took the fallback on every
  // call and resolved null before the callback ever ran: 保存图片 and 分享
  // always answered 「图片还没画好，稍等一下」 however long you waited.
  // "Not painted yet" is `png`, which the paint effect sets when it is done.
  const blob = async (): Promise<Blob | null> => {
    const el = canvas.current
    if (!el || !png) return null
    return new Promise((resolve) => el.toBlob((b) => resolve(b), 'image/png'))
  }

  const save = async () => {
    const b = await blob()
    if (!b) { toast('图片还没画好，稍等一下。'); return }
    const url = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = url
    a.download = `开瓦包-${g.name || '阵容'}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const share = async () => {
    const b = await blob()
    if (!b) { toast('图片还没画好，稍等一下。'); return }
    const file = new File([b], '开瓦包阵容.png', { type: 'image/png' })
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: '我的开瓦包阵容', url: SHARE_URL })
        return
      } catch { /* the sheet was dismissed; nothing to say about that */ }
    }
    void save()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>分享阵容</h2>
          <div className="spacer" />
          <button className="ghost sm" onClick={onClose}>关闭</button>
        </div>
        <div className="modal-body">
          {filled < 5 && (
            <p className="small warn" style={{ marginTop: 0 }}>
              还差 {5 - filled} 个人，空位也会画进去。
            </p>
          )}
          <canvas ref={canvas} style={{ display: 'none' }} />
          {failed ? (
            <p className="empty">图片没画出来，刷新一下再试。</p>
          ) : png ? (
            <img className="share-png" src={png} alt="我的阵容" />
          ) : (
            <p className="empty">正在画…</p>
          )}
          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            <button className="primary" onClick={share} disabled={!png}>分享</button>
            <button onClick={save} disabled={!png}>保存图片</button>
          </div>
          <p className="tiny faint" style={{ marginBottom: 0, marginTop: 8 }}>
            手机长按图片即可保存到相册。图上的二维码扫开就是 vctgames.com。
          </p>
        </div>
      </div>
    </div>
  )
}
