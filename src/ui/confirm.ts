/**
 * 「确定吗？」 without window.confirm().
 *
 * Some mobile browsers — Baidu's, in the report that led here — answer a
 * native confirm() with false before the player has seen it, so a button
 * wired through one does nothing at all: 接受 was pressed a dozen times and
 * the club never changed. This draws the same question in the page, with
 * the game's own styling, and resolves the way confirm() would have.
 *
 * Imperative on purpose: it is called from inside click handlers all over
 * the manager screens, and threading a React context through every one of
 * them for a yes/no box is more plumbing than the box.
 */
export function ask(message: string, okLabel = '确定', cancelLabel = '取消'): Promise<boolean> {
  return new Promise((resolve) => {
    const veil = document.createElement('div')
    veil.className = 'support-veil'
    const card = document.createElement('div')
    card.className = 'support-card ask-card'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    const text = document.createElement('p')
    text.className = 'ask-text'
    text.textContent = message
    const row = document.createElement('div')
    row.className = 'row'
    row.style.cssText = 'gap:8px;justify-content:flex-end;margin-top:14px'
    const no = document.createElement('button')
    no.className = 'sm ghost'
    no.textContent = cancelLabel
    const yes = document.createElement('button')
    yes.className = 'sm primary'
    yes.textContent = okLabel
    row.append(no, yes)
    card.append(text, row)
    document.body.append(veil, card)

    const done = (v: boolean) => {
      window.removeEventListener('keydown', onKey)
      veil.remove()
      card.remove()
      resolve(v)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(false)
      if (e.key === 'Enter') done(true)
    }
    window.addEventListener('keydown', onKey)
    veil.onclick = () => done(false)
    no.onclick = () => done(false)
    yes.onclick = () => done(true)
    yes.focus()
  })
}
