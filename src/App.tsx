import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { setSaveNamespace } from './engine/save'
import { setCurrentRuleset } from './engine/ruleset'

/**
 * Three places to be, and the URL is the only thing that decides which.
 *
 * `/` is the front page, `/manager` is the career and `/cards` is 开瓦包. ALL
 * three destinations are loaded lazily now — the career included, which used
 * to ride in the entry chunk and made the front page download the whole game,
 * world data and all, before showing two buttons. This shell owns nothing but
 * the URL, so the entry chunk is a few kilobytes and each game arrives when
 * it is actually entered.
 *
 * The career used to be at `/`, which is the URL everybody already has. It
 * still works: the front page is what they land on, and the career card on it
 * offers 「继续上次存档」 when there is one, so a returning player is one click
 * from exactly where they were rather than being told their game is gone.
 */
const CardMode = lazy(() => import('./ui/CardMode'))
const Home = lazy(() => import('./ui/Home'))
const ManagerGame = lazy(() => import('./ManagerGame'))
import UpdateNudge from './ui/UpdateNudge'
import DomainNotice from './ui/DomainNotice'
import MusicPlayer from './ui/MusicPlayer'

type Mode = 'home' | 'career' | 'career-test' | 'cards'
const PATHS: Record<Mode, string> = { home: '/', career: '/manager', 'career-test': '/manager/test', cards: '/cards' }

/**
 * /manager/test is the career on the 2026 rulebook with its draws (see
 * engine/ruleset.ts), with saves of its own; /manager is the career as it
 * has always played. Same bundle, one flag.
 */
const modeOf = (): Mode => {
  if (typeof location === 'undefined') return 'home'
  const p = location.pathname.replace(/\/+$/, '')
  if (p.endsWith('/cards')) return 'cards'
  if (p.endsWith('/manager/test')) return 'career-test'
  if (p.endsWith('/manager')) return 'career'
  return 'home'
}

export default function App() {
  // The card mode is a different game with a different save, so it gets the
  // whole window rather than a screen inside the career shell. Which one you
  // are in is the URL and nothing else: /cards is the card mode, everything
  // else is the career. That way a refresh keeps you where you were, the back
  // button works, and there is exactly one way in.
  const [mode, setModeRaw] = useState<Mode>(modeOf)
  // the address decides the rulebook new careers get and where saves live;
  // set before the career shell mounts, so its first read of storage is the
  // right namespace
  if (mode === 'career-test') { setSaveNamespace('test'); setCurrentRuleset('vct-2026') }
  else { setSaveNamespace(''); setCurrentRuleset('vct-2025') }
  const setMode = useCallback((m: Mode) => {
    try {
      const to = PATHS[m]
      if (location.pathname !== to) history.pushState({}, '', to)
    } catch { /* file:// or a sandboxed frame; the state change still works */ }
    setModeRaw(m)
  }, [])

  // back and forward move between the three, rather than leaving the site
  useEffect(() => {
    const onPop = () => setModeRaw(modeOf())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const loading = (
    <div className="wrap" style={{ padding: 40 }}><p className="muted">载入中…</p></div>
  )
  const page = mode === 'home' ? <Home onOpen={setMode} />
    : mode === 'cards' ? <CardMode onExit={() => setMode('home')} />
      : <ManagerGame key={mode} onHome={() => setMode('home')} ruleset={mode === 'career-test' ? 'vct-2026' : 'vct-2025'} />
  return (
    <>
      <UpdateNudge />
      <DomainNotice />
      <Suspense fallback={loading}>{page}</Suspense>
      {/* under every page, so it keeps playing across the three */}
      <MusicPlayer />
    </>
  )
}
