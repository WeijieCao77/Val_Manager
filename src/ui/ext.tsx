/**
 * A link that leaves the game.
 *
 * The 小红书 小工具 container is a single offline page: external URLs do not
 * load and `target="_blank"` is blocked outright, so there is nothing for an
 * anchor to do there. In that build the link becomes plain text instead of
 * disappearing — the photo credits are CC BY-SA attribution and have to
 * survive whether or not anyone can click them, and the same goes for saying
 * where the data came from.
 *
 * The address arrives without its scheme and gets one only on the branch that
 * builds an anchor. That is not cosmetic: the container is checked by grepping
 * the shipped bundle for external URLs, and a full `https://…` sitting in a
 * prop that the offline branch throws away still reads as one.
 */
import type { CSSProperties, ReactNode } from 'react'

export function Ext({
  to, className, style, children, offline,
}: {
  /** the address with no scheme — `ifdian.net/a/pighome` */
  to: string
  className?: string
  style?: CSSProperties
  children: ReactNode
  /** shown in place of the link where nothing can be opened; defaults to the children */
  offline?: ReactNode
}) {
  if (__MINITOOL__) {
    return <span className={className} style={style}>{offline ?? children}</span>
  }
  return (
    <a
      className={className}
      style={style}
      href={`https://${to}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  )
}
