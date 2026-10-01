import EventRoute from './EventRoute'
import type { EventRouteScreen } from './EventRoute'
import { BANGKOK_TEAMS } from '../../engine/bangkok2025'
import { BANGKOK_ROUTE } from '../../engine/bangkokRoute'

/** 曼谷征途: a team's road through Masters Bangkok 2025 — the shared 征途 screen (EventRoute.tsx). */
const BANGKOK: EventRouteScreen = {
  title: '曼谷征途', event: '2025 曼谷大师赛', year: '2025', route: BANGKOK_ROUTE, teams: BANGKOK_TEAMS,
  state: (g) => g.bangkokRoute, actions: 'bangkok', pack: 'bangkok2025',
}
export default function BangkokRoute() {
  return <EventRoute cfg={BANGKOK} />
}
