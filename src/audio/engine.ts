// Fully procedural ambient audio engine for Kawaguchiko WeatherScape.
// No audio files — everything is synthesized with the Web Audio API.
import { sim, clamp01, smoothstep, lerp } from '../engine/sim'

const rand = (a: number, b: number) => a + Math.random() * (b - a)

// ---------- module state ----------
let ctx: AudioContext | null = null
let masterGain: GainNode | null = null // enable/disable ramp
let masterLP: BiquadFilterNode | null = null // snow muffling
let duckGain: GainNode | null = null // snow duck (all sources feed this)
let rafId = 0
let enabled = false
let lastParamUpdate = 0
const timers = new Set<ReturnType<typeof setTimeout>>()

// continuously-driven nodes (targets set in the update loop)
let windBP: BiquadFilterNode | null = null
let windGain: GainNode | null = null
let windLfoDepth: GainNode | null = null
let rumbleGain: GainNode | null = null
let rainGain: GainNode | null = null
let lakeGain: GainNode | null = null
let cricketGain: GainNode | null = null

let noiseWhite: AudioBuffer | null = null
let noisePink: AudioBuffer | null = null

function onLightning(distance: number) {
  if (!ctx || !enabled) return
  const delay = Math.max(0.05, distance / 340)
  later(delay * 1000, () => thunder(distance))
}

function later(ms: number, fn: () => void) {
  const id = setTimeout(() => { timers.delete(id); fn() }, ms)
  timers.add(id)
}

// ---------- buffers ----------
function makeNoise(seconds: number, pink: boolean): AudioBuffer {
  const c = ctx!
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  if (!pink) {
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  } else {
    // Paul Kellet pink noise approximation
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    }
  }
  return buf
}

function loopSource(buffer: AudioBuffer): AudioBufferSourceNode {
  const src = ctx!.createBufferSource()
  src.buffer = buffer
  src.loop = true
  src.start()
  return src
}

function lfo(freq: number, depth: number, target: AudioParam, type: OscillatorType = 'sine'): GainNode {
  const osc = ctx!.createOscillator()
  osc.type = type
  osc.frequency.value = freq
  const g = ctx!.createGain()
  g.gain.value = depth
  osc.connect(g)
  g.connect(target)
  osc.start()
  return g
}

// ---------- graph ----------
function buildGraph() {
  const c = ctx!
  masterGain = c.createGain(); masterGain.gain.value = 0
  masterLP = c.createBiquadFilter(); masterLP.type = 'lowpass'; masterLP.frequency.value = 18000; masterLP.Q.value = 0.3
  duckGain = c.createGain(); duckGain.gain.value = 1
  duckGain.connect(masterLP); masterLP.connect(masterGain); masterGain.connect(c.destination)

  noiseWhite = makeNoise(3, false)
  noisePink = makeNoise(4, true)

  // WIND — pink noise through a sliding bandpass, gust LFO on the gain
  windBP = c.createBiquadFilter(); windBP.type = 'bandpass'; windBP.frequency.value = 400; windBP.Q.value = 0.7
  windGain = c.createGain(); windGain.gain.value = 0
  loopSource(noisePink).connect(windBP); windBP.connect(windGain); windGain.connect(duckGain)
  windLfoDepth = lfo(rand(0.1, 0.3), 0, windGain.gain)

  // storm rumble band (only opens at high wind)
  const rumbleLP = c.createBiquadFilter(); rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 130; rumbleLP.Q.value = 0.5
  rumbleGain = c.createGain(); rumbleGain.gain.value = 0
  loopSource(noisePink).connect(rumbleLP); rumbleLP.connect(rumbleGain); rumbleGain.connect(duckGain)

  // RAIN — white noise hiss through a highpass
  const rainHP = c.createBiquadFilter(); rainHP.type = 'highpass'; rainHP.frequency.value = 1800; rainHP.Q.value = 0.5
  rainGain = c.createGain(); rainGain.gain.value = 0
  loopSource(noiseWhite).connect(rainHP); rainHP.connect(rainGain); rainGain.connect(duckGain)

  // LAKE WAVES — pink noise through a lowpass, slow swell AM
  const lakeLP = c.createBiquadFilter(); lakeLP.type = 'lowpass'; lakeLP.frequency.value = 500; lakeLP.Q.value = 0.4
  lakeGain = c.createGain(); lakeGain.gain.value = 0
  loopSource(noisePink).connect(lakeLP); lakeLP.connect(lakeGain); lakeGain.connect(duckGain)
  lfo(rand(0.07, 0.2), 0.03, lakeGain.gain)

  // CRICKETS — pulsed high tone, level driven from the update loop
  const cOsc = c.createOscillator(); cOsc.type = 'square'; cOsc.frequency.value = 4200
  const cBP = c.createBiquadFilter(); cBP.type = 'bandpass'; cBP.frequency.value = 4200; cBP.Q.value = 6
  const pulse = c.createGain(); pulse.gain.value = 0.5
  lfo(rand(12, 18), 0.5, pulse.gain, 'square')
  cricketGain = c.createGain(); cricketGain.gain.value = 0
  cOsc.connect(cBP); cBP.connect(pulse); pulse.connect(cricketGain); cricketGain.connect(duckGain)
  cOsc.start()
}

