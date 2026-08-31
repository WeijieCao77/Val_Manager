import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { collectionProgress } from '../../engine/gacha'
import { DIVISIONS, MASTER_DIV, masterTitle } from '../../engine/gacha'

/** Copy that works on http:// and on the browsers without a clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* fall through */ }
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch { return false }
}

export default function Account({ onSignOut }: { onSignOut: () => void }) {
  const { g, cloud, toast, commit } = useCards()
  const [reveal, setReveal] = useState(false)
  const [name, setName] = useState(g.name)
  const prog = collectionProgress(g)

  return (
    <>
      <Panel title="账号">
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
          这个 ID 就是你的账号，没有密码，也没有找回方式。
          <b style={{ color: 'var(--warn)' }}>请立刻截图或复制保存</b>——丢了就再也进不来了。
          换设备时用这串 ID 登录，收藏和段位都会跟着走。
        </p>

        <div className="acct-id" style={{ filter: reveal ? 'none' : 'blur(7px)' }}>
          {g.id}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="sm" onClick={() => setReveal((v) => !v)}>
            {reveal ? '隐藏' : '显示 ID'}
          </button>
          <button
            className="primary sm"
            onClick={async () => {
              setReveal(true)
              toast(await copyText(g.id) ? 'ID 已复制，找个地方存好。' : '复制失败，请手动选中复制。')
            }}
          >
            复制 ID
          </button>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 14, alignItems: 'center' }}>
          <span className="tiny faint">昵称</span>
          <input
            style={{ width: 160 }}
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { g.name = name.trim().slice(0, 20) || '经理'; commit(true) }}
          />
          <span className={`tag ${cloud ? 't1' : 't2'}`} title={cloud ? '收藏已同步到服务器' : '服务器连不上，只存在这台设备里'}>
            {cloud ? '云端同步中' : '仅本机'}
          </span>
        </div>
        {!cloud && (
          <p className="tiny warn" style={{ marginTop: 8 }}>
            现在连不上服务器，进度只写在这个浏览器里，签到日期也用的是本机时间。恢复连接后会自动上传。
          </p>
        )}
      </Panel>

      <Panel title="战绩">
        <div className="grid c4">
          <Stat label="收集" value={`${prog.owned}/${prog.total}`} />
          <Stat label="抽卡次数" value={String(g.pulls)} />
          <Stat label="天梯" value={`${g.ladder.wins}–${g.ladder.losses}`} />
          <Stat label="最高段位" value={g.ladder.div >= MASTER_DIV || g.ladder.best >= MASTER_DIV
            ? `${masterTitle(g.ladder.bestPoints ?? 0)} ${g.ladder.bestPoints ?? 0}`
            : DIVISIONS[g.ladder.best]} />
        </div>
      </Panel>

      <Panel title="最近发生了什么">
        {g.log.length === 0 ? (
          <p className="empty">还没开始。</p>
        ) : (
          <div className="grid" style={{ gap: 0 }}>
            {g.log.slice(0, 25).map((l, i) => (
              <div key={i} className="small" style={{ padding: '5px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <span className="tiny faint mono" style={{ marginRight: 8 }}>
                  {l.at.slice(5, 10)} {l.at.slice(11, 16)}
                </span>
                {l.text}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="退出">
        <p className="small muted" style={{ marginTop: 0 }}>
          退出后这台设备不再记住你的 ID。确认已经保存好再退。
        </p>
        <button
          onClick={() => {
            if (confirm('确认退出？没有保存 ID 的话就找不回来了。')) onSignOut()
          }}
        >
          退出登录
        </button>
      </Panel>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="tiny faint">{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700 }}>{value}</div>
    </div>
  )
}
