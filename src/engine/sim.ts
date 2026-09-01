import * as THREE from 'three'

// ---------- types ----------
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type Category = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | 'special'
export type Quality = 'low' | 'medium' | 'high' | 'ultra'

/** All continuous weather parameters. 0..1 unless noted. */
export interface WeatherParams {
  cloudCoverage: number
  cloudHeight: number // 0 = low (hides Fuji summit) .. 1 = high thin
  cloudDensity: number
  cloudSpeed: number
  cumulonimbus: number // towering storm cloud amount
  kasagumo: number // lens cloud over Fuji summit
  rainIntensity: number
  snowIntensity: number
  fogDensity: number // global fog
  mist: number // low mist on lake surface
  visibility: number // atmospheric clarity 0..1
  windSpeed: number // 0..1 (maps to calm..storm, 5 levels)
  windDirection: number // radians, 0 = blowing toward -z (toward Fuji)
  temperature: number // deg C (display / flake size hints)
  humidity: number
  lightningFrequency: number // 0 none .. 1 constant strikes
  lakeWave: number // base wave (wind is added on top in derived.wave)
  wetness: number // ground wetness
  snowCover: number // accumulated snow on ground/objects
  fujiVisibility: number // 0 hidden .. 1 fully visible (levels 0..5 = round(v*5))
  sunIntensity: number
  rainbow: number
}

export interface WeatherPreset {
  id: string
  name: string
  category: Category
  time?: number // suggested time of day (hours 0..24)
  season?: Season // suggested season
  params: WeatherParams
}

// ---------- world constants (all scene modules must use these) ----------
export const WORLD = {
  FUJI_POS: new THREE.Vector3(0, 0, -320), // base center of Mt. Fuji
  FUJI_HEIGHT: 95,
  FUJI_RADIUS: 190, // base radius of the cone footprint
  LAKE_Y: -0.35, // water surface height
  SHORE_Z: -6, // lake starts here (camp side edge)
  LAKE_FAR_Z: -300, // opposite shore
  LAKE_HALF_W: 420, // lake half width in x
  FAR_SHORE_Z: -295, // opposite-shore treeline / buildings
  CAMP_CENTER: new THREE.Vector3(0, 0, 2), // camp area around z 0..12
  CAM_START: new THREE.Vector3(0, 2.4, 11),
  CAM_TARGET: new THREE.Vector3(0, 6.5, -120), // initial orbit target (Fuji upper-center, camp at bottom)
}

// ---------- sim singleton (mutable, read in useFrame — never via React state) ----------
export interface Derived {
  sunDir: THREE.Vector3 // unit, FROM origin TOWARD sun
  moonDir: THREE.Vector3
  sunColor: THREE.Color
  sunI: number // directional light intensity
  moonI: number
  skyTop: THREE.Color
  skyHorizon: THREE.Color
  skyGlow: THREE.Color // sunset/sunrise glow near sun
  fogColor: THREE.Color
  fogDensityFinal: number // for scene FogExp2
  ambientI: number
  hemiI: number
  starAlpha: number // 0..1
  dayF: number // 0..1 daylight factor
  duskF: number // golden-hour factor
  nightF: number
  akafuji: number // red-fuji dawn factor 0..1
  windX: number // wind vector (world units/sec-ish, scaled 0..~1)
  windZ: number
  wind01: number // = params.windSpeed
  windLevel: number // 0..5 integer
  wave: number // final lake wave 0..1 (base + wind + rain)
  reflectionClarity: number // 0..1 — sakasa-fuji condition
  fujiLevel: number // 0..5
  snowLine: number // 0..1 fraction of Fuji height where snow starts
  fireStrength: number // 0..1 campfire burning strength
  lanternOn: number // 0..1
  elevDeg: number // sun elevation in degrees
}

export interface SimState {
  params: WeatherParams
  target: WeatherParams
  start: WeatherParams
  transDuration: number // seconds
  transElapsed: number
  time: number // hours 0..24
  timeTarget: number | null // tween destination for time (during preset transitions)
  timeSpeed: number // hours per real second when playing (0 = still)
  paused: boolean
  season: Season
  quality: Quality
  presetId: string
  auto: boolean
  autoTimer: number
  cinematic: boolean
  flash: number // lightning flash 0..1, decays
  flashPos: THREE.Vector3 // world position of last bolt
  events: { lightning: ((distance: number) => void)[] }
  derived: Derived
  elapsed: number // total sim seconds (for shaders)
}

