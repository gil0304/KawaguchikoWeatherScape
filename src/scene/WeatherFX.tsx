import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { sim, WORLD, fireLightning, clamp01, lerp, smoothstep, type Quality } from '../engine/sim'
import { useAppStore } from '../stores/appStore'

// ---------------------------------------------------------------- shared

const QIDX: Record<Quality, number> = { low: 0, medium: 1, high: 2, ultra: 3 }
const qi = () => QIDX[sim.quality] ?? 2

const CLOUD_TOTALS = [14, 22, 34, 46]
const RAIN_COUNTS = [400, 900, 1600, 2400]
const SPLASH_COUNTS = [80, 150, 240, 320]
const SNOW_COUNTS = [400, 900, 1600, 2600]

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for(int i = 0; i < 4; i++){ v += a * vnoise(p); p = p * 2.03 + vec2(11.3, 7.7); a *= 0.5; }
  return v;
}
`

const STD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** Instanced quad geometry (unit plane, indexed) with given instance count. */
function instancedPlane(count: number): THREE.InstancedBufferGeometry {
  const base = new THREE.PlaneGeometry(1, 1)
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.getAttribute('position'))
  g.setAttribute('uv', base.getAttribute('uv'))
  g.instanceCount = count
  return g
}

function useDispose(objs: Array<{ dispose: () => void }>) {
  const ref = useRef(objs)
  ref.current = objs
  useEffect(() => () => { for (const o of ref.current) o.dispose() }, [])
}

// preallocated scratch
const _lit = new THREE.Color()
const _base = new THREE.Color()
const _warm = new THREE.Color()
const _colA = new THREE.Color()
const _v3a = new THREE.Vector3()
const _xA = new THREE.Vector3()
const _yA = new THREE.Vector3()
const _zA = new THREE.Vector3()
const _m4 = new THREE.Matrix4()
const NIGHT_LIT = new THREE.Color(0.17, 0.19, 0.26)
const NIGHT_BASE = new THREE.Color(0.045, 0.055, 0.085)
const WHITE = new THREE.Color(1, 1, 1)

/** Cloud lit/base/warm colors for the current frame -> module temps. Returns warm amount. */
function computeCloudColors(density: number): number {
  const d = sim.derived
  const p = sim.params
  const storm = clamp01(p.cloudCoverage * p.cloudDensity + p.cumulonimbus * 0.5)
  _lit.copy(d.sunColor).lerp(d.skyHorizon, 0.45).multiplyScalar(0.55 + 0.65 * d.dayF)
  _lit.lerp(NIGHT_LIT, d.nightF)
  _base.copy(d.skyHorizon).multiplyScalar(0.62 * (1 - 0.42 * density - 0.24 * storm))
  _base.lerp(NIGHT_BASE, d.nightF)
  _warm.set(1.0, 0.52, 0.28).lerp(d.skyGlow, 0.4)
  return d.duskF * 0.8 * (1 - storm * 0.5) * (1 - d.nightF)
}

// ---------------------------------------------------------------- clouds

const CLOUD_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec2 aScale;
attribute float aSeed;
attribute float aFade;
uniform float uHoriz;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main(){
  vUv = uv; vSeed = aSeed; vFade = aFade;
  vec2 off = (uv - 0.5) * aScale;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 bb = aPos + right * off.x + up * off.y;
  vec3 hz = aPos + vec3(off.x, 0.0, -off.y);
  vec3 wp = mix(bb, hz, uHoriz);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

const CLOUD_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
varying float vFade;
uniform float uTime;
uniform float uWarmAmt;
uniform float uFlash;
uniform float uGlobalO;
uniform vec3 uLit;
uniform vec3 uBase;
uniform vec3 uWarm;
${NOISE_GLSL}
void main(){
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float n = fbm(vUv * 3.0 + vec2(vSeed * 19.7, vSeed * 7.3) + vec2(uTime * 0.008, 0.0));
  float shape = smoothstep(1.05, 0.18, r + (n - 0.5) * 1.1);
  float alpha = shape * vFade * uGlobalO;
  if (alpha < 0.004) discard;
  float lit = clamp(vUv.y * 1.25 + (n - 0.5) * 0.6, 0.0, 1.0);
  vec3 col = mix(uBase, uLit, lit);
  col = mix(col, uWarm, uWarmAmt * (1.0 - vUv.y));
  col += vec3(0.5, 0.58, 0.9) * (uFlash * (0.35 + 0.65 * (1.0 - r)));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function makeCloudMaterial(horiz: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uLit: { value: new THREE.Color(1, 1, 1) },
      uBase: { value: new THREE.Color(0.5, 0.5, 0.55) },
      uWarm: { value: new THREE.Color(1, 0.55, 0.3) },
      uWarmAmt: { value: 0 },
      uFlash: { value: 0 },
      uGlobalO: { value: 1 },
      uHoriz: { value: horiz },
    },
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
  })
}

type LayerKind = 'low' | 'mid' | 'high'
interface LayerCfg {
  kind: LayerKind; share: number
  y0: number; y1: number
  sx0: number; sx1: number; sy0: number; sy1: number
  horiz: number; drift: number; baseO: number
}
const LAYERS: LayerCfg[] = [
  { kind: 'low', share: 0.42, y0: 55, y1: 85, sx0: 95, sx1: 165, sy0: 42, sy1: 64, horiz: 0, drift: 1, baseO: 0.92 },
  { kind: 'mid', share: 0.33, y0: 120, y1: 160, sx0: 75, sx1: 120, sy0: 30, sy1: 46, horiz: 0, drift: 0.8, baseO: 0.8 },
  { kind: 'high', share: 0.25, y0: 210, y1: 250, sx0: 170, sx1: 280, sy0: 26, sy1: 46, horiz: 0.82, drift: 0.55, baseO: 0.5 },
]

function layerWeight(kind: LayerKind, h: number): number {
  if (kind === 'low') return 1 - smoothstep(0.28, 0.65, h)
  if (kind === 'mid') return Math.exp(-((h - 0.5) * (h - 0.5)) / 0.09)
  return smoothstep(0.38, 0.78, h)
}

function CloudLayer({ cfg, count }: { cfg: LayerCfg; count: number }) {
  const S = useMemo(() => {
    const geo = instancedPlane(count)
    const pos = new Float32Array(count * 3)
    const scl = new Float32Array(count * 2)
    const seed = new Float32Array(count)
    const fade = new Float32Array(count)
    const spd = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 700
      pos[i * 3 + 1] = lerp(cfg.y0, cfg.y1, Math.random())
      pos[i * 3 + 2] = -800 + Math.random() * 1000
      scl[i * 2] = lerp(cfg.sx0, cfg.sx1, Math.random())
      scl[i * 2 + 1] = lerp(cfg.sy0, cfg.sy1, Math.random())
      seed[i] = Math.random() * 100
      spd[i] = 0.7 + Math.random() * 0.6
    }
    const aPos = new THREE.InstancedBufferAttribute(pos, 3)
    aPos.setUsage(THREE.DynamicDrawUsage)
    const aFade = new THREE.InstancedBufferAttribute(fade, 1)
    aFade.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aPos', aPos)
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scl, 2))
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1))
    geo.setAttribute('aFade', aFade)
    const mat = makeCloudMaterial(cfg.horiz)
    return { geo, mat, pos, fade, spd, aPos, aFade }
  }, [cfg, count])
  useDispose([S.geo, S.mat])

  useFrame((_, dt) => {
    const cdt = Math.min(dt, 0.1)
    const p = sim.params
    const d = sim.derived
    const w = 0.12 + 0.88 * layerWeight(cfg.kind, p.cloudHeight)
    const activeN = clamp01(p.cloudCoverage * 1.25) * w * count
    const v = 5 + p.cloudSpeed * 40
    const vx = d.windX * v * cfg.drift
    const vz = d.windZ * v * cfg.drift
    const k = 1 - Math.exp(-cdt * 0.45)
    const { pos, fade, spd } = S
    for (let i = 0; i < count; i++) {
      let x = pos[i * 3] + vx * spd[i] * cdt
      let z = pos[i * 3 + 2] + vz * spd[i] * cdt
      if (x > 700) x -= 1400
      else if (x < -700) x += 1400
      if (z > 200) z -= 1000
      else if (z < -800) z += 1000
      pos[i * 3] = x
      pos[i * 3 + 2] = z
      fade[i] += (clamp01(activeN - i) - fade[i]) * k
    }
    S.aPos.needsUpdate = true
    S.aFade.needsUpdate = true
    const warmAmt = computeCloudColors(p.cloudDensity)
    const u = S.mat.uniforms
    u.uTime.value = sim.elapsed
    u.uLit.value.copy(_lit)
    u.uBase.value.copy(_base)
    u.uWarm.value.copy(_warm)
    u.uWarmAmt.value = warmAmt
    u.uFlash.value = sim.flash * 0.7
    u.uGlobalO.value = cfg.baseO * (0.45 + 0.55 * p.cloudDensity)
  })

  return <mesh geometry={S.geo} material={S.mat} frustumCulled={false} renderOrder={10} />
}

// ---------------------------------------------------------------- cumulonimbus

// [dx, y, dz, sx, sy] around cluster center
const CB_PUFFS: Array<[number, number, number, number, number]> = [
  [-50, 52, 20, 150, 95],
  [5, 58, -15, 165, 105],
  [55, 55, 10, 140, 90],
  [-30, 108, 5, 125, 85],
  [28, 118, -8, 118, 82],
  [-2, 158, 3, 105, 75],
  [-22, 192, 8, 88, 62],
  [14, 208, -4, 74, 54],
]
const CB_X = -120
const CB_Z = -430

function Cumulonimbus() {
  const count = CB_PUFFS.length
  const meshRef = useRef<THREE.Mesh>(null)
  const S = useMemo(() => {
    const geo = instancedPlane(count)
    const pos = new Float32Array(count * 3)
    const scl = new Float32Array(count * 2)
    const seed = new Float32Array(count)
    const fade = new Float32Array(count)
    const hf = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const [dx, y, dz, sx, sy] = CB_PUFFS[i]
      pos[i * 3] = CB_X + dx
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = CB_Z + dz
      scl[i * 2] = sx
      scl[i * 2 + 1] = sy
      seed[i] = 31.7 * (i + 1)
      hf[i] = y / 208
    }
    const aFade = new THREE.InstancedBufferAttribute(fade, 1)
    aFade.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3))
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scl, 2))
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1))
    geo.setAttribute('aFade', aFade)
    const mat = makeCloudMaterial(0)
    return { geo, mat, fade, aFade }
  }, [count])
  useDispose([S.geo, S.mat])

  useFrame((_, dt) => {
    const cdt = Math.min(dt, 0.1)
    const p = sim.params
    const k = 1 - Math.exp(-cdt * 0.8)
    let maxFade = 0
    const { fade } = S
    for (let i = 0; i < count; i++) {
      const tgt = clamp01(p.cumulonimbus * 1.4 - (CB_PUFFS[i][1] / 208) * 0.38)
      fade[i] += (tgt - fade[i]) * k
      if (fade[i] > maxFade) maxFade = fade[i]
    }
    S.aFade.needsUpdate = true
    const warmAmt = computeCloudColors(Math.max(p.cloudDensity, 0.7))
    const u = S.mat.uniforms
    u.uTime.value = sim.elapsed
    u.uLit.value.copy(_lit).multiplyScalar(0.85)
    u.uBase.value.copy(_base).multiplyScalar(0.7)
    u.uWarm.value.copy(_warm)
    u.uWarmAmt.value = warmAmt * 0.6
    u.uFlash.value = sim.flash * (0.7 + 0.3 * Math.sin(sim.elapsed * 41)) * 1.4
    u.uGlobalO.value = 0.95
    if (meshRef.current) meshRef.current.visible = maxFade > 0.004 || p.cumulonimbus > 0.003
  })

  return <mesh ref={meshRef} geometry={S.geo} material={S.mat} frustumCulled={false} renderOrder={11} />
}

// ---------------------------------------------------------------- rain streaks

const RAIN_VERT = /* glsl */ `
attribute vec3 aOff;
attribute vec2 aRnd;
uniform float uTime;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uLen;
uniform float uWidth;
uniform float uSpeed;
varying vec2 vUv;
varying float vA;
void main(){
  vUv = uv;
  float H = 26.0;
  float fall = uTime * uSpeed * aRnd.x;
  float y = mod(aOff.y - fall, H);
  vec3 base = vec3(uCam.x + aOff.x, uCam.y - 6.0 + y, uCam.z + aOff.z);
  vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));
  vec3 toCam = cameraPosition - base;
  vec3 right = normalize(cross(dir, toCam));
  vec3 wp = base + dir * ((position.y + 0.5) * uLen) + right * (position.x * uWidth);
  vA = (1.0 - smoothstep(12.0, 17.5, length(aOff.xz))) * smoothstep(-1.5, 0.0, base.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

const RAIN_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vA;
uniform float uAlpha;
void main(){
  float g = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
  float w = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
  float a = uAlpha * vA * g * (0.4 + 0.6 * w);
  if (a < 0.003) discard;
  gl_FragColor = vec4(0.62, 0.72, 0.9, a);
}
`

function RainStreaks() {
  const count = RAIN_COUNTS[qi()]
  const meshRef = useRef<THREE.Mesh>(null)
  const S = useMemo(() => {
    const geo = instancedPlane(count)
    const off = new Float32Array(count * 3)
    const rnd = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const r = 18 * Math.sqrt(Math.random())
      const th = Math.random() * Math.PI * 2
      off[i * 3] = Math.cos(th) * r
      off[i * 3 + 1] = Math.random() * 26
      off[i * 3 + 2] = Math.sin(th) * r
      rnd[i * 2] = 0.8 + Math.random() * 0.45
      rnd[i * 2 + 1] = Math.random()
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3))
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 2))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2() },
        uLen: { value: 0.4 },
        uWidth: { value: 0.015 },
        uSpeed: { value: 10 },
        uAlpha: { value: 0 },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
    })
    return { geo, mat }
  }, [count])
  useDispose([S.geo, S.mat])

  useFrame((st) => {
    const p = sim.params
    const d = sim.derived
    const I = p.rainIntensity
    const heavy = smoothstep(0.7, 1, I)
    const u = S.mat.uniforms
    u.uTime.value = sim.elapsed
    u.uCam.value.copy(st.camera.position)
    u.uWind.value.set(d.windX * 1.6, d.windZ * 1.6)
    u.uLen.value = 0.35 + I * 0.5 + heavy * 0.45
    u.uWidth.value = 0.014 + I * 0.012 + heavy * 0.03
    u.uSpeed.value = 9 + I * 5
    const a = smoothstep(0.02, 0.3, I) * (0.1 + 0.24 * I) * (0.45 + 0.55 * d.dayF)
    u.uAlpha.value = a
    if (meshRef.current) meshRef.current.visible = a > 0.0015
  })

  return <mesh ref={meshRef} geometry={S.geo} material={S.mat} frustumCulled={false} renderOrder={30} />
}

// ---------------------------------------------------------------- rain splashes

const SPLASH_VERT = /* glsl */ `
attribute vec2 aSeed;
uniform float uTime;
uniform float uActive;
varying vec2 vUv;
varying float vT;
varying float vOn;
float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
void main(){
  vUv = uv;
  float P = 0.62;
  float ph = uTime / P + aSeed.x * 13.0;
  float cyc = floor(ph);
  float t = fract(ph) * P / 0.34;
  vT = t;
  vOn = step(h1(aSeed.y * 91.7 + cyc * 0.618), uActive) * step(t, 1.0);
  float cx = (h1(cyc * 3.1 + aSeed.x * 57.0) - 0.5) * 46.0;
  float cz = -4.0 + h1(cyc * 7.7 + aSeed.y * 23.0) * 20.0;
  float sz = 0.75 * vOn;
  vec3 wp = vec3(cx + position.x * sz, 0.02, cz - position.y * sz);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

const SPLASH_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vT;
varying float vOn;
uniform float uA;
uniform vec3 uCol;
void main(){
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.3, 0.05, abs(r - vT * 0.85));
  float a = ring * (1.0 - vT) * uA * vOn;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function Splashes() {
  const count = SPLASH_COUNTS[qi()]
  const meshRef = useRef<THREE.Mesh>(null)
  const S = useMemo(() => {
    const geo = instancedPlane(count)
    const seed = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      seed[i * 2] = Math.random()
      seed[i * 2 + 1] = Math.random()
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 2))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uActive: { value: 0 },
        uA: { value: 0 },
        uCol: { value: new THREE.Color(0.75, 0.8, 0.9) },
      },
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
    })
    return { geo, mat }
  }, [count])
  useDispose([S.geo, S.mat])

  useFrame(() => {
    const p = sim.params
    const d = sim.derived
    const I = p.rainIntensity
    const u = S.mat.uniforms
    u.uTime.value = sim.elapsed
    u.uActive.value = clamp01(I * I * 1.35)
    u.uA.value = clamp01(I * 1.2) * 0.32 * (0.35 + 0.65 * d.dayF)
    if (meshRef.current) meshRef.current.visible = I > 0.02
  })

  return <mesh ref={meshRef} geometry={S.geo} material={S.mat} frustumCulled={false} renderOrder={29} />
}

