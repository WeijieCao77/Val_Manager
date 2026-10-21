import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { MementoData } from './model'
import { renderMemento } from './render'
import './memento.css'
const CardSelection = lazy(() => import('./CardSelection'))

export default function Memento({ getData }: { getData: () => MementoData }) {
  const [data, setData] = useState<MementoData | null>(null)
  return <>
    <button className="sm memento-trigger" onClick={() => setData(getData())}>生成纪念图</button>
    {data && <MementoDialog data={data} onClose={() => setData(null)} />}
  </>
}

function MementoDialog({ data: initialData, onClose }: { data: MementoData; onClose: () => void }) {
  const [data, setData] = useState(initialData)
  const selectionReady = data.kind !== 'cards' || data.selectedCardIds?.length === 5
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(data.name.slice(0, 40))
  const [message, setMessage] = useState(data.kind === 'manager' ? '属于我们的时代，永不散场。' : '开过的每一包，都算数。')
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [date] = useState(() => new Date().toLocaleDateString('zh-CN').split('/').join('.'))
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const d = dialog.current
    if (d && typeof d.showModal === 'function') d.showModal()
    else d?.setAttribute('open', '')
    return () => { previous?.focus() }
  }, [])
  useEffect(() => {
    let active = true
    setImage(''); setError('')
    if (!selectionReady) return
    const timer = window.setTimeout(async () => {
      try {
        await document.fonts.ready
        if (!active) return
        let exportData = data
        if (data.kind === 'cards') {
          const selected = (data.selectedCardIds ?? []).map(id => data.collection?.find(item => item.card.id === id))
          if (selected.length !== 5 || selected.some(item => !item)) throw new Error('请选择五张已拥有的卡。')
          const { captureCards } = await import('./captureCards')
          const cardImages = await captureCards(selected.filter(item => !!item))
          if (!active) return
          exportData = { ...data, cardImages }
        }
        const canvas = await renderMemento(exportData, name, message, date)
        const url = canvas.toDataURL('image/png')
        if (url === 'data:,') throw new Error('图片生成失败，请重试。')
        if (active) setImage(url)
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '图片生成失败，请重试。') }
    }, 160)
    return () => { active = false; window.clearTimeout(timer) }
  }, [data, name, message, date, revision, selectionReady])
  const fileName = `${data.mode}-纪念图-${date}.png`
  return <dialog ref={dialog} className={`memento-dialog memento-${data.kind}`} aria-labelledby="memento-title" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose() }}>
    <div className="memento-layout">
      <div className="memento-preview" aria-busy={!image && !error}>
        {image ? <img src={image} alt={`${name || data.name}的${data.mode}纪念图，包含个人记录、当前阵容和留言`} /> : <p role="status">{error || (!selectionReady ? '从收藏中选好五张卡，这里会显示你的分享图。' : '正在绘制你的纪念图…')}</p>}
      </div>
      <div className="memento-controls">
        <div className="memento-heading"><h2 id="memento-title">{data.kind === 'manager' ? '执教生涯纪念' : '开瓦包收藏纪念'}</h2><button className="ghost sm" onClick={onClose} aria-label="关闭纪念图">关闭</button></div>
        <p>{data.kind === 'manager' ? '定格你的首发五人，留下这支战队的名字。' : '从自己的收藏中挑选五张选手卡，用原版卡面制作分享海报。'}</p>
        {data.kind === 'cards' && <Suspense fallback={<p>正在载入收藏…</p>}><CardSelection data={data} onChange={setData} /></Suspense>}
        <label>纪念图署名<input autoFocus value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
        <label>海报留言<textarea value={message} maxLength={60} rows={3} onChange={e => setMessage(e.target.value)} /><span className="memento-count">{message.length}/60</span></label>
        <p className="memento-note">{data.kind === 'manager' ? '使用当前存档的记录与阵容。你可以回到游戏调整阵容，再重新生成。' : '仅选择你已拥有的卡；只用于分享，不会改变上场阵容或消耗卡片。'}</p>
        {image ? <a className="memento-save" href={image} download={fileName}>保存高清纪念图</a> : <button disabled>{selectionReady ? '等待图片生成' : '请先选满五张卡'}</button>}
        {error && <div role="alert"><p>{error}</p><button onClick={() => setRevision(n => n + 1)}>重新生成</button></div>}
        <p className="memento-note">1080 × 1440 PNG。手机可长按预览图片保存。保存后，停服也能随时查看。</p>
        <details className="memento-record"><summary>查看图片中的游戏记录</summary><p>{data.journey}</p><ul>{data.stats.map(s => <li key={s.label}>{s.label}：{s.value}</li>)}</ul><p>{data.kind === 'cards' ? '分享选卡' : '阵容'}：{data.lineup.join('、') || '尚未设置'}{data.coach ? `；教练：${data.coach}` : ''}</p><p>{data.memory}</p></details>
      </div>
    </div>
  </dialog>
}
