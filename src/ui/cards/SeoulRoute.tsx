import EventRoute from './EventRoute'
import type { EventRouteScreen } from './EventRoute'
import { SEOUL_TEAMS } from '../../engine/seoul2024'
import { SEOUL_ROUTE } from '../../engine/seoulRoute'

/** 首尔征途: a 2024 team's road through Seoul — the shared 征途 screen (EventRoute.tsx). */
const SEOUL: EventRouteScreen = {
  title: '首尔征途', event: '2024 首尔冠军赛', year: '2024', route: SEOUL_ROUTE, teams: SEOUL_TEAMS,
  state: (g) => g.seoulRoute, actions: 'seoul', pack: 'seoul2024',
}
export default function SeoulRoute() {
  return <EventRoute cfg={SEOUL} />
}