// ---------- one-shot event sounds ----------
function noiseBurst(dur: number, offset = -1): AudioBufferSourceNode {
  const src = ctx!.createBufferSource()
  src.buffer = noiseWhite
  const off = offset >= 0 ? offset : rand(0, noiseWhite!.duration - dur - 0.01)
  src.start(ctx!.currentTime, off, dur + 0.05)
  return src
}

function thunder(d: number) {
  const c = ctx!; if (!duckGain) return
  const t = c.currentTime
  const near = d < 300
  const dur = near ? rand(1.5, 2.6) : rand(2.4, 4)
  const peak = near ? 0.8 : rand(0.25, 0.4)
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6
  const f0 = near ? rand(240, 400) : rand(110, 150)
  const f1 = near ? rand(90, 130) : rand(55, 75)
  lp.frequency.setValueAtTime(f0, t)
  lp.frequency.exponentialRampToValueAtTime(f1, t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + (near ? 0.04 : rand(0.25, 0.5)))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  const src = noiseBurst(dur)
  src.connect(lp); lp.connect(g); g.connect(duckGain)
  src.stop(t + dur + 0.1)
  if (near) {
    // sharp crack transient
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900
    const cg = c.createGain()
    cg.gain.setValueAtTime(0.5, t)
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    const cs = noiseBurst(0.12)
    cs.connect(hp); hp.connect(cg); cg.connect(duckGain)
    cs.stop(t + 0.2)
  }
}

function birdChirp() {
  const c = ctx!; if (!duckGain) return
  const pan = c.createStereoPanner(); pan.pan.value = rand(-0.8, 0.8)
  pan.connect(duckGain)
  const blips = 2 + Math.floor(Math.random() * 3)
  let t = c.currentTime + 0.02
  for (let i = 0; i < blips; i++) {
    const osc = c.createOscillator()
    osc.type = Math.random() < 0.5 ? 'sine' : 'triangle'
    const f = rand(2000, 5000)
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.exponentialRampToValueAtTime(f * rand(0.75, 1.35), t + rand(0.05, 0.1))
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(rand(0.05, 0.1), t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.08, 0.15))
    osc.connect(g); g.connect(pan)
    osc.start(t); osc.stop(t + 0.2)
    t += rand(0.12, 0.28)
  }
}

function fireCrackle() {
  const c = ctx!; if (!duckGain) return
  const t = c.currentTime
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(1000, 3000); bp.Q.value = 1.5
  const g = c.createGain()
  const amp = sim.derived.fireStrength * (0.3 + sim.derived.nightF * 0.3) * rand(0.15, 0.45)
  const dur = rand(0.01, 0.035)
  g.gain.setValueAtTime(amp, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03)
  const src = noiseBurst(dur)
  src.connect(bp); bp.connect(g); g.connect(duckGain)
  src.stop(t + dur + 0.08)
}

function owlHoot() {
  const c = ctx!; if (!duckGain) return
  let t = c.currentTime + 0.05
  const base = rand(330, 370)
  for (const [dur, gap] of [[0.35, 0.4], [0.5, 0]] as const) {
    const osc = c.createOscillator(); osc.type = 'sine'
    osc.frequency.setValueAtTime(base, t)
    osc.frequency.linearRampToValueAtTime(base * 0.93, t + dur)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.03, t + 0.15)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g); g.connect(duckGain)
    osc.start(t); osc.stop(t + dur + 0.05)
    t += dur + gap
  }
}

function rainTick() {
  const c = ctx!; if (!duckGain) return
  const t = c.currentTime
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(2400, 3600); bp.Q.value = 2
  const g = c.createGain()
  const amp = rand(0.02, 0.07) * clamp01(sim.params.rainIntensity * 1.5)
  const dur = rand(0.015, 0.045)
  g.gain.setValueAtTime(amp, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02)
  const pan = c.createStereoPanner(); pan.pan.value = rand(-0.5, 0.5)
  const src = noiseBurst(dur)
  src.connect(bp); bp.connect(g); g.connect(pan); pan.connect(duckGain)
  src.stop(t + dur + 0.06)
}

