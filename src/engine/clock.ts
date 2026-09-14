/**
 * The one number the year is divided by, and the day count that survives a
 * rollover.
 *
 * `state.day` resets to 0 every winter, so anything stored as a day index
 * has to be shifted at the rollover (rebaseSeasonClock) or it silently
 * lands a year early. A career day does not: year × 364 + day only ever
 * grows. New timers use it and stay out of the rebase list.
 */
export const SEASON_DAYS = 364

export const careerDayOf = (s: { year: number; day: number }): number => s.year * SEASON_DAYS + s.day

/** a career day back into the year and day it names */
export const fromCareerDay = (cd: number): { year: number; day: number } =>
  ({ year: Math.floor(cd / SEASON_DAYS), day: cd % SEASON_DAYS })

/** a player told to sit out and cool off — see engine/disputes.ts */
export const isCoolingOff = (s: { year: number; day: number }, p: { coolOffUntil?: number }): boolean =>
  p.coolOffUntil != null && p.coolOffUntil > careerDayOf(s)
