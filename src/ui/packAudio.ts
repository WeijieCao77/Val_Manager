/**
 * Tiny procedural cues for the pack ceremony.
 *
 * They are synthesized instead of downloaded: no extra asset request, no
 * decode wait on the first pack, and every node stops itself. The music
 * player's mute/pause choice is treated as a global audio choice here too.
 */
type PackCue = 'grab' | 'tear' | 'reveal'

let context: AudioContext | null = null

function volume(): number {
  try {
    const raw = localStorage.getItem('valmgr.music')
    if (!raw) return .35
    const prefs = JSON.parse(raw) as { vol?: unknown; muted?: unknown; off?: unknown }
    if (prefs.muted === true || prefs.off === true) return 0
    return typeof prefs.vol === 'number' ? Math.max(0, Math.min(1, prefs.vol)) : .35
  } catch { return .35 }
}

function audio(): AudioContext | null {
  if (!volume()) return null
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch { return null }
}

function tone(ctx: AudioContext, at: number, from: number, to: number, duration: number, gain: number) {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(to, at + duration)
  amp.gain.setValueAtTime(gain, at)
  amp.gain.exponentialRampToValueAtTime(.0001, at + duration)
  osc.connect(amp).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + duration)
}

function noise(ctx: AudioContext, at: number, duration: number, gain: number) {
  const frames = Math.max(1, Math.ceil(ctx.sampleRate * duration))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    const falloff = 1 - i / frames
    data[i] = (Math.random() * 2 - 1) * falloff
  }
  const source = ctx.createBufferSource()
  const filter = ctx.createBiquadFilter()
  const amp = ctx.createGain()
  source.buffer = buffer
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(3200, at)
  filter.frequency.exponentialRampToValueAtTime(900, at + duration)
  filter.Q.value = .65
  amp.gain.setValueAtTime(gain, at)
  amp.gain.exponentialRampToValueAtTime(.0001, at + duration)
  source.connect(filter).connect(amp).connect(ctx.destination)
  source.start(at)
  source.stop(at + duration)
}

export function playPackCue(cue: PackCue): void {
  const ctx = audio()
  if (!ctx) return
  const v = volume()
  const now = ctx.currentTime
  if (cue === 'grab') {
    tone(ctx, now, 170, 95, .055, .035 * v)
    return
  }
  if (cue === 'tear') {
    noise(ctx, now, .28, .12 * v)
    tone(ctx, now + .015, 105, 48, .2, .11 * v)
    tone(ctx, now + .12, 520, 210, .11, .045 * v)
    return
  }
  tone(ctx, now, 155, 310, .24, .055 * v)
  tone(ctx, now + .075, 232, 466, .3, .04 * v)
}