// ---------- recursive schedulers ----------
function startSchedulers() {
  const patter = () => {
    if (!ctx) return
    const r = sim.params.rainIntensity
    if (enabled && r > 0.05) rainTick()
    later(r > 0.05 ? rand(0.3, 1.7) * 1000 / (2 + r * 18) : 400, patter)
  }
  patter()

  const birds = () => {
    if (!ctx) return
    const d = sim.derived, p = sim.params
    if (enabled && d.dayF > 0.5 && p.rainIntensity < 0.1 && p.snowIntensity < 0.1 && sim.season !== 'winter') birdChirp()
    later(rand(3, 10) * 1000, birds)
  }
  later(rand(2, 5) * 1000, birds)

  const fire = () => {
    if (!ctx) return
    const fs = sim.derived.fireStrength
    if (enabled && fs > 0.15) fireCrackle()
    later(fs > 0.15 ? rand(0.5, 1.5) * 1000 / (2 + fs * 4) : 500, fire)
  }
  fire()

  const owl = () => {
    if (!ctx) return
    if (enabled && sim.derived.nightF > 0.7) owlHoot()
    later(Math.max(15, -Math.log(Math.random() + 1e-6) * 45) * 1000, owl)
  }
  later(rand(20, 60) * 1000, owl)
}

// ---------- continuous parameter loop ----------
function seasonCricketFactor(): number {
  switch (sim.season) {
    case 'summer': return 1
    case 'autumn': return 0.85
    case 'spring': return 0.4
    default: return 0
  }
}

function update() {
  rafId = requestAnimationFrame(update)
  const c = ctx
  if (!c || !masterLP || !duckGain || !windBP || !windGain || !windLfoDepth || !rumbleGain || !rainGain || !lakeGain || !cricketGain) return
  const now = performance.now()
  if (now - lastParamUpdate < 90) return // ~11Hz is plenty for setTargetAtTime targets
  lastParamUpdate = now
  const p = sim.params, d = sim.derived
  const t = c.currentTime

  // snow muffling: lowpass glide + slight duck
  const snow = clamp01(p.snowIntensity * 1.3)
  masterLP.frequency.setTargetAtTime(lerp(18000, 2500, snow), t, 1)
  duckGain.gain.setTargetAtTime(1 - snow * 0.3, t, 0.8)

  // wind
  const w = d.wind01
  const wBase = 0.5 * Math.pow(clamp01(w), 1.4)
  windBP.frequency.setTargetAtTime(300 + w * 600, t, 0.6)
  windGain.gain.setTargetAtTime(wBase, t, 0.5)
  windLfoDepth.gain.setTargetAtTime(wBase * 0.35, t, 0.6)
  rumbleGain.gain.setTargetAtTime(smoothstep(0.7, 1, w) * 0.35, t, 0.7)

  // rain hiss
  rainGain.gain.setTargetAtTime(0.4 * Math.pow(clamp01(p.rainIntensity), 1.2), t, 0.5)

  // lake lapping (LFO adds swell on top of this base)
  lakeGain.gain.setTargetAtTime((0.05 + d.wave * 0.5) * 0.32, t, 0.8)

  // crickets
  const cricket = smoothstep(0.5, 0.8, d.nightF) * smoothstep(12, 16, p.temperature) *
    seasonCricketFactor() * (1 - clamp01(p.rainIntensity * 2)) * 0.035
  cricketGain.gain.setTargetAtTime(cricket, t, 1)
}

// ---------- public API ----------
export const audioEngine = {
  init(): void {
    if (ctx) { void ctx.resume(); return }
    ctx = new AudioContext()
    void ctx.resume()
    buildGraph()
    startSchedulers()
    sim.events.lightning.push(onLightning)
    lastParamUpdate = 0
    rafId = requestAnimationFrame(update)
  },

  setEnabled(b: boolean): void {
    enabled = b
    if (!ctx || !masterGain) return
    if (b) void ctx.resume()
    const t = ctx.currentTime
    const g = masterGain.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(g.value, t)
    g.linearRampToValueAtTime(b ? 0.55 : 0, t + 0.4)
  },

  dispose(): void {
    cancelAnimationFrame(rafId)
    for (const id of timers) clearTimeout(id)
    timers.clear()
    const i = sim.events.lightning.indexOf(onLightning)
    if (i >= 0) sim.events.lightning.splice(i, 1)
    if (ctx) void ctx.close()
    ctx = null
    masterGain = masterLP = duckGain = null
    windBP = null; windGain = windLfoDepth = rumbleGain = rainGain = lakeGain = cricketGain = null
    noiseWhite = noisePink = null
    enabled = false
  },
}
