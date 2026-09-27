/**
 * The pack ceremony's sound: synthesized, never downloaded.
 *
 * No asset request (the music already is most of the site's traffic), no decode wait on the first pack, and every
 * node stops itself. Owner, 2026-09-27: 「给开瓦包加开卡包音效」. There were three cues before, and nobody heard
 * them: they were tied to the music player, so pausing the music silenced them, and the flip played at about 2%.
 *
 * Now they have their own switch (`valmgr.sfx`, on unless turned off, the 音效 button on the reveal), and they say
 * what the pack is doing: foil under the thumb, the rip, the burst, a card back arriving — a gold or 彩卡 back
 * already sounds like one — and a flip whose sting is the card's metal. A pack that is skipped still gets the best
 * card's sting at the end. Everything goes through one compressor, so a 彩卡 on a phone speaker is loud, not clipped.
 */
import type { Rarity } from '../engine/cards'

export type PackCue = 'grab' | 'tear' | 'burst' | 'back' | 'reveal' | 'summary'

const KEY = 'valmgr.sfx'
let context: AudioContext | null = null
let bus: { master: GainNode; wet: GainNode } | null = null

/** 音效 on or off — its own switch, not the music's */
export function sfxOn(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    return !raw || (JSON.parse(raw) as { on?: unknown }).on !== false
  } catch { return true }
}
export function setSfxOn(on: boolean): void {
  try { localStorage.setItem(KEY, JSON.stringify({ on })) } catch { /* private window: this visit only */ }
  sessionOn = on
}
// a private window refuses storage; the button still works for the visit
let sessionOn: boolean | null = null
const enabled = () => sessionOn ?? sfxOn()

function audio(): { ctx: AudioContext; master: GainNode; wet: GainNode } | null {
  if (!enabled()) return null
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      context = new Ctor()
    }
    const ctx = context
    if (ctx.state === 'suspended') void ctx.resume()
    if (!bus) {
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -16
      comp.knee.value = 10
      comp.ratio.value = 4
      comp.attack.value = .004
      comp.release.value = .2
      comp.connect(ctx.destination)
      const master = ctx.createGain()
      master.gain.value = .8
      master.connect(comp)
      // a small room for the bells: a second of decaying noise as the impulse
      const verb = ctx.createConvolver()
      const len = Math.ceil(ctx.sampleRate * 1.6)
      const ir = ctx.createBuffer(2, len, ctx.sampleRate)
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
      }
      verb.buffer = ir
      const wet = ctx.createGain()
      wet.gain.value = .32
      wet.connect(verb).connect(master)
      bus = { master, wet }
    }
    return { ctx, ...bus }
  } catch { return null }
}

type Out = { ctx: AudioContext; master: GainNode; wet: GainNode }

/** an envelope that starts from silence, so nothing clicks */
function env(ctx: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(peak, at + attack)
  g.gain.exponentialRampToValueAtTime(.0001, at + attack + decay)
  return g
}

/** a gliding tone: thumps, ticks, the riser's voice */
function tone(o: Out, at: number, from: number, to: number, dur: number, gain: number, type: OscillatorType = 'sine', attack = .004) {
  const { ctx, master } = o
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur)
  const g = env(ctx, at, gain, attack, dur)
  osc.connect(g).connect(master)
  osc.start(at)
  osc.stop(at + attack + dur + .02)
}

/** a struck bell: inharmonic partials, the high ones dying first, part of it sent to the room */
function bell(o: Out, at: number, freq: number, dur: number, gain: number) {
  const { ctx, master, wet } = o
  const partials: [number, number, number][] = [[1, 1, 1], [2.0, .42, .7], [2.76, .28, .5], [4.07, .14, .35], [5.4, .07, .25]]
  for (const [ratio, amp, life] of partials) {
    const f = freq * ratio
    if (f > 16000) continue
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f, at)
    const g = env(ctx, at, gain * amp, .003, dur * life)
    osc.connect(g)
    g.connect(master)
    g.connect(wet)
    osc.start(at)
    osc.stop(at + dur * life + .05)
  }
}

let noiseBuf: AudioBuffer | null = null
/** filtered noise: foil, the rip, air moving */
function noise(o: Out, at: number, dur: number, gain: number, filter: BiquadFilterType, f0: number, f1: number, q = .8, attack = .005) {
  const { ctx, master } = o
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  const bq = ctx.createBiquadFilter()
  bq.type = filter
  bq.Q.value = q
  bq.frequency.setValueAtTime(f0, at)
  bq.frequency.exponentialRampToValueAtTime(f1, at + dur)
  const g = env(ctx, at, gain, attack, dur)
  src.connect(bq).connect(g).connect(master)
  src.start(at, Math.random() * 1.5)
  src.stop(at + attack + dur + .02)
}