export const DEFAULT_PARAMS: WeatherParams = {
  cloudCoverage: 0.05, cloudHeight: 0.7, cloudDensity: 0.3, cloudSpeed: 0.2,
  cumulonimbus: 0, kasagumo: 0,
  rainIntensity: 0, snowIntensity: 0, fogDensity: 0.02, mist: 0, visibility: 1,
  windSpeed: 0.15, windDirection: 0.6, temperature: 18, humidity: 0.4,
  lightningFrequency: 0, lakeWave: 0.15, wetness: 0, snowCover: 0,
  fujiVisibility: 1, sunIntensity: 1, rainbow: 0,
}

function clone(p: WeatherParams): WeatherParams { return { ...p } }

export const sim: SimState = {
  params: clone(DEFAULT_PARAMS),
  target: clone(DEFAULT_PARAMS),
  start: clone(DEFAULT_PARAMS),
  transDuration: 3,
  transElapsed: 3,
  time: 10,
  timeTarget: null,
  timeSpeed: 0,
  paused: false,
  season: 'summer',
  quality: 'high',
  presetId: 'clear',
  auto: false,
  autoTimer: 0,
  cinematic: false,
  flash: 0,
  flashPos: new THREE.Vector3(0, 60, -200),
  events: { lightning: [] },
  elapsed: 0,
  derived: {
    sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, -1, 0),
    sunColor: new THREE.Color('#fff5e8'), sunI: 1, moonI: 0,
    skyTop: new THREE.Color('#2f6fc2'), skyHorizon: new THREE.Color('#bcd8ee'),
    skyGlow: new THREE.Color('#ff9a4d'), fogColor: new THREE.Color('#bcd8ee'),
    fogDensityFinal: 0.001, ambientI: 0.5, hemiI: 0.4, starAlpha: 0,
    dayF: 1, duskF: 0, nightF: 0, akafuji: 0,
    windX: 0, windZ: 0, wind01: 0.15, windLevel: 1,
    wave: 0.15, reflectionClarity: 0.8, fujiLevel: 5, snowLine: 0.8,
    fireStrength: 1, lanternOn: 0, elevDeg: 45,
  },
}

// ---------- season data ----------
export interface SeasonInfo {
  grass: string; foliage: string; sakura: number; susuki: number
  fujiSnowline: number // 0..1 of height (lower = more snow)
  sunrise: number; sunset: number; maxElev: number // degrees
  tempBase: number
}
export const SEASONS: Record<Season, SeasonInfo> = {
  spring: { grass: '#7fa85a', foliage: '#86b45f', sakura: 1, susuki: 0, fujiSnowline: 0.5, sunrise: 5.3, sunset: 18.4, maxElev: 62, tempBase: 12 },
  summer: { grass: '#5e9440', foliage: '#3f7d33', sakura: 0, susuki: 0, fujiSnowline: 0.88, sunrise: 4.8, sunset: 19.2, maxElev: 75, tempBase: 24 },
  autumn: { grass: '#9a8a4c', foliage: '#b06a2a', sakura: 0, susuki: 1, fujiSnowline: 0.62, sunrise: 6.0, sunset: 17.4, maxElev: 48, tempBase: 12 },
  winter: { grass: '#8a8672', foliage: '#6b6257', sakura: 0, susuki: 0.3, fujiSnowline: 0.32, sunrise: 6.9, sunset: 16.8, maxElev: 32, tempBase: 0 },
}

// ---------- helpers ----------
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t)
}
function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** Fire a lightning strike: sets flash + notifies listeners (audio thunder delay). distance in meters. */
export function fireLightning(distance: number, pos?: THREE.Vector3) {
  sim.flash = 1
  if (pos) sim.flashPos.copy(pos)
  for (const fn of sim.events.lightning) fn(distance)
}

/** Begin transition to a preset. duration in seconds. */
export function applyPreset(preset: WeatherPreset, duration: number, opts?: { jumpTime?: boolean }) {
  sim.start = clone(sim.params)
  sim.target = clone(preset.params)
  sim.transDuration = Math.max(0.1, duration)
  sim.transElapsed = 0
  sim.presetId = preset.id
  if (preset.season) sim.season = preset.season
  if (preset.time !== undefined && opts?.jumpTime !== false) sim.timeTarget = preset.time
}

