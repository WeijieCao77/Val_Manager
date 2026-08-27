/**
 * Who made this, on every screen.
 *
 * One component rendered once inside `<main>`, which every screen passes
 * through, so a new screen carries the credit without anyone remembering to
 * add it. Deliberately quiet — faint, small, at the end of the scroll — so it
 * sits under the game rather than in front of it.
 */
import { AFDIAN } from './Support'

export default function Credit() {
  return (
    <footer className="credit">
      <span>作者：<b>猪之家</b>出品</span>
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
