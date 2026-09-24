import { Component } from 'react'
import type { ReactNode } from 'react'

/**
 * A page that failed to load says so, instead of the whole site going blank.
 *
 * Every screen past the front page is a lazy chunk with a hashed name, and a
 * deploy replaces them all: a tab opened before it asks for a file that no
 * longer exists, the server answers with index.html, the import throws, and
 * React with no boundary unmounts everything. Almost always that is an old
 * tab, and a refresh is the whole cure, so that is what this offers.
 */
export default class ChunkBoundary extends Component<{ children: ReactNode; quiet?: boolean }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: unknown) { console.warn('page failed to load', err) }
  render() {
    if (!this.state.failed) return this.props.children
    // an extra on top of a page (the reminder) just stays away
    if (this.props.quiet) return null
    return (
      <div className="wrap" style={{ padding: 40 }}>
        <p>页面没有载入成功，可能是游戏刚更新过。</p>
        <button className="primary" onClick={() => location.reload()}>刷新页面</button>
      </div>
    )
  }
}
