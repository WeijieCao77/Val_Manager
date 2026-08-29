/**
 * The site account, in one place both games can send you to.
 *
 * The id was only ever mintable inside 开瓦包, which meant somebody who played
 * nothing but the manager could never get one — their endings and achievements
 * sat under the anonymous `local` bucket forever, and the front page told them
 * 「尚未创建」 with nothing to click. This is that missing screen.
 *
 * It is the same account either game uses: `createAccount` here mints exactly
 * what the card mode's own sign-up mints, and signing in here signs you in
 * there. Nothing about the card mode's flow is duplicated or replaced — this
 * calls the same three functions in engine/account.ts.
 *
 * The id is the entire password. That is stated on the screen that hands it
 * over, because a player who finds out later is a player who lost something,
 * and it is masked everywhere else so a screenshot of a front page is not a
 * screenshot of an account.
 */
import { useEffect, useState } from 'react'
import { createAccount, loadAccount, rememberId, rememberedId } from '../engine/account'
import { claimLocal, readProfile, syncProfile } from '../engine/profile'

export const maskId = (id: string): string =>
  `${id.slice(0, 7)}-••••-${id.slice(-4)}`

export default function Account(
  { onClose, onChange }: { onClose: () => void; onChange?: (id: string | null) => void },
) {
  const [id, setId] = useState<string | null>(() => rememberedId())
  const [name, setName] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [madeNow, setMadeNow] = useState(false)
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const settle = (next: string) => {
    setId(next)
    // Anything earned before there was an account belongs to it now.
    claimLocal(next)
    void syncProfile(next)
    onChange?.(next)
  }

  const create = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await createAccount(name)
      setMadeNow(true)
      setShown(true)          // you cannot write down what you cannot see
      settle(r.state.id)
      if (!r.cloud) {
        setErr('服务器暂时连不上，账号先建在这台设备上了，联网后会自动同步。')
      }
    } catch {
      setErr('创建失败，稍后再试一次。')
    } finally {
      setBusy(false)
    }
  }

  const signIn = async () => {
    setBusy(true)
    setErr(null)
    const r = await loadAccount(typed)
    setBusy(false)
    if (r.ok) {
      rememberId(r.state.id)
      setMadeNow(false)
      settle(r.state.id)
      setTyped('')
    } else {
      // the same three sentences the card mode's own sign-in gives
      setErr({
        bad: 'ID 格式不对——应该是 VM- 开头、后面五组四位。',
        missing: '没有这个 ID 的记录。检查一下有没有抄错。',
        offline: '连不上服务器，而且这台设备上也没有这个账号的备份。',
      }[r.reason])
    }
  }

  const copy = async () => {
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setShown(true)          // no clipboard permission: at least put it on screen
    }
  }

  const profile = readProfile(id)

  return (
    <>
      <div className="support-veil" onClick={onClose} />
      <div className="support-card acct-card" role="dialog" aria-label="账号">
        <div className="support-head">
          <h3>{id ? '你的账号' : '创建账号'}</h3>
          <button className="sm ghost" onClick={onClose}>关闭 ✕</button>
        </div>

        {id ? (
          <>
            {madeNow && (
              <p className="small" style={{ color: 'var(--warn)', margin: 0, lineHeight: 1.9 }}>
                ⚠️ <b>现在就把它截图存下来。</b>没有邮箱也没有密码找回——
                这串字符就是账号本身，丢了就找不回来了。
              </p>
            )}
            <div className="acct-id">
              <b className="mono">{shown ? id : maskId(id)}</b>
              <button className="sm ghost" onClick={() => setShown((v) => !v)}>
                {shown ? '隐藏' : '显示'}
              </button>
              <button className="sm ghost" onClick={copy}>{copied ? '已复制' : '复制'}</button>
            </div>
            <p className="tiny faint" style={{ margin: 0, lineHeight: 1.8 }}>
              VCT电竞经理和开瓦包共用这一个账号。成就、结局、生涯数据和卡牌收藏都记在它上面，
              换手机时在这里填进去就能全部找回。<b>相当于账号密码，不要发给别人。</b>
            </p>

            <div className="acct-mine">
              <span>结局 <b>{profile.endings.length}</b></span>
              <span>成就 <b>{profile.achievements.length}</b></span>
              <span>执教生涯 <b>{profile.record.careers}</b> 段</span>
            </div>
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0, lineHeight: 1.9 }}>
              不用邮箱，也不用密码。点一下就会给你一串 ID，
              <b>它同时是开瓦包的账号</b>——成就、结局和卡牌收藏都记在上面，换设备靠它找回。
            </p>
            <div className="acct-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="给自己起个名字（可留空）"
                maxLength={20}
              />
              <button className="primary" onClick={create} disabled={busy}>
                {busy ? '创建中…' : '创建一个 ID'}
              </button>
            </div>
          </>
        )}

        <div className="acct-sep">{id ? '换一个账号' : '已经有 ID 了？'}</div>
        <div className="acct-row">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="VM-XXXX-XXXX-XXXX-XXXX-XXXX"
            spellCheck={false}
            className="mono"
          />
          <button className="sm" onClick={signIn} disabled={busy || !typed.trim()}>
            {busy ? '…' : '登录'}
          </button>
        </div>
        {err && <p className="small" style={{ color: 'var(--accent)', margin: 0 }}>{err}</p>}
        <p className="tiny faint" style={{ margin: 0 }}>
          O 和 0、I 和 1 会自动纠正，抄错这几个字母不影响登录。
        </p>
      </div>
    </>
  )
}
