import { useState } from 'react'
import { useCards } from './ctx'
import { Panel } from '../common'
import { collectionProgress } from '../../engine/gacha'
import { DIVISIONS, MASTER_DIV, masterTitle } from '../../engine/gacha'
import { Thanks } from '../Credit'
import PhoneGate from './PhoneGate'

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
  const { g, cloud, phone, bound, toast, commit } = useCards()
  const [reveal, setReveal] = useState(false)
  const [name, setName] = useState(g.name)
  const prog = collectionProgress(g)

  return (
    <>
      <Panel title="账号">
        <p className="small muted" style={{ marginTop: 0, lineHeight: 1.8 }}>
          这个 ID 就是你的账号，没有密码，丢了找不回来。
          <b style={{ color: 'var(--warn)' }}>请截图或复制保存</b>，换设备用它登录。
        </p>

        <div className="acct-id" style={{ filter: reveal ? 'none' : 'blur(7px)' }}>
          {g.id}
        </div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          {phone ? <>已绑手机 尾号 <b>{phone}</b>。换设备可以在入口点「用手机号进入」，不用记 ID。</> : '还没绑手机。绑上以后换设备不用记 ID，用手机号就能进来。'}
        </p>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="sm" onClick={() => setReveal((v) => !v)}>
            {reveal ? '隐藏' : '显示 ID'}
          </button>
          <button
            className="primary sm"
            onClick={async () => {
              setReveal(true)
              toast(await copyText(g.id) ? 'ID 已复制，记得存好。' : '复制失败，请手动选中复制。')
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
            连不上服务器，进度只存在本机，联网后自动上传。
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

      <Panel title="最近动态">
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

      {!phone && (
        <Panel title="绑定手机">
          <PhoneGate id={g.id} onBound={(last4) => { bound(last4); toast(`绑好了，尾号 ${last4}。`) }} onSignOut={() => {}} backLabel="" embedded />
        </Panel>
      )}

      <Panel title="退出">
        <p className="small muted" style={{ marginTop: 0 }}>
          退出后本机不再记住 ID，确认已保存再退。
        </p>
        <button
          onClick={() => {
            if (confirm('确认退出？没存 ID 就找不回来了。')) onSignOut()
          }}
        >
          退出登录
        </button>
      </Panel>
      <Thanks />
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
