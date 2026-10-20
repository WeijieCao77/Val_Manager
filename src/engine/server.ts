/**
 * What the server needs from the engine, in one place.
 *
 * Bundled by `npm run build:server` into dist-server/engine.mjs and imported
 * by cards-api.js, which is plain JavaScript and cannot read TypeScript.
 * Nothing here is new code — it is the same rules the client ran, exported so
 * the server can run them instead. See engine/cardActions.ts for why.
 */
export { runAction, wantsRival, squadForPlay, ladderScore, ACTIONS, encRegistration } from './cardActions'
export { retiredStarters, retiredLimit, RETIRED_STARTER_LIMIT } from './retirementRules'
export type { ActEnv, ActResult } from './cardActions'
export {
  newGacha, migrateGacha, mergeClientFields, takeServerFields, clampState, refreshDaily,
  primeStamina, pendingOpponent, SERVER_KEYS, CLIENT_KEYS, STARTER_COINS, GACHA_VERSION,
  masterPoints, oppBumpFor, canPlay, spendPlay, chargeStamina, SMS_LOGIN_STAMINA, STAMINA_COST, STAMINA_MAX, STAMINA_REGEN_MS,
} from './gacha'
export type { GachaState } from './gacha'
export { rankName, LEAGUES, LEAGUE_RULES, rollSeason, seasonOf, encNation } from './gacha'
export type { LeagueKind } from './gacha'
export { applyMail, escrowCard, restoreCard, mailLine } from './inbox'
export type { MailItem } from './inbox'
export { cardById, ownableCard, isPlayerCard, squadRating, SALVAGE, ALL_CARDS, PLAYER_CARDS, COACH_CARDS, RARITY_CN } from './cards'
// the shelf is filtered and sorted before it is paged, so the server needs the
// same predicate the filter bar runs — see engine/cardFilter.ts
export { matchesFilter, matchesQuery, readFilter, filterActive } from './cardFilter'
export type { CardFilter } from './cardFilter'
export {
  openCupSlot, planOpenCup, planOpenCupFast, openCupRoundAt, pairOpenCupRound, playOpenCupMatch, openCupMatchSeed, openCupPurse,
  OPEN_CUP_MIN, OPEN_CUP_MAX, OPEN_CUP_RANKED_MIN,
} from './openCup'
export { BALANCE_VERSION } from './balance'
export * from './openCupSwiss'
export * from './teamCup'
export { squadPaper, chemistry, squadPower } from './cards'
export { playLevel } from './evolve'
export { progressOf } from '../../progress.js'
export { answerFor, kindFor, imgOf, challengeSig, challengeDay } from './challenge'
export { predictBoard, PREDICT_EVENT_IDS } from './predict'

// Profile merges prefer real unlocks over unknown historical keys when bounded.
// Export only identifiers; the HTTP module reuses this already-loaded bundle.
import { ENDINGS } from './endings'
import { ACHIEVEMENTS } from './achievements'
export const PROFILE_KEYS = {
  endings: ENDINGS.map(({ key }) => key),
  achievements: ACHIEVEMENTS.map(({ key }) => key),
}

// 读点 (swift-api.js): the round-by-round match, its AI and its ghosts
export {
  newSwiftMatch, submitChoice, submitRecon, takePause, swiftView, swiftSide, sideStrength, autoChoice, aiChoice, aiRecon,
  aiSide, habitFrom, addHabit, SWIFT_WIN, SWIFT_CHOOSE_SEC, SWIFT_RECON_SEC, SWIFT_REPLAY_SEC, isFormat, formatOf,
} from './swift'
export { Rng, hashStr } from './rng'

// 抢人大战 (draft-api.js)
export {
  dealLot, cleanBid, settleRound, roundRobin, draftMatchSeed, draftTable, roomCode, cleanCode,
  DRAFT_MIN, DRAFT_MAX, DRAFT_BUDGET, DRAFT_BID_SEC, DRAFT_POSITIONS, DRAFT_ROUNDS,
  draftSchedule, draftPlaces, draftPrize, DRAFT_PAID_MIN, DRAFT_PAID_ROOMS, DRAFT_OWN_BIDS,
} from './draft'
export { personOf } from './cards'
