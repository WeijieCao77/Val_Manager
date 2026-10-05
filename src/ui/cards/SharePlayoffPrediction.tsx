import { useEffect, useRef, useState } from 'react'
import { CHAMPIONS_2026_PLAYOFFS as PO, PLAYOFF_KEY, cleanPlayoffPicks } from '../../engine/predictPlayoffs'
import { useCards } from './ctx'
import { paintPlayoffShare } from './sharePlayoff'

/** 「北京时间 10/06 16:00」 */
const bj = (ms: number) => new Date(ms).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

/**
 * 分享我的淘汰赛预测: the saved bracket as a 1080 × 1350 picture (sharePlayoff.ts),
 * with the system share sheet where the phone has one and a download where it
 * does not. Nothing on it identifies the account but the name the player chose.
 */
export default function SharePlayoffPrediction({ onClose }: { onClose: () => void }) {
  const { g, toast } = useCards()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [png, setPng] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const name = g.name || '玩家'
  const snapshot = JSON.stringify(cleanPlayoffPicks(PO, g.predict?.[PO.id]?.[PLAYOFF_KEY]?.picks))

  useEffect(() => {
    let live = true
    setPng('')
    paintPlayoffShare(canvas.current!, { name: name.slice(0, 24), event: PO, picks: JSON.parse(snapshot), deadline: bj(PO.deadline) })
      .then(() => { if (live) { setPng(canvas.current!.toDataURL('image/png')); setFailed(false) } })
      .catch(() => { if (live) { setPng(''); setFailed(true) } })
    return () => { live = false }
  }, [name, snapshot])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close); previous?.focus() }
  }, [onClose])

  const download = () => {
    const a = document.createElement('a')
    a.href = png
    a.download = '开瓦包-2026上海冠军赛淘汰赛预测.png'
    a.click()
  }
  const share = async () => {
    if (busy || !png) return
    setBusy(true)
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.current!.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Image unavailable')
      const file = new File([blob], '上海冠军赛淘汰赛预测.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '我的上海冠军赛淘汰赛预测' })
      } else {
        download()
        toast('分享图片已下载，也可长按图片保存后发送。')
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) toast('分享未成功，请保存图片后发送。')
    } finally { setBusy(false) }
  }

  return <div className="modal-bg" onClick={onClose}>
    <div className="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="po-share-title" onClick={e => e.stopPropagation()}>
      <div className="modal-head">
        <h2 id="po-share-title">分享我的淘汰赛预测</h2><div className="spacer" />
        <button className="ghost sm" autoFocus onClick={onClose}>关闭</button>
      </div>
      <div className="modal-body">
        <p className="small muted">只展示已保存的预测，没保存的改动不会出现在图里。</p>
        <canvas ref={canvas} hidden />
        {failed ? <p role="alert">图片生成失败，请关闭后重试。</p> : png
          ? <img className="share-png" src={png} alt="我的上海冠军赛淘汰赛预测：冠军、名次和十四场的预测胜者" />
          : <p>正在生成分享图…</p>}
        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="primary" disabled={!png || busy} onClick={() => void share()}>{busy ? '分享中…' : '分享图片'}</button>
          <button disabled={!png} onClick={download}>保存图片</button>
        </div>
        <p className="tiny muted">手机可长按图片保存，再发给好友或群聊。</p>
      </div>
    </div>
  </div>
}
