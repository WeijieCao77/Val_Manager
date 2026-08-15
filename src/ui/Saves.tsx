import { useState } from 'react'
import { useGame } from './ctx'
import { Panel } from './common'
import { deleteSave, exportSave, listSaves, saveGame } from '../engine/save'

export default function Saves() {
  const { game, toast } = useGame()
  const [slot, setSlot] = useState('')
  const [, setTick] = useState(0)
  const refresh = () => setTick((x) => x + 1)
  const saves = listSaves()

  const doSave = () => {
    const name = slot.trim() || `${game.teams[game.myTeam]?.name}-${game.year}`
    saveGame(name, game)
    setSlot('')
    refresh()
    toast(`已保存到「${name}」。`)
  }

  const doExport = () => {
    const blob = new Blob([exportSave(game)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `valmanager_${game.teams[game.myTeam]?.name}_${game.year}_D${game.day}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('存档已导出。')
  }

  return (
    <>
      <Panel title="保存进度">
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            value={slot} onChange={(e) => setSlot(e.target.value)}
            placeholder={`存档名（默认 ${game.teams[game.myTeam]?.name}-${game.year}）`}
            style={{ maxWidth: 320 }}
          />
          <button className="primary" onClick={doSave}>保存</button>
          <button onClick={doExport}>导出为文件</button>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0, marginTop: 10 }}>
          每次操作都会写入自动存档，重新打开页面即可继续。导出的文件可以在开始界面导入。
        </p>
      </Panel>

      <Panel title="已有存档" flush>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>存档</th><th>俱乐部</th><th>经理</th><th className="num">赛季</th><th className="num">天数</th><th>时间</th><th /></tr>
            </thead>
            <tbody>
              {saves.map((s) => (
                <tr key={s.slot}>
                  <td><b>{s.slot === 'autosave' ? '自动存档' : s.slot}</b></td>
                  <td>{s.team}</td>
                  <td className="muted">{s.manager}</td>
                  <td className="num">{s.year}</td>
                  <td className="num mono">{s.day}</td>
                  <td className="small muted">{new Date(s.savedAt).toLocaleString('zh-CN')}</td>
                  <td>
                    <button
                      className="sm ghost"
                      onClick={() => {
                        if (window.confirm(`删除存档「${s.slot}」？`)) {
                          deleteSave(s.slot)
                          refresh()
                          toast('存档已删除。')
                        }
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!saves.length && <div className="empty">还没有存档。</div>}
        </div>
        <p className="tiny muted" style={{ padding: '10px 13px', margin: 0 }}>
          读取存档请刷新页面后在开始界面选择。
        </p>
      </Panel>

      <Panel title="荣誉室" flush>
        <div className="table-wrap">
          <table>
            <thead><tr><th className="num">赛季</th><th>荣誉</th></tr></thead>
            <tbody>
              {game.honours.slice().reverse().map((h, i) => (
                <tr key={i}><td className="num mono">{h.year}</td><td>🏆 {h.title}</td></tr>
              ))}
            </tbody>
          </table>
          {!game.honours.length && <div className="empty">还没有拿到冠军。</div>}
        </div>
      </Panel>
    </>
  )
}