/** Directly set target params (custom sliders). Short transition. */
export function tweakParams(partial: Partial<WeatherParams>, duration = 1.5) {
  sim.start = clone(sim.params)
  Object.assign(sim.target, partial)
  sim.transDuration = duration
  sim.transElapsed = 0
}

// ---------- palette keyframes ----------
const C = (h: string) => new THREE.Color(h)
const NIGHT_TOP = C('#04070f'), NIGHT_HOR = C('#0b1220')
const DAWN_TOP = C('#22345e'), DAWN_HOR = C('#e08850')
const GOLD_TOP = C('#3e5f9e'), GOLD_HOR = C('#ffc27a')
const DAY_TOP = C('#2f6fc2'), DAY_HOR = C('#bcd8ee')
const OVER_TOP = C('#8d99a6'), OVER_HOR = C('#c3cad0')
const STORM_TOP = C('#2f363f'), STORM_HOR = C('#59636e')
const GLOW_HI = C('#ff8a3d'), GLOW_LO = C('#ff5a2d')
const SUN_WARM = C('#fff3e0'), SUN_LOW = C('#ff8b3a')
const tmpA = new THREE.Color(), tmpB = new THREE.Color(), tmpC = new THREE.Color()
function addScaled(dst: THREE.Color, src: THREE.Color, s: number) {
  dst.r += src.r * s; dst.g += src.g * s; dst.b += src.b * s
}

// ---------- per-frame tick ----------
export function tickSim(dt: number) {
  dt = Math.min(dt, 0.1)
  if (!sim.paused) {
    sim.elapsed += dt
    sim.time = (sim.time + sim.timeSpeed * dt + 24) % 24
  }
  // time tween toward preset time
  if (sim.timeTarget !== null) {
    let d = ((sim.timeTarget - sim.time + 36) % 24) - 12
    const step = dt * Math.max(2, Math.abs(d) / Math.max(0.5, sim.transDuration))
    if (Math.abs(d) < step + 0.001) { sim.time = sim.timeTarget; sim.timeTarget = null }
    else sim.time = (sim.time + Math.sign(d) * step + 24) % 24
  }
  // param transition
  if (sim.transElapsed < sim.transDuration) {
    sim.transElapsed = Math.min(sim.transDuration, sim.transElapsed + dt)
    const t = smoothstep(0, 1, sim.transElapsed / sim.transDuration)
    const p = sim.params, s = sim.start, g = sim.target
    for (const k of Object.keys(p) as (keyof WeatherParams)[]) {
      if (k === 'windDirection') p[k] = lerpAngle(s[k], g[k], t)
      else p[k] = lerp(s[k], g[k], t)
    }
  }
  sim.flash *= Math.exp(-dt * 5)
  if (sim.flash < 0.001) sim.flash = 0
  updateDerived()
}

// ---------- derived ----------
const _sun = new THREE.Vector3()
function sunPos(time: number, s: SeasonInfo, out: THREE.Vector3, offset = 0) {
  const dayLen = s.sunset - s.sunrise
  let x = (((time - s.sunrise) % 24) + 24) % 24 / dayLen + offset
  if (x > 24 / dayLen / 2 + 0.5) x -= 24 / dayLen // center around day
  const elev = Math.sin(x * Math.PI) * s.maxElev * (Math.PI / 180)
  const az = (x - 0.5) * Math.PI * 0.9 // -~81deg (east/left) .. +~81deg (west/right), 0 = behind Fuji
  out.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize()
  return elev * (180 / Math.PI)
}

