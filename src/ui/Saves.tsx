import { useState } from 'react'
import { ask } from './confirm'
import { useGame } from './ctx'
import { Panel } from './common'
import { deleteSave, exportSave, listSaves, saveGame } from '../engine/save'
import ThemeToggle from './ThemeToggle'

export default function Saves() {
  const { game, toast, startTutorial, loadSlot, commit } = useGame()
  const [slot, setSlot] = useState('')
  const [, setTick] = useState(0)
  const refresh = () => setTick((x) => x + 1)
  const saves = listSaves()

  const doSave = () => {
    const name = slot.trim() || `${game.teams[game.myTeam]?.name}-${game.year}`
    try {
      saveGame(name, game)
      setSlot('')
      refresh()
      toast(`已保存到「${name}」。`)
    } catch {
      // a thrown write used to look identical to success minus the toast
      toast('⚠ 保存失败，浏览器存储写不进去。先「导出为文件」保住进度。')
    }
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
      {/* The one setting that is about the screen rather than the save. It
          lives here because this is the screen the game already calls 系统,
          and it is what somebody the black page made dizzy will go looking
          for. The top bar has the same switch in a smaller coat. */}
      <Panel title="界面配色">
        <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
          <ThemeToggle />
          <span className="small muted" style={{ flex: '1 1 260px' }}>
            黑底看着晕就换<b>浅色</b>或<b>米色</b>。只记在这台设备上，不跟存档走。
          </span>
        </div>
      </Panel>

      <Panel title="新手引导">
        <p className="small muted" style={{ marginTop: 0 }}>
          用<b>模拟的一天</b>把训练、问价、推进走一遍，期间做的事结束后全部撤销，不影响存档。
        </p>
        <button className="sm" onClick={() => {
          // reloading dropped the in-memory save and dumped you on the new-career
          // screen; the tutorial reopens in place instead
          try { localStorage.removeItem('valmgr.tutorial') } catch { /* ignore */ }
          startTutorial()
        }}>重新播放引导</button>
      </Panel>

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
          每次操作都会自动存档。导出的文件可以在开始界面导入。
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
                  <td className="sticky-act">
                    <div className="row" style={{ gap: 6 }}>
                      {/* the one verb this screen was missing: a slot could be
                          written and deleted but never opened */}
                      <button className="sm" onClick={async () => {
                        if (await ask(`读取「${s.slot === 'autosave' ? '自动存档' : s.slot}」？当前未保存的进度会被它替换。`)) {
                          loadSlot(s.slot)
                        }
                      }}>
                        读取
                      </button>
                      <button
                        className="sm ghost"
                        onClick={async () => {
                          if (await ask(`删除存档「${s.slot}」？`, '删除')) {
                            deleteSave(s.slot)
                            refresh()
                            toast('存档已删除。')
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!saves.length && <div className="empty">还没有存档。</div>}
        </div>
        <p className="tiny muted" style={{ padding: '10px 13px', margin: 0 }}>
          开始界面也能读取手动存档。
        </p>
      </Panel>

      <Panel title="规则">
        <label className="row small" style={{ gap: 8, cursor: 'pointer', alignItems: 'flex-start' }}>
          <input type="checkbox" checked={!!game.importLimit} style={{ width: 16, marginTop: 2 }}
            onChange={(e) => {
              game.importLimit = e.target.checked
              commit()
              toast(e.target.checked
                ? '已开启外援限制：每队最多两名外区选手，AI 同样受限，只限新引进。'
                : '已关闭外援限制。')
            }} />
          <span>
            <b>限制外援</b>
            <span className="muted"> — 每支俱乐部最多两名外区选手。只影响之后的签人，已有阵容不动。</span>
          </span>
        </label>
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
      <p className="tiny faint" style={{ textAlign: 'center', marginTop: 20 }}>
        战队与选手数据取自 vlr.gg 与 Liquipedia，均为真实人物。
      </p>
    </>
  )
}
