/**
 * What the current version means for THIS club — read off the same numbers
 * the match engine reads, so the advice and the result never disagree.
 *
 * Three different things are kept apart on purpose, because they are three
 * different reasons a five wins a map (comp.ts, STYLE_K): the version
 * (coef per agent), the map fit (the comp's style against what the map
 * wants) and how well the men know the agents they are on (agentPro). A
 * comp can be with the version and wrong for the map; a darling nobody on
 * the roster can play is not advice. Nothing here changes a plan — it
 * names what a plan would cost and what would fix it, and the manager
 * decides.
 *
 * All of it is a pure function of the save. No opinion is invented where
 * the numbers are flat: a version with nothing tuned says so.
 */
import type { GameState, Player } from './types'
import type { Patch } from './comp'
import { DARLING, alignN, familiarity, styleMix, versionN } from './comp'
import { AGENTS, AGENT_ROLE, MAP_META, agentCn, mapCn } from './content'
import { poolFor, selectLineup, sheetFor } from './match'

/** the version's opinion of one agent, in words the panel prints */
export const coefLabel = (c: number): string =>
  c >= DARLING ? '版本之子' : c >= 0.3 ? '强势' : c > 0.05 ? '小加强' : c <= -DARLING ? '重削' : c <= -0.3 ? '弱势' : c < -0.05 ? '小削弱' : '持平'

export interface AgentNote { agent: string; coef: number }

export interface MapNote {
  map: string
  /** the plan's five, player id → agent */
  agents: Record<string, string>
  /** −1 all against the version … +1 all darlings; the number styleEdge uses */
  version: number
  /** −1 … +1, the comp's style against what the map wants */
  mapFit: number
  /** 0–100, how drilled this exact comp is; 50 is neutral */
  familiarity: number
  /** the plan's agents the version has cut, with what would replace them */
  issues: {
    playerId: string
    ign: string
    agent: string
    coef: number
    /** an agent the version favours, same job, that he can already play */
    swap: { agent: string; coef: number; pro: number } | null
    /** an agent the version favours, same job, that he would have to learn */
    train: { agent: string; coef: number; pro: number } | null
  }[]
  /** the plan's agents the version favours */
  upside: { ign: string; agent: string; coef: number }[]
}

export interface PlayerNote {
  id: string
  ign: string
  /** agents in his pool the version favours / has cut, best first */
  up: AgentNote[]
  down: AgentNote[]
}

export interface PatchAdvice {
  patch: Patch | undefined
  /** nothing tuned at all — the honest answer is "no version advice" */
  flat: boolean
  /** what THIS patch moved, with where each agent now stands — the news line's lists */
  buffed: AgentNote[]
  nerfed: AgentNote[]
  /** everyone the version currently favours / has cut, this patch or carried over */
  darlings: AgentNote[]
  weak: AgentNote[]
  maps: MapNote[]
  players: PlayerNote[]
  /** one line for the dashboard */
  summary: string
}

const NERF = -0.3
const BUFF = 0.3
/** a stand-in must be this much better with the version than the man he replaces */
const SWAP_GAIN = 0.4
/** can be fielded without learning first (agentFit's in-role floor is two thirds) */
const PLAYABLE = 60

function ranked(patch: Patch | undefined, sign: 1 | -1): AgentNote[] {
  return Object.entries(patch?.coef ?? {})
    .map(([agent, coef]) => ({ agent, coef }))
    .filter((n) => (sign > 0 ? n.coef >= BUFF : n.coef <= NERF))
    .sort((a, b) => sign * (b.coef - a.coef))
}

/** the version-favoured agents for this job the man could stand on, best first */
function alternatives(patch: Patch, p: Player, agent: string, map: string, taken: Set<string>) {
  const role = AGENT_ROLE[agent]
  const mine = patch.coef[agent] ?? 0
  const pool = new Set<string>([...(MAP_META[map] ?? []), ...(role ? AGENTS[role] ?? [] : [])])
  return [...pool]
    .filter((a) => a !== agent && !taken.has(a) && AGENT_ROLE[a] === role)
    .map((a) => ({ agent: a, coef: patch.coef[a] ?? 0, pro: p.agentPro?.[a] ?? 0 }))
    .filter((c) => c.coef - mine >= SWAP_GAIN)
    .sort((a, b) => b.coef - a.coef || b.pro - a.pro)
}

