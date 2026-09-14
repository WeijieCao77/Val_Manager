/** Rebuild the small public club directory after world/dossier updates. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createNewGame } from '../src/engine/world'
const world = JSON.parse(readFileSync(new URL('../src/data/world.json', import.meta.url), 'utf8'))
const dossier = JSON.parse(readFileSync(new URL('../src/data/dossier.json', import.meta.url), 'utf8'))
const clubs = Object.fromEntries(world.teams.map((t: {id:string;name:string;region:string}) =>
  [t.id, { name: t.name, region: t.region, ...(dossier.logos?.[t.id] ? { logo: dossier.logos[t.id] } : {}) }]))
writeFileSync(new URL('../src/data/homeClubs.json', import.meta.url), JSON.stringify(clubs) + '\n')
const career = createNewGame(world.teams[0].id, 'metadata', 1)
const counts = { teams: Object.values(career.teams).filter(t => t.tier === 1 || t.tier === 2).length,
  players: Object.keys(career.players).length,
  headCoaches: new Set(Object.values(career.teams).flatMap(t => t.coach ? [t.coach.name] : [])).size }
writeFileSync(new URL('../src/data/homeCounts.json', import.meta.url), JSON.stringify(counts) + '\n')
console.log(`Built home metadata for ${Object.keys(clubs).length} clubs`)
