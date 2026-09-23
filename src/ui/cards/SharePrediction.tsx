import { useEffect, useRef, useState } from 'react'
import { CHAMPIONS_2026 as EV, cleanPicks, picksOf, standing, SLOTS } from '../../engine/predict'
import { useCards } from './ctx'

/** Render saved picks without account identifiers or external image dependencies. */
export default function SharePrediction({ onClose }: { onClose: () => void }) {
  const { g, toast } = useCards()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [png, setPng] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const name = g.name || '玩家'
  const snapshot = JSON.stringify(EV.groups.map(group => cleanPicks(group, picksOf(g, EV.id, group.key))))
  useEffect(() => {
    try {
      const el = canvas.current!
      el.width = 1080
      el.height = 1420
      const ctx = el.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable')
      const picks = JSON.parse(snapshot)
      ctx.fillStyle = '#101b21'
      ctx.fillRect(0, 0, 1080, 1420)
      const text = (value: string, x: number, y: number, size: number, color = '#eaf2f3', bold = false, width = 950) => {
        ctx.fillStyle = color
        ctx.font = `${bold ? '700' : '400'} ${size}px system-ui, sans-serif`
        ctx.fillText(value, x, y, width)
      }
      text('开瓦包 / CHAMPIONS 2026', 64, 86, 25, '#75e0bd', true)
      text('上海冠军赛 · 我的预测', 64, 163, 54, '#ffffff', true)
      text(name.slice(0, 32), 64, 219, 28, '#bfccd1')
      let count = 0
      EV.groups.forEach((group, index) => {
        const p = cleanPicks(group, picks[index])
        count += Object.keys(p).length
        const st = standing(group, p)
        const y = 270 + index * 245
        ctx.fillStyle = '#1b2b33'
        ctx.fillRect(48, y, 984, 221)
        text(`${group.key} 组`, 76, y + 44, 30, '#75e0bd', true)
        text(`第一  ${st.first ?? '未预测'}`, 245, y + 44, 31, '#ffffff', true, 340)
        text(`第二  ${st.second ?? '未预测'}`, 630, y + 44, 31, '#ffffff', true, 340)
        text(`第三  ${st.third ?? '未预测'}    /    第四  ${st.fourth ?? '未预测'}`, 245, y + 91, 25, '#bfccd1')
        text('每场胜者', 76, y + 140, 22, '#93a9b3')
        const labels = ['首轮①', '首轮②', '胜者决赛', '败者首轮', '决胜局']
        SLOTS.forEach((slot, i) => {
          text(labels[i], 245 + i * 148, y + 140, 20, '#93a9b3')
          text(p[slot] ?? '未预测', 245 + i * 148, y + 182, 25, '#eaf2f3', true, 136)
        })
      })
      text(`已保存 ${count}/20 场 · 仅展示已保存预测`, 64, 1295, 24, '#bfccd1')
      text('统一截止：2026/09/24 16:00（北京时间）', 64, 1340, 23, '#bfccd1')
      text('vctgames.com · 来开瓦包，分享你的晋级名单', 64, 1383, 23, '#75e0bd')
      setPng(el.toDataURL('image/png'))
      setFailed(false)
    } catch { setPng(''); setFailed(true) }
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
    a.download = '开瓦包-2026上海冠军赛预测.png'
    a.click()
  }
  const share = async () => {
    if (busy || !png) return
    setBusy(true)
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.current!.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Image unavailable')
      const file = new File([blob], '上海冠军赛预测.png', { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: '我的上海冠军赛预测' })
      } else {
        download()
        toast('分享图片已下载，也可长按图片保存后发送。')
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) toast('分享未成功，请保存图片后发送。')
    } finally { setBusy(false) }
  }

  return <div className="modal-bg" onClick={onClose}>
    <div className="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="pd-share-title" onClick={e => e.stopPropagation()}>
      <div className="modal-head">
        <h2 id="pd-share-title">分享我的预测</h2><div className="spacer" />
        <button className="ghost sm" autoFocus onClick={onClose}>关闭</button>
      </div>
      <div className="modal-body">
        <p className="small muted">仅展示已保存的预测，未保存的修改不会出现在卡片中。</p>
        <canvas ref={canvas} hidden />
        {failed ? <p role="alert">图片生成失败，请关闭后重试。</p> : png
          ? <img className="share-png" src={png} alt="我的上海冠军赛预测：四组名次与每场预测胜者" />
          : <p>正在生成分享卡…</p>}
        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="primary" disabled={!png || busy} onClick={() => void share()}>{busy ? '分享中…' : '分享图片'}</button>
          <button disabled={!png} onClick={download}>保存图片</button>
        </div>
        <p className="tiny muted">手机可长按图片保存，再发送给好友或群聊。</p>
      </div>
    </div>
  </div>
}
