import { useEffect, useState } from 'react'
import { bindPhone, loginByPhone, sendCode } from '../../engine/account'
import { maskId, rememberId } from '../../engine/cardid'

/**
 * The door an unbound account stands at.
 *
 * 「太多人开小号了」: nothing in card mode is reachable until a mainland
 * number has answered a code. Two ways through — bind this account to a
 * number (which claims it), or walk into the account a number already holds
 * (which is how a lost id comes back). The number itself is never kept.
 */
export default function PhoneGate({ id, onBound, onSignOut, backLabel = '换一个 ID' }: {
  /** the account to bind; absent on the front door, where only 「用手机号进入」 makes sense */
  id?: string; onBound: (last4: string) => void; onSignOut: () => void; backLabel?: string
}) {
  const [mode, setMode] = useState<'bind' | 'login'>(id ? 'bind' : 'login')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [dev, setDev] = useState(false)

  useEffect(() => {
    if (wait <= 0) return
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000)
    return () => window.clearTimeout(t)
  }, [wait])

  const send = async () => {
    setBusy(true); setMsg(null)
    const r = await sendCode(phone)
    setBusy(false)
    if (!r.ok) { setMsg(r.why ?? '没发出去。'); if (r.wait) setWait(r.wait); return }
    setWait(r.wait ?? 60)
    setDev(!!r.dev)
    setMsg(r.dev ? '验证码已生成（服务器还没接短信，作者能在后台看到，找作者要）。' : '验证码已发送。')
  }

  const submit = async () => {
    setBusy(true); setMsg(null)
    if (mode === 'bind' && id) {
      const r = await bindPhone(id, phone, code)
      setBusy(false)
      if (!r.ok) { setMsg(r.why ?? '没绑上。'); if (r.taken) setMode('login'); return }
      onBound(r.phone ?? phone.slice(-4))
    } else {
      const r = await loginByPhone(phone, code)
      setBusy(false)
      if (!r.ok || !r.id) { setMsg(r.why ?? '没进去。'); return }
      rememberId(r.id)
      location.reload()
    }
  }

  const okPhone = /^1[3-9]\d{9}$/.test(phone.replace(/\D/g, '').replace(/^86/, ''))
  return (
    <div className="wrap phone-gate" style={{ maxWidth: 420, margin: '40px auto', padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>{mode === 'bind' ? '先绑一个手机号' : '用手机号进入'}</h2>
      <p className="small muted" style={{ lineHeight: 1.7 }}>
        {mode === 'bind'
          ? <>一个手机号只能有一个账号，绑上就是你的了。当前账号 <span className="mono">{maskId(id ?? '')}</span>。</>
          : <>收一条验证码，就回到这个手机号绑过的账号。</>}
        <br />不存你的号码，只存能对上号的摘要和尾号四位。海外号码收不到大陆短信，请到抖音私信作者人工处理。
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <input
          inputMode="tel" placeholder="中国大陆手机号" value={phone} maxLength={14}
          onChange={(e) => setPhone(e.target.value)} style={{ flex: 1 }}
        />
        <button className="sm" disabled={busy || wait > 0 || !okPhone} onClick={() => void send()}>
          {wait > 0 ? `${wait} 秒` : '发验证码'}
        </button>
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <input
          inputMode="numeric" placeholder="6 位验证码" value={code} maxLength={6}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ flex: 1 }}
        />
        <button className="primary sm" disabled={busy || code.length !== 6 || !okPhone} onClick={() => void submit()}>
          {mode === 'bind' ? '绑定' : '进入'}
        </button>
      </div>
      {msg && <p className={`small ${dev ? 'muted' : ''}`} style={{ color: msg.includes('已') ? 'var(--good)' : 'var(--warn)' }}>{msg}</p>}
      <div className="row wrap" style={{ gap: 12, marginTop: 16 }}>
        {id && (
          <button className="ghost sm" onClick={() => { setMode(mode === 'bind' ? 'login' : 'bind'); setMsg(null); setCode('') }}>
            {mode === 'bind' ? '已经绑过手机？用手机号进入' : '给当前账号绑手机'}
          </button>
        )}
        <button className="ghost sm" onClick={onSignOut}>{backLabel}</button>
      </div>
    </div>
  )
}
