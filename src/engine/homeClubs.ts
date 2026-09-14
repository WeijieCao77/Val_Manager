import clubs from '../data/homeClubs.json'
export { default as HOME_COUNTS } from '../data/homeCounts.json'
export const HOME_CLUBS: Record<string, { name: string; region: string; logo?: string }> = clubs
export const homeCrestUrl = (id: string | null | undefined): string | null => {
  const stamp = id ? HOME_CLUBS[id]?.logo : undefined
  if (!id || !stamp) return null
  const base = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'
  return `${base}logos/${id}.webp?v=${stamp}`
}
