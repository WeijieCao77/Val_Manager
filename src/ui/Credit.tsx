/**
 * Who made this, on every screen.
 *
 * One component rendered once inside `<main>`, which every screen passes
 * through, so a new screen carries the credit without anyone remembering to
 * add it. Deliberately quiet — faint, small, at the end of the scroll — so it
 * sits under the game rather than in front of it.
 */
export default function Credit() {
  return (
    <footer className="credit">
      <span>作者：<b>猪之家</b>出品</span>
      <span className="sep">·</span>
      <span>小红书<b>@点点点点点点点点</b></span>
      <span className="sep">·</span>
      <span>抖音<b>@点点点点点点点点</b></span>
    </footer>
  )
}
