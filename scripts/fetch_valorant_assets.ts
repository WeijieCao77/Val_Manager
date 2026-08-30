/**
 * Pull agent icons and map banners from valorant-api.com into public/, and
 * print the zh-CN name table the UI displays.
 *
 * valorant-api.com is a free static-asset mirror of the game's own data — not
 * vlr.gg or Liquipedia, both of which have blocked this project's IP. One run
 * downloads everything the game references; re-running only fetches what is
 * missing, so it stays polite.
 *
 * Verifies the API's zh-CN map names against MAP_CN before trusting its agent
 * names: if the thirteen maps all agree, the same translator wrote both.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { ALL_AGENTS, MAPS, MAP_CN } from '../src/engine/content'

const AGENT_DIR = 'public/agents'
const MAP_DIR = 'public/maps'
mkdirSync(AGENT_DIR, { recursive: true })
mkdirSync(MAP_DIR, { recursive: true })

const get = async (url: string) => (await (await fetch(url)).json()).data as {
  uuid: string; displayName: string; displayIcon?: string; listViewIcon?: string
  tacticalDescription?: string
}[]

const fileSafe = (name: string) => name.replace(/[^A-Za-z]/g, '')

async function download(url: string, path: string, maxPx: number) {
  if (existsSync(path)) return false
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  writeFileSync(path, buf)
  // keep the bundle small: icons show at ≤40px, banners at ~280px
  execFileSync('sips', ['-Z', String(maxPx), path], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 150))
  return true
}

// ---------------------------------------------------------------- agents
const [agentsEn, agentsCn] = await Promise.all([
  get('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=en-US'),
  get('https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=zh-CN'),
])
const cnByUuid = new Map(agentsCn.map((a) => [a.uuid, a.displayName]))

const agentCn: Record<string, string> = {}
for (const name of ALL_AGENTS) {
  const en = agentsEn.find((a) => a.displayName === name)
  if (!en?.displayIcon) throw new Error(`valorant-api 找不到英雄 ${name}`)
  agentCn[name] = cnByUuid.get(en.uuid) ?? name
  const fresh = await download(en.displayIcon, `${AGENT_DIR}/${fileSafe(name)}.png`, 128)
  console.log(`${fresh ? '↓' : '·'} ${name} → ${agentCn[name]}`)
}

// ---------------------------------------------------------------- maps
const [mapsEn, mapsCn] = await Promise.all([
  get('https://valorant-api.com/v1/maps?language=en-US'),
  get('https://valorant-api.com/v1/maps?language=zh-CN'),
])
const mapCnByUuid = new Map(mapsCn.map((m) => [m.uuid, m.displayName]))

for (const name of MAPS) {
  const en = mapsEn.find((m) => m.displayName === name && m.tacticalDescription)
  if (!en?.listViewIcon) throw new Error(`valorant-api 找不到地图 ${name}`)
  const apiCn = mapCnByUuid.get(en.uuid)
  if (apiCn !== MAP_CN[name]) {
    throw new Error(`${name} 译名不一致：游戏内 ${MAP_CN[name]}，API ${apiCn}`)
  }
  const fresh = await download(en.listViewIcon, `${MAP_DIR}/${name}.png`, 560)
  console.log(`${fresh ? '↓' : '·'} ${name} → ${apiCn}`)
}

console.log('\nAGENT_CN（贴进 content.ts）：')
console.log(JSON.stringify(agentCn, null, 2))