// ---------------------------------------------------------------- far rain veil

const VEIL_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uO;
uniform float uSeed;
uniform vec3 uCol;
${NOISE_GLSL}
void main(){
  float n = fbm(vec2(vUv.x * 90.0 + uSeed, vUv.y * 4.0 - uTime * 0.55));
  float streak = 0.5 + 0.5 * smoothstep(0.35, 0.8, n);
  float ex = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  float ey = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
  float a = uO * streak * ex * ey;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// [width, height, z, yCenter, renderOrder]
const VEILS: Array<[number, number, number, number, number]> = [
  [1600, 360, -240, 110, 13],
  [1300, 300, -160, 92, 15],
  [1000, 240, -80, 72, 18],
]

function RainVeil() {
  const S = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1)
    const mats = VEILS.map((_, i) => new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uO: { value: 0 },
        uSeed: { value: i * 7.31 },
        uCol: { value: new THREE.Color() },
      },
      vertexShader: STD_VERT,
      fragmentShader: VEIL_FRAG,
    }))
    return { geo, mats }
  }, [])
  useDispose([S.geo, ...S.mats])
  const meshRefs = useRef<Array<THREE.Mesh | null>>([])

  useFrame(() => {
    const p = sim.params
    const d = sim.derived
    const o = p.rainIntensity * 0.35 + p.snowIntensity * 0.2
    _colA.copy(d.fogColor).lerp(WHITE, 0.25)
    for (let i = 0; i < S.mats.length; i++) {
      const u = S.mats[i].uniforms
      u.uTime.value = sim.elapsed
      u.uO.value = o
      u.uCol.value.copy(_colA)
      const m = meshRefs.current[i]
      if (m) m.visible = o > 0.002
    }
  })

  return (
    <>
      {VEILS.map(([w, h, z, yc, ro], i) => (
        <mesh
          key={i}
          ref={(m) => { meshRefs.current[i] = m }}
          geometry={S.geo}
          material={S.mats[i]}
          position={[0, yc, z]}
          scale={[w, h, 1]}
          frustumCulled={false}
          renderOrder={ro}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------- snow

const SNOW_VERT = /* glsl */ `
attribute vec3 aOff;
attribute vec3 aRnd;
uniform float uTime;
uniform vec3 uCam;
uniform vec2 uWind;
uniform float uFall;
uniform float uSize;
varying vec2 vUv;
varying float vA;
void main(){
  vUv = uv;
  float R = 18.0;
  float H = 22.0;
  float fall = uTime * uFall * aRnd.y;
  vec3 pos = aOff + vec3(uWind.x * uTime, -fall, uWind.y * uTime);
  pos.x += sin(uTime * (1.1 + aRnd.y) + aRnd.z * 6.2831) * 0.45;
  pos.z += cos(uTime * (0.9 + aRnd.x) + aRnd.z * 4.71) * 0.4;
  float wx = mod(pos.x + R, 2.0 * R) - R;
  float wy = mod(pos.y, H);
  float wz = mod(pos.z + R, 2.0 * R) - R;
  vec3 base = vec3(uCam.x + wx, uCam.y - 4.0 + wy, uCam.z + wz);
  vA = (1.0 - smoothstep(13.0, 17.5, length(vec2(wx, wz)))) * smoothstep(-1.0, 0.2, base.y);
  float s = uSize * aRnd.x;
  vec2 off = (uv - 0.5) * s;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = base + right * off.x + up * off.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`

const SNOW_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vA;
uniform float uA;
uniform vec3 uCol;
void main(){
  float r = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.35, r) * uA * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function Snowfall() {
  const count = SNOW_COUNTS[qi()]
  const meshRef = useRef<THREE.Mesh>(null)
  const S = useMemo(() => {
    const geo = instancedPlane(count)
    const off = new Float32Array(count * 3)
    const rnd = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      off[i * 3] = (Math.random() * 2 - 1) * 18
      off[i * 3 + 1] = Math.random() * 22
      off[i * 3 + 2] = (Math.random() * 2 - 1) * 18
      rnd[i * 3] = 0.65 + Math.random() * 0.75
      rnd[i * 3 + 1] = 0.7 + Math.random() * 0.6
      rnd[i * 3 + 2] = Math.random()
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3))
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 3))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2() },
        uFall: { value: 1 },
        uSize: { value: 0.08 },
        uA: { value: 0 },
        uCol: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
    })
    return { geo, mat }
  }, [count])
  useDispose([S.geo, S.mat])

  useFrame((st) => {
    const p = sim.params
    const d = sim.derived
    const sI = p.snowIntensity
    const tempF = smoothstep(-9, -1, p.temperature) // 1 near 0 degC -> botan-yuki
    const u = S.mat.uniforms
    u.uTime.value = sim.elapsed
    u.uCam.value.copy(st.camera.position)
    const m = 2 + d.wind01 * 18
    u.uWind.value.set(d.windX * m, d.windZ * m)
    u.uFall.value = lerp(1.6, 0.65, tempF)
    u.uSize.value = lerp(0.05, 0.13, tempF)
    const a = smoothstep(0.02, 0.25, sI) * (0.45 + 0.45 * sI)
    u.uA.value = a
    u.uCol.value.setRGB(0.92, 0.94, 1).multiplyScalar(0.3 + 0.7 * d.dayF + 0.15 * d.nightF)
    if (meshRef.current) meshRef.current.visible = a > 0.0015
  })

  return <mesh ref={meshRef} geometry={S.geo} material={S.mat} frustumCulled={false} renderOrder={30} />
}