export function patchAdvice(state: GameState): PatchAdvice {
  const patch = state.patch
  const darlings = ranked(patch, 1)
  const weak = ranked(patch, -1)
  const buffed = (patch?.buffed ?? []).map((agent) => ({ agent, coef: patch!.coef[agent] ?? 0 }))
  const nerfed = (patch?.nerfed ?? []).map((agent) => ({ agent, coef: patch!.coef[agent] ?? 0 }))
  // an agent this patch cut counts as cut even if he is still a little above
  // water; the news said 削弱 and the plan must answer to the same word
  const isDown = (a: string) => (patch?.coef[a] ?? 0) <= NERF || (patch?.nerfed ?? []).includes(a)
  const isUp = (a: string) => (patch?.coef[a] ?? 0) >= BUFF || (patch?.buffed ?? []).includes(a)
  const flat = !patch || Object.keys(patch.coef).length === 0
  const lineup = selectLineup(state, state.myTeam)
  const maps: MapNote[] = poolFor(state).map((map) => {
    const { agents } = sheetFor(state, state.myTeam, map, lineup)
    const picked = Object.values(agents)
    const taken = new Set(picked)
    const issues: MapNote['issues'] = []
    const upside: MapNote['upside'] = []
    if (patch && !flat) {
      for (const [pid, agent] of Object.entries(agents)) {
        const p = state.players[pid]
        if (!p) continue
        const coef = patch.coef[agent] ?? 0
        if (isUp(agent)) upside.push({ ign: p.ign, agent, coef })
        if (!isDown(agent)) continue
        const alts = alternatives(patch, p, agent, map, taken)
        const swap = alts.find((a) => a.pro >= PLAYABLE) ?? null
        const train = swap ? null : alts[0] ?? null
        issues.push({ playerId: pid, ign: p.ign, agent, coef, swap, train })
      }
    }
    return {
      map, agents,
      version: versionN(picked, patch),
      mapFit: alignN(styleMix(picked), map),
      familiarity: Math.round(familiarity(state, state.myTeam, map, agents)),
      issues, upside,
    }
  })
  const players: PlayerNote[] = flat ? [] : lineup.map((p) => {
    const pool = Object.entries(p.agentPro ?? {}).filter(([, v]) => v >= PLAYABLE).map(([a]) => a)
    const notes = pool.map((agent) => ({ agent, coef: patch!.coef[agent] ?? 0 }))
    return {
      id: p.id, ign: p.ign,
      up: notes.filter((n) => isUp(n.agent)).sort((a, b) => b.coef - a.coef),
      down: notes.filter((n) => isDown(n.agent)).sort((a, b) => a.coef - b.coef),
    }
  }).filter((n) => n.up.length || n.down.length)

  const against = maps.filter((m) => m.version <= -0.15)
  const withIt = maps.filter((m) => m.version >= 0.15)
  const summary = !patch ? '还没有版本调整，所有英雄按原样计算。'
    : flat ? `${patch.name}：没有英雄被调整，阵容不用改。`
    : against.length
      ? `${against.length} 张图的预案逆版本（${against.map((m) => mapCn(m.map)).join('、')}），去战术页看换谁。`
      : withIt.length
        ? `预案顺着版本：${withIt.map((m) => mapCn(m.map)).join('、')}占便宜，其余持平。`
        : '预案和版本持平，没有明显吃亏或占便宜。'
  return { patch, flat, buffed, nerfed, darlings, weak, maps, players, summary }
}

/** the buff / nerf lists as one printable line */
export const patchLine = (patch: Patch): string => {
  const say = (xs: string[]) => xs.map(agentCn).join('、')
  const parts: string[] = []
  if (patch.buffed.length) parts.push(`加强 ${say(patch.buffed)}`)
  if (patch.nerfed.length) parts.push(`削弱 ${say(patch.nerfed)}`)
  return parts.length ? parts.join('；') : '只有微调'
}
