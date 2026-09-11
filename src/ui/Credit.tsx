/**
 * Who made this, on every screen.
 *
 * One component rendered once inside `<main>`, which every screen passes
 * through, so a new screen carries the credit without anyone remembering to
 * add it. Deliberately quiet — faint, small, at the end of the scroll — so it
 * sits under the game rather than in front of it.
 */
import { AFDIAN } from './Support'

const THANKS = ['FranX', 'Song', 'IDIOT', 'simon', '睡在song上铺的戈门']

/**
 * 感谢名单. It sits at the bottom of the manager's 存档 screen and 开瓦包's
 * 账号 tab rather than in the footer every screen carries.
 */
export function Thanks() {
  return (
    <p className="tiny faint" style={{ textAlign: 'center', margin: '10px 0 0' }}>
      感谢名单 <b>{THANKS.join('、')}</b>
    </p>
  )
}

export default function Credit() {
  return (
    <footer className="credit">
      <span><b>猪之家</b>出品</span>
      <span className="sep">·</span>
      <span>小红书<b>@点点点点点点点点</b></span>
      <span className="sep">·</span>
      <span>抖音<b>@点点点点点点点点</b></span>
      <span className="sep">·</span>
      {/* the corner button can be dismissed for good; this stays, so someone
          who changes their mind later still has a way to find it */}
      <span>
        <a href={AFDIAN} target="_blank" rel="noreferrer noopener">支持作者</a>
      </span>
    </footer>
  )
}