export function updateDerived() {
  const p = sim.params, d = sim.derived, se = SEASONS[sim.season]
  const elev = sunPos(sim.time, se, d.sunDir)
  d.elevDeg = elev
  const melev = sunPos(sim.time, se, d.moonDir, 0.55) // moon offset path
  d.dayF = smoothstep(-4, 10, elev)
  d.nightF = 1 - smoothstep(-10, 0, elev)
  d.duskF = Math.exp(-((elev - 1) * (elev - 1)) / 60) // peaks near horizon
  const clearness = clamp01(1 - p.cloudCoverage * 0.75)
  const storminess = clamp01(p.cloudCoverage * p.cloudDensity + p.cumulonimbus * 0.5) *
    clamp01(p.rainIntensity + p.snowIntensity + p.lightningFrequency + p.cloudDensity * 0.6)
  // sky palette by elevation
  const kNight = 1 - smoothstep(-8, -2, elev)
  const kDawn = Math.exp(-((elev + 2) * (elev + 2)) / 30)
  const kGold = Math.exp(-((elev - 6) * (elev - 6)) / 60)
  const kDay = smoothstep(4, 18, elev)
  const wSum = kNight + kDawn + kGold + kDay + 1e-5
  tmpA.setRGB(0, 0, 0)
  addScaled(tmpA, NIGHT_TOP, kNight / wSum); addScaled(tmpA, DAWN_TOP, kDawn / wSum)
  addScaled(tmpA, GOLD_TOP, kGold / wSum); addScaled(tmpA, DAY_TOP, kDay / wSum)
  tmpB.setRGB(0, 0, 0)
  addScaled(tmpB, NIGHT_HOR, kNight / wSum); addScaled(tmpB, DAWN_HOR, kDawn / wSum)
  addScaled(tmpB, GOLD_HOR, kGold / wSum); addScaled(tmpB, DAY_HOR, kDay / wSum)
  // overcast/storm blending
  const over = clamp01(p.cloudCoverage * 0.9) * (1 - d.nightF * 0.85)
  tmpC.copy(tmpA).lerp(OVER_TOP, 0.9).lerp(STORM_TOP, storminess)
  d.skyTop.copy(tmpA).lerp(tmpC, over * (0.35 + 0.65 * d.dayF))
  tmpC.copy(tmpB).lerp(OVER_HOR, 0.9).lerp(STORM_HOR, storminess)
  d.skyHorizon.copy(tmpB).lerp(tmpC, over * (0.35 + 0.65 * d.dayF))
  const darken = 1 - storminess * 0.45 * d.dayF
  d.skyTop.multiplyScalar(darken)
  d.skyHorizon.multiplyScalar(darken)
  d.skyGlow.copy(GLOW_HI).lerp(GLOW_LO, clamp01(-elev / 6))
  // fog
  d.fogColor.copy(d.skyHorizon)
  const visFog = (1 - p.visibility) * 0.012
  d.fogDensityFinal = 0.0006 + p.fogDensity * 0.028 + visFog + p.rainIntensity * 0.0035 + p.snowIntensity * 0.004
  // sun light
  const horiz = smoothstep(-2, 8, elev)
  d.sunColor.copy(SUN_WARM).lerp(SUN_LOW, 1 - smoothstep(2, 25, elev))
  d.sunI = p.sunIntensity * clearness * horiz * 2.6
  d.moonI = d.nightF * clamp01(1 - p.cloudCoverage) * Math.max(0, d.moonDir.y) * 0.5
  d.ambientI = 0.06 + d.dayF * (0.35 + 0.45 * clearness) + d.nightF * 0.03 + p.snowCover * 0.06 + sim.flash * 1.6
  d.hemiI = 0.12 + d.dayF * 0.5 * (1 - storminess * 0.5)
  d.starAlpha = clamp01(d.nightF * (1 - p.cloudCoverage * 1.4) * (1 - p.fogDensity * 2) * p.visibility)
  // akafuji: dawn + clear + visible
  d.akafuji = clamp01(kDawn + kGold * 0.5) * clearness * smoothstep(0.5, 0.9, p.fujiVisibility) * (d.sunDir.x < 0.3 ? 1 : 0.4)
  // wind
  d.wind01 = p.windSpeed
  d.windLevel = Math.round(p.windSpeed * 5)
  d.windX = Math.sin(p.windDirection) * p.windSpeed
  d.windZ = -Math.cos(p.windDirection) * p.windSpeed
  // lake
  d.wave = clamp01(p.lakeWave * 0.55 + p.windSpeed * 0.55 + p.rainIntensity * 0.12)
  d.reflectionClarity = clamp01(1 - d.wave * 1.7) * clamp01(1 - p.rainIntensity * 2.5) *
    clamp01(1 - p.snowIntensity * 2) * clamp01(1 - p.fogDensity * 1.6) * clamp01(1 - p.mist * 0.75) *
    smoothstep(0.5, 0.8, p.fujiVisibility)
  d.fujiLevel = Math.round(clamp01(p.fujiVisibility) * 5)
  d.snowLine = clamp01(se.fujiSnowline - p.snowCover * 0.25)
  // fire / lantern
  d.fireStrength = clamp01(1 - p.rainIntensity * 1.6) * clamp01(1 - p.snowIntensity * 0.7)
  d.lanternOn = clamp01(smoothstep(6, -2, elev) + p.fogDensity * 0.3 + storminess * 0.4)
}
