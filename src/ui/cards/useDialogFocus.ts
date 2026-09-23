import { useEffect, useRef } from 'react'

const stack: HTMLElement[] = []
const controls = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
/** Keep keyboard focus in the topmost card overlay, then return to its opener. */
export function useDialogFocus(onClose: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const root = ref.current
    if (!enabled || !root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stack.push(root)
    const candidates = () => [...root.querySelectorAll<HTMLElement>(controls)].filter(el => el.getClientRects().length && el.getAttribute('aria-hidden') !== 'true')
    ;(candidates()[0] ?? root).focus({ preventScroll: true })
    const keydown = (e: KeyboardEvent) => {
      if (stack.at(-1) !== root || document.querySelector('dialog[open]')) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close.current(); return }
      if (e.key !== 'Tab') return
      const items = candidates()
      const first = items[0] ?? root
      const last = items.at(-1) ?? root
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      const index = stack.indexOf(root)
      if (index >= 0) stack.splice(index, 1)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [enabled])
  return ref
}