// ---------------------------------------------------------------- layered fog banks

const FOG_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uO;
uniform float uSeed;
uniform float uFlash;
uniform vec3 uCol;
${NOISE_GLSL}
void main(){
  vec2 q = vec2(vUv.x * 6.0 + uSeed, vUv.y * 2.2);
  float n = fbm(q + vec2(uTime * 0.008, uTime * 0.0025));
  float top = smoothstep(1.0, 0.35, vUv.y + (n - 0.5) * 0.55);
  float bot = smoothstep(0.0, 0.18, vUv.y);
  float sx = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
  float a = uO * top * bot * sx * (0.45 + 0.55 * n);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uCol * (1.0 + uFlash * 0.35), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// [width, height, yCenter, z, threshold, renderOrder]
const FOG_BANKS: Array<[number, number, number, number, number, number]> = [
  [700, 55, 12, -60, 0.52, 19],
  [900, 70, 16, -100, 0.4, 17],
  [1100, 85, 20, -150, 0.3, 16],
  [1300, 100, 24, -200, 0.2, 14],
  [1600, 130, 30, -260, 0.1, 12],
]

function FogBanks() {
  const S = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1)
    const mats = FOG_BANKS.map((_, i) => new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uO: { value: 0 },
        uSeed: { value: i * 4.17 },
        uFlash: { value: 0 },
        uCol: { value: new THREE.Color() },
      },
      vertexShader: STD_VERT,
      fragmentShader: FOG_FRAG,
    }))
    return { geo, mats }
  }, [])
  useDispose([S.geo, ...S.mats])
  const meshRefs = useRef<Array<THREE.Mesh | null>>([])

  useFrame(() => {
    const p = sim.params
    const d = sim.derived
    const fogAmount = clamp01(p.fogDensity * 1.3 + (1 - p.visibility) * 0.8)
    _colA.copy(d.fogColor).lerp(WHITE, 0.12)
    for (let i = 0; i < FOG_BANKS.length; i++) {
      const th = FOG_BANKS[i][4]
      const o = smoothstep(th, th + 0.5, fogAmount) * 0.72
      const u = S.mats[i].uniforms
      u.uTime.value = sim.elapsed
      u.uO.value = o
      u.uFlash.value = sim.flash
      u.uCol.value.copy(_colA)
      const m = meshRefs.current[i]
      if (m) m.visible = o > 0.002
    }
  })

  return (
    <>
      {FOG_BANKS.map(([w, h, yc, z, , ro], i) => (
        <mesh
          key={i}
          ref={(m) => { meshRefs.current[i] = m }}
          geometry={S.geo}
          material={S.mats[i]}
          position={[0, yc, z]}
          scale={[w, h, 1]}
          frustumCulled={false}
          renderOrder={ro}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------- god rays

const RAY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uO;
uniform float uSeed;
uniform vec3 uCol;
${NOISE_GLSL}
void main(){
  float ax = smoothstep(0.0, 0.38, vUv.x) * smoothstep(1.0, 0.62, vUv.x);
  float ay = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
  float n = 0.7 + 0.3 * vnoise(vec2(vUv.x * 5.0 + uSeed, vUv.y * 2.0 - uTime * 0.03));
  float a = uO * ax * ay * n;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uCol, a);
}
`

// [baseX, baseZ, width]
const RAYS: Array<[number, number, number]> = [
  [-75, -100, 10],
  [-25, -150, 14],
  [30, -185, 12],
  [85, -125, 9],
]
const RAY_LEN = 160

function GodRays() {
  const S = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1)
    const mats = RAYS.map((_, i) => new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uO: { value: 0 },
        uSeed: { value: i * 3.77 },
        uCol: { value: new THREE.Color() },
      },
      vertexShader: STD_VERT,
      fragmentShader: RAY_FRAG,
    }))
    return { geo, mats }
  }, [])
  useDispose([S.geo, ...S.mats])
  const meshRefs = useRef<Array<THREE.Mesh | null>>([])
  const oRef = useRef(0)

  useFrame((st, dt) => {
    const cdt = Math.min(dt, 0.1)
    const p = sim.params
    const d = sim.derived
    const cc = p.cloudCoverage
    const win = smoothstep(0.22, 0.32, cc) * (1 - smoothstep(0.68, 0.78, cc))
    const tgt = smoothstep(0.3, 0.45, d.dayF) * win *
      (1 - smoothstep(0.04, 0.1, p.rainIntensity)) *
      (1 - smoothstep(0.15, 0.4, p.fogDensity)) *
      smoothstep(0.08, 0.18, d.sunDir.y)
    oRef.current += (tgt - oRef.current) * (1 - Math.exp(-cdt * 0.5))
    const base = oRef.current * 0.12
    _colA.copy(d.sunColor).lerp(WHITE, 0.4)
    _yA.copy(d.sunDir).normalize()
    for (let i = 0; i < RAYS.length; i++) {
      const mesh = meshRefs.current[i]
      const u = S.mats[i].uniforms
      const o = base * (0.55 + 0.45 * Math.sin(sim.elapsed * 0.1 + i * 2.1))
      u.uTime.value = sim.elapsed
      u.uO.value = o
      u.uCol.value.copy(_colA)
      if (!mesh) continue
      mesh.visible = o > 0.0015
      if (!mesh.visible) continue
      const bx = RAYS[i][0] + Math.sin(sim.elapsed * 0.02 + i * 1.9) * 18
      _v3a.set(bx, WORLD.LAKE_Y, RAYS[i][1]).addScaledVector(_yA, RAY_LEN * 0.5)
      mesh.position.copy(_v3a)
      _zA.copy(st.camera.position).sub(_v3a)
      _xA.crossVectors(_yA, _zA)
      if (_xA.lengthSq() < 1e-6) _xA.set(1, 0, 0)
      _xA.normalize()
      _zA.crossVectors(_xA, _yA).normalize()
      _m4.makeBasis(_xA, _yA, _zA)
      mesh.quaternion.setFromRotationMatrix(_m4)
      mesh.scale.set(RAYS[i][2], RAY_LEN, 1)
    }
  })

  return (
    <>
      {RAYS.map((_, i) => (
        <mesh
          key={i}
          ref={(m) => { meshRefs.current[i] = m }}
          geometry={S.geo}
          material={S.mats[i]}
          frustumCulled={false}
          renderOrder={28}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------- lightning

const _boltPos = new THREE.Vector3()
const _distV = new THREE.Vector3()

function buildBolt(arr: Float32Array, x: number, topY: number, z: number, groundY: number): number {
  let n = 0
  const put = (px: number, py: number, pz: number) => {
    arr[n * 3] = px; arr[n * 3 + 1] = py; arr[n * 3 + 2] = pz; n++
  }
  const SEG = 14
  const tx: number[] = []
  const ty: number[] = []
  const tz: number[] = []
  let cx = x
  let cz = z
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG
    ty.push(lerp(topY, groundY, t))
    if (i > 0) {
      const amp = 15 * (1 - t * 0.45)
      cx += (Math.random() - 0.5) * amp
      cz += (Math.random() - 0.5) * amp * 0.5
    }
    tx.push(cx)
    tz.push(cz)
  }
  for (let i = 0; i < SEG; i++) {
    put(tx[i], ty[i], tz[i])
    put(tx[i + 1], ty[i + 1], tz[i + 1])
  }
  const nBranch = 2 + Math.floor(Math.random() * 2)
  for (let b = 0; b < nBranch; b++) {
    const ai = 3 + Math.floor(Math.random() * (SEG - 6))
    let bx = tx[ai]
    let by = ty[ai]
    let bz = tz[ai]
    const dxs = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 5)
    for (let s2 = 0; s2 < 5; s2++) {
      const nx = bx + dxs * (1 - s2 * 0.12) + (Math.random() - 0.5) * 6
      const ny = by - (8 + Math.random() * 10)
      const nz = bz + (Math.random() - 0.5) * 6
      put(bx, by, bz)
      put(nx, ny, nz)
      bx = nx; by = ny; bz = nz
      if (by < groundY + 5) break
    }
  }
  return n
}

const pulse = (x: number, c: number, w: number) => Math.exp(-((x - c) * (x - c)) / (w * w))

function Lightning() {
  const lineRef = useRef<THREE.LineSegments>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const S = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const arr = new Float32Array(256 * 3)
    const attr = new THREE.BufferAttribute(arr, 3)
    attr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', attr)
    geo.setDrawRange(0, 0)
    const mat = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    mat.color.setRGB(2.4, 2.9, 4.2) // >1 so it blooms
    return { geo, mat, arr, attr }
  }, [])
  useDispose([S.geo, S.mat])
  const st = useRef({ acc: 0, jit: 1, active: false, t: 0, dur: 0.2 })

  useFrame((_, dt) => {
    const cdt = Math.min(dt, 0.1)
    const p = sim.params
    const L = st.current

    // scheduling
    if (!sim.paused && p.lightningFrequency > 0.02) {
      const interval = lerp(20, 2.2, clamp01(p.lightningFrequency)) * L.jit
      L.acc += cdt / interval
      if (L.acc >= 1) {
        L.acc = 0
        L.jit = 0.45 + Math.random() * 1.3
        // strike
        const near = Math.random() < lerp(0.12, 0.65, clamp01(p.lightningFrequency))
        let x: number, z: number, topY: number, groundY: number
        if (near) {
          x = (Math.random() * 2 - 1) * 140
          z = -150 - Math.random() * 200
          topY = 150 + Math.random() * 40
          groundY = WORLD.LAKE_Y
        } else {
          x = (Math.random() * 2 - 1) * 400
          z = -500 - Math.random() * 300
          topY = 180 + Math.random() * 40
          groundY = 0
        }
        const nPts = buildBolt(S.arr, x, topY, z, groundY)
        S.attr.needsUpdate = true
        S.geo.setDrawRange(0, nPts)
        _boltPos.set(x, 35, z)
        const dist = _distV.set(x, 0, z).distanceTo(WORLD.CAM_START)
        fireLightning(dist, _boltPos)
        L.active = true
        L.t = 0
        L.dur = 0.15 + Math.random() * 0.1
      }
    } else if (L.acc > 0.5) {
      L.acc = 0.5
    }

    // bolt visual flicker
    if (L.active) {
      L.t += cdt
      if (L.t >= L.dur) {
        L.active = false
        S.mat.opacity = 0
      } else {
        const k = L.t / L.dur
        S.mat.opacity = Math.min(1, pulse(k, 0.06, 0.09) + 0.85 * pulse(k, 0.45, 0.1) + 0.6 * pulse(k, 0.8, 0.12))
      }
    }
    if (lineRef.current) lineRef.current.visible = L.active && S.mat.opacity > 0.01

    // local illumination, decays with sim.flash (global lighting is handled by sky module)
    const light = lightRef.current
    if (light) {
      light.position.copy(sim.flashPos)
      light.intensity = sim.flash * sim.flash * 5200
    }
  })

  return (
    <>
      <lineSegments ref={lineRef} geometry={S.geo} material={S.mat} frustumCulled={false} renderOrder={31} visible={false} />
      <pointLight ref={lightRef} color="#dfe6ff" intensity={0} distance={600} decay={2} />
    </>
  )
}

// ---------------------------------------------------------------- root

export default function WeatherFX() {
  const quality = useAppStore(s => s.quality) // remount on quality change re-reads counts
  const total = CLOUD_TOTALS[qi()]
  return (
    <group key={quality}>
      {LAYERS.map(cfg => (
        <CloudLayer key={cfg.kind} cfg={cfg} count={Math.max(2, Math.round(total * cfg.share))} />
      ))}
      <Cumulonimbus />
      <RainStreaks />
      <Splashes />
      <RainVeil />
      <Snowfall />
      <FogBanks />
      <GodRays />
      <Lightning />
    </group>
  )
}
