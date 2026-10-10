/**
 * Every retired card as the game draws it (RetiredDesign.tsx), on the 480×672 canvas,
 * for scripts/render_retired_cards.mjs → public/cards/retired/stats/cards/.
 */
import { createRoot } from 'react-dom/client'
import '../src/styles.css'
import { RETIRED_CARDS } from '../src/engine/cards'
import { RetiredFace } from '../src/ui/cards/RetiredDesign'

function App() {
  return <main style={{ padding: 24, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
    {RETIRED_CARDS.map((c) => {
      const name = c.rarity === 'mythic' ? `mythic-${c.ign}` : `normal-${c.id.slice(2)}`
      return <div key={c.id} data-export={name} style={{ width: 480 }}><RetiredFace card={c} /></div>
    })}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
