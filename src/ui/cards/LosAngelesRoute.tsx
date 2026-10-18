import EventRoute from './EventRoute'
import type { EventRouteScreen } from './EventRoute'
import { LOS_ANGELES_TEAMS } from '../../engine/losangeles2023'
import { LOS_ANGELES_ROUTE } from '../../engine/losAngelesRoute'

/** 洛杉矶征途: a team's road through Champions 2023 — the shared 征途 screen (EventRoute.tsx). */
const LOS_ANGELES: EventRouteScreen = {
  title: '洛杉矶征途', event: '2023 洛杉矶冠军赛', year: '2023', route: LOS_ANGELES_ROUTE, teams: LOS_ANGELES_TEAMS,
  state: (g) => g.losAngelesRoute, actions: 'la', pack: 'losangeles2023',
}
export default function LosAngelesRoute() {
  return <EventRoute cfg={LOS_ANGELES} />
}