// notes, in Hz
const C5 = 523.25, E5 = 659.25, G5 = 783.99, B5 = 987.77, C6 = 1046.5, E6 = 1318.5, G6 = 1568, C4 = 261.63, G4 = 392

function crinkle(o: Out, at: number, n: number, gain: number) {
  for (let i = 0; i < n; i++) {
    noise(o, at + i * (.018 + Math.random() * .02), .018 + Math.random() * .02, gain * (.6 + Math.random() * .4), 'highpass', 3500 + Math.random() * 2500, 5000, .7, .001)
  }
}

function sparkle(o: Out, at: number, n: number, span: number, gain: number) {
  for (let i = 0; i < n; i++) {
    const t = at + (i / n) * span + Math.random() * .03
    bell(o, t, 2200 + Math.random() * 2600, .5, gain * (1 - i / (n * 1.4)))
  }
}

/** a card turning over: a short swish, then its metal */
function sting(o: Out, at: number, rarity: Rarity) {
  // most of a ten-pack is bronze, so the common flip is the quiet one and every metal above it is louder
  noise(o, at, .09, rarity === 'bronze' ? .1 : .16, 'bandpass', 1400, 4200, 1.1, .006)
  const t = at + .05
  switch (rarity) {
    case 'bronze':
      // a wooden tock: plain, and still a small pleasure
      tone(o, t, 820, 610, .07, .12, 'sine', .002)
      tone(o, t, 230, 180, .12, .09, 'triangle', .002)
      return
    case 'silver':
      bell(o, t, E5, .9, .16)
      bell(o, t + .09, B5, 1.1, .14)
      return
    case 'gold':
      tone(o, t, 140, 60, .25, .3, 'sine', .004)
      ;[C5, E5, G5, C6].forEach((f, i) => bell(o, t + i * .065, f, 1.3, .15))
      sparkle(o, t + .28, 5, .5, .05)
      return
    case 'mythic':
      // the one they came for: a floor-shaking boom, a full chord, and it keeps glittering
      tone(o, t, 110, 38, .9, .5, 'sine', .006)
      noise(o, t, .7, .22, 'lowpass', 900, 120, .6, .01)
      ;[C4, G4, C5, E5, G5, C6].forEach((f, i) => bell(o, t + .02 + i * .045, f, 2.2, .13))
      bell(o, t + .34, E6, 1.6, .09)
      bell(o, t + .42, G6, 1.6, .08)
      sparkle(o, t + .35, 14, 1.3, .07)
  }
}

export function playPackCue(cue: PackCue, rarity: Rarity = 'bronze', count = 0): void {
  const o = audio()
  if (!o) return
  const now = o.ctx.currentTime + .01
  switch (cue) {
    case 'grab':
      // foil under the thumb
      crinkle(o, now, 3, .09)
      return
    case 'tear': {
      // the rip: grains of foil giving way along a rising band, over a body thud
      tone(o, now, 120, 50, .18, .22, 'sine', .003)
      noise(o, now, .34, .2, 'bandpass', 1600, 5200, .9, .01)
      for (let i = 0; i < 14; i++) {
        noise(o, now + .01 + i * .022 + Math.random() * .008, .016, .12 + Math.random() * .1, 'highpass', 2500 + i * 180, 4000 + i * 200, .8, .001)
      }
      return
    }
    case 'burst':
      // the pack opens: air, a low bloom, a bright chord already in the room
      noise(o, now, .5, .2, 'bandpass', 380, 2600, .9, .12)
      tone(o, now + .05, 90, 55, .4, .2, 'sine', .01)
      ;[G4, C5, E5].forEach((f, i) => bell(o, now + .1 + i * .03, f, .9, .06))
      return
    case 'back':
      // a new back slides in; a good one already hums
      noise(o, now, .16, .07, 'bandpass', 700, 1800, 1, .03)
      if (rarity === 'gold') {
        tone(o, now + .05, 330, 660, .7, .05, 'sine', .25)
        sparkle(o, now + .2, 3, .5, .025)
      } else if (rarity === 'mythic') {
        // a riser that does not resolve until the card is turned
        noise(o, now, 1.1, .12, 'bandpass', 500, 6000, 2.5, .8)
        tone(o, now, 180, 720, 1.1, .08, 'sawtooth', .9)
        tone(o, now, 270, 1080, 1.1, .05, 'sine', .9)
        sparkle(o, now + .5, 6, .7, .035)
      }
      return
    case 'reveal':
      sting(o, now, rarity)
      return
    case 'summary': {
      // the cards land on the table, one tick each, a step up every card
      const n = Math.max(1, Math.min(10, count))
      for (let i = 0; i < n; i++) tone(o, now + i * .04, 900 + i * 60, 700 + i * 50, .05, .09, 'triangle', .002)
      // a skipped pack still gets its best card's moment
      if (rarity === 'gold' || rarity === 'mythic') sting(o, now + n * .04 + .08, rarity)
    }
  }
}
