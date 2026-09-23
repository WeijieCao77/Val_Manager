import { useEffect, useState } from 'react'
import { useCards } from './ctx'
import { Modal } from '../common'
import { clearPreset, levelOf, loadPreset, presetsOf, renamePreset, savePreset } from '../../engine/gacha'
import { squadPower } from '../../engine/cards'
import type { Squad } from '../../engine/cards'

const signature = (s: Squad) => JSON.stringify([s.slots, s.coach ?? null])

/** Saved decks stay separate from the working squad until the user saves. */
export default function SquadPresets() {
  const { g, commit, toast } = useCards()
  const presets = presetsOf(g)
  const selectionKey = `valmanager:card:editing-preset:${g.id}`
  const [selected, setSelected] = useState<number | null>(() => {
    try {
      const stored = sessionStorage.getItem(selectionKey)
      const slot = stored === null ? -1 : Number(stored)
      if (Number.isInteger(slot) && slot >= 0 && presets[slot]) return slot
    } catch { /* Storage is optional; the current squad still persists normally. */ }
    const match = presets.findIndex(p => p && signature(p.squad) === signature(g.squad))
    return match < 0 ? null : match
  })
  useEffect(() => {
    try {
      if (selected === null) sessionStorage.removeItem(selectionKey)
      else sessionStorage.setItem(selectionKey, String(selected))
    } catch { /* Private browsing can disable storage. */ }
  }, [selected, selectionKey])
  const active = selected === null ? null : presets[selected]
  const dirty = active ? signature(active.squad) !== signature(g.squad) : g.squad.slots.some(Boolean) || !!g.squad.coach
  const [switchTo, setSwitchTo] = useState<number | null>(null)
  const [saveTo, setSaveTo] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [rename, setRename] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
  const empty = presets.findIndex(p => !p)
  const store = (slot: number, label?: string) => {
    const rec = savePreset(g, slot, label?.trim() || undefined)
    setSelected(slot)
    commit(true)
    toast(`当前阵容已保存到「${rec.name}」。`)
  }
  const load = (slot: number) => {
    const result = loadPreset(g, slot)
    if (!result.ok) return
    setSelected(slot)
    setSwitchTo(null)
    commit(true)
    toast(result.missing ? `已切换，${result.missing} 张卡不可用，请补齐空位。` : `已切换到「${presets[slot]!.name}」。`)
  }
  const choose = (slot: number) => {
    if (!presets[slot]) { setSaveTo(slot); setName(`配置 ${slot + 1}`); return }
    if (slot === selected) return
    if (dirty) setSwitchTo(slot)
    else load(slot)
  }
  return <section className="cm-deck-manager" aria-label="卡组配置">
    <div className="cm-deck-slots" role="group" aria-label="切换卡组配置">
      {presets.map((rec, i) => <button key={i} title={rec?.name ?? `空配置 ${i + 1}`} className={`cm-deck-slot${selected === i ? ' active' : ''}`} aria-pressed={selected === i} onClick={() => choose(i)} aria-label={rec ? `切换到配置 ${i + 1}：${rec.name}` : `保存到空配置 ${i + 1}`}>
        <span className="cm-deck-number">{i + 1}</span><b>{rec?.name ?? '空配置'}</b><small>{rec ? `${rec.squad.slots.filter(Boolean).length}/5 人${rec.squad.coach ? ' · 教练' : ''}` : '＋ 保存当前'}</small>
        {rec && <small className="cm-deck-power mono">战力 {squadPower(rec.squad, id => levelOf(g, id)).toLocaleString('en-US')}</small>}
      </button>)}
    </div>
    <div className="cm-deck-toolbar">
      <div className="cm-deck-status" role="status"><strong>{active?.name ?? '当前阵容'}</strong><span>{active ? dirty ? '有修改，尚未保存到配置' : '与已保存配置一致' : '尚未关联保存配置'}</span></div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="primary sm" disabled={!!active && !dirty} onClick={() => { if (selected !== null && active) store(selected); else { setCopying(true); setName('') } }}>{active ? '保存修改' : '保存阵容'}</button>
        <button className="sm" onClick={() => { setCopying(true); setName('') }}>另存为…</button>
        {active && <details className="cm-deck-manage"><summary>管理</summary><div className="row wrap" style={{ gap: 8 }}><button className="sm" onClick={() => { setName(active.name); setRename(true) }}>重命名</button><button className="sm" onClick={() => setDeleting(true)}>删除配置</button></div></details>}
      </div>
    </div>
    {switchTo !== null && <Modal title="切换前保存修改？" onClose={() => setSwitchTo(null)}>
      <p>当前阵容有尚未保存到配置的修改。即将切换到「{presets[switchTo]?.name}」。</p>
      <div className="row wrap" style={{ gap: 10 }}>
        {(active || empty >= 0) && <button className="primary" onClick={() => { const next = switchTo; store(active && selected !== null ? selected : empty); load(next) }}>保存后切换</button>}
        <button onClick={() => load(switchTo)}>放弃修改并切换</button><button onClick={() => setSwitchTo(null)}>继续编辑</button>
      </div>
      {!active && empty < 0 && <p className="small muted">五个配置都已占用。如需保留当前阵容，请继续编辑并使用“另存为”选择覆盖位置。</p>}
    </Modal>}
    {copying && <Modal title="保存阵容到配置" onClose={() => setCopying(false)}>
      <p className="small muted">选择保存位置。当前五人阵容和教练都会一起保存。</p>
      <div className="cm-save-destinations">{presets.map((p, i) => <button key={i} onClick={() => { setCopying(false); setSaveTo(i); setName(p?.name ?? `配置 ${i + 1}`) }}><b>{i + 1} · {p?.name ?? '空配置'}</b><span>{p ? '选择后确认覆盖' : '保存为新配置'}</span></button>)}</div>
    </Modal>}
    {saveTo !== null && <Modal title={presets[saveTo] ? '确认覆盖配置' : '保存新配置'} onClose={() => setSaveTo(null)}>
      <form onSubmit={e => { e.preventDefault(); store(saveTo, name); setSaveTo(null) }}>
        {presets[saveTo] && <p>将用当前阵容替换「{presets[saveTo]!.name}」中保存的五人和教练。</p>}
        <label className="cm-field-label" htmlFor="deck-name">配置名称</label><input id="deck-name" value={name} onChange={e => setName(e.target.value)} maxLength={12} required placeholder="例如：公开赛主力" />
        <div className="row wrap" style={{ gap: 10, marginTop: 20 }}><button className="primary" type="submit">{presets[saveTo] ? '确认覆盖并保存' : '保存配置'}</button><button type="button" onClick={() => setSaveTo(null)}>取消</button></div>
      </form>
    </Modal>}
    {rename && active && selected !== null && <Modal title="重命名配置" onClose={() => setRename(false)}><form onSubmit={e => { e.preventDefault(); renamePreset(g, selected, name.trim()); commit(true); setRename(false) }}><label className="cm-field-label" htmlFor="rename-deck">配置名称</label><input id="rename-deck" maxLength={12} required value={name} onChange={e => setName(e.target.value)} /><button className="primary" style={{ marginLeft: 8 }} type="submit">保存名称</button></form></Modal>}
    {deleting && active && selected !== null && <Modal title="删除保存配置？" onClose={() => setDeleting(false)}><p>删除「{active.name}」的保存记录。当前上阵选手和收藏里的卡牌都会保留。</p><div className="row wrap" style={{ gap: 10 }}><button onClick={() => { clearPreset(g, selected); setSelected(null); commit(true); setDeleting(false); toast('保存配置已删除，当前阵容保留。') }}>确认删除配置</button><button className="primary" onClick={() => setDeleting(false)}>保留配置</button></div></Modal>}
  </section>
}
