import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { sim, WORLD, SEASONS, clamp01, smoothstep, type Season, type Quality } from '../engine/sim'
import { useAppStore } from '../stores/appStore'

// ============================================================================
// Mt. Fuji + background ridges + opposite shore.
//
// NOTE on footprint: a circular base of radius FUJI_RADIUS (190) centered at
// z = -320 would reach z = -130, i.e. protrude ~170 units into the lake and
// bury the far shore (-295). The heightfield is therefore built in a circular
// domain (so the front silhouette seen from the camera is the exact
// h = H*(1-r/R)^1.55 profile, full width 2*R in x) and then squashed in z:
// the front foot lands at z ~ -299 (just behind FAR_SHORE_Z), the back extends
// to z ~ -438. Vertex normals are computed BEFORE the squash so the mountain
// is lit like the true circular cone (correct akafuji side lighting).
// ============================================================================

const R = WORLD.FUJI_RADIUS
const H = WORLD.FUJI_HEIGHT
const S_FRONT = 0.11 // z-squash factor on the camera side (foot at z ~ -299)
const S_BACK = 0.62 // z-squash factor on the far side

const SEG: Record<Quality, number> = { low: 56, medium: 72, high: 96, ultra: 128 }
const PUFF_N: Record<Quality, number> = { low: 4, medium: 5, high: 6, ultra: 6 }
const GREENS: Record<Season, number> = { spring: 0.5, summer: 0.6, autumn: 0.28, winter: 0.12 }

// preallocated temps (never allocate in useFrame)
const _c1 = new THREE.Color()
const WHITE = new THREE.Color(1, 1, 1)
const AKA_PINK = new THREE.Color(1.0, 0.55, 0.42)
const _summit = new THREE.Vector3(WORLD.FUJI_POS.x, WORLD.FUJI_POS.y + H * 0.92, WORLD.FUJI_POS.z)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- Fuji heightfield ----------
function fujiY(rn: number, ang: number): number {
  const p0 = Math.pow(Math.max(0, 1 - rn), 1.55)
  // flattened summit cap
  const w = smoothstep(0.88, 0.98, p0)
  const p = p0 * (1 - w) + (0.93 + (p0 - 0.93) * 0.5) * w
  let y = H * p
  const t = Math.max(0, 1 - rn)
  // angular ridges / gullies, fading at the summit and at the base
  const ridge =
    Math.sin(ang * 7 + 1.3) * 0.5 + Math.sin(ang * 13 + 4.1) * 0.3 + Math.sin(ang * 23 + 2.2) * 0.2
  const amp = H * 0.02 * Math.pow(t, 0.85) * (1 - Math.pow(t, 5))
  y += ridge * amp * (0.75 + 0.25 * Math.sin(rn * 11 + ang * 2))
  // broad low-frequency undulation of the skirt
  y += H * 0.014 * Math.sin(ang * 2 + 0.6) * Math.sqrt(t) * (1 - t)
  // crater dip + jagged rim
  y -= H * 0.042 * Math.exp(-(rn * rn) / 0.002)
  y += H * 0.006 * Math.sin(ang * 9 + 2.0) * Math.exp(-((rn - 0.06) * (rn - 0.06)) / 0.0016)
  // sink the outer edge below shore/water so no rim line shows
  y -= 1.6 * smoothstep(0.9, 1.0, rn)
  return y
}

function buildFujiGeometry(seg: number): THREE.BufferGeometry {
  const rings = seg
  const sectors = seg
  const count = (rings + 1) * sectors
  const pos = new Float32Array(count * 3)
  for (let ir = 0; ir <= rings; ir++) {
    const rn = ir / rings
    for (let is = 0; is < sectors; is++) {
      const ang = (is / sectors) * Math.PI * 2
      const i3 = (ir * sectors + is) * 3
      pos[i3] = Math.cos(ang) * rn * R
      pos[i3 + 1] = fujiY(rn, ang)
      pos[i3 + 2] = Math.sin(ang) * rn * R
    }
  }
  const idx = new Uint32Array(rings * sectors * 6)
  let k = 0
  for (let ir = 0; ir < rings; ir++) {
    for (let is = 0; is < sectors; is++) {
      const is2 = (is + 1) % sectors
      const a = ir * sectors + is
      const b = ir * sectors + is2
      const c = (ir + 1) * sectors + is
      const d2 = (ir + 1) * sectors + is2
      idx[k++] = a; idx[k++] = b; idx[k++] = c
      idx[k++] = b; idx[k++] = d2; idx[k++] = c
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals() // circular-cone normals (before squash) — intentional
  const pa = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pa.count; i++) {
    const zc = pa.getZ(i)
    const u = zc / R
    const s = S_BACK + (S_FRONT - S_BACK) * smoothstep(-0.35, 0.35, u)
    pa.setZ(i, zc * s)
  }
  pa.needsUpdate = true
  g.computeBoundingSphere()
  return g
}

// ---------- Fuji material (MeshStandardMaterial + injected uniforms) ----------
interface FujiUniforms {
  uSnowLine: { value: number }
  uAkafuji: { value: number }
  uVisFade: { value: number }
  uFogColor: { value: THREE.Color }
  uSunDir: { value: THREE.Vector3 }
  uBaseTint: { value: THREE.Color }
  uSeasonGreen: { value: number }
}

function makeFujiMaterial(uni: FujiUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: '#4a4a52', roughness: 0.97, metalness: 0 })
  const Hs = H.toFixed(1)
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uni)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vFujiPos;\nvarying vec3 vFujiNrm;'
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvFujiNrm = objectNormal;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFujiPos = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vFujiPos;
varying vec3 vFujiNrm;
uniform float uSnowLine;
uniform float uAkafuji;
uniform float uVisFade;
uniform vec3 uFogColor;
uniform vec3 uSunDir;
uniform vec3 uBaseTint;
uniform float uSeasonGreen;
float kwsSnow = 0.0;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float hf = clamp(vFujiPos.y / ${Hs}, 0.0, 1.0);
  vec3 fnrm = normalize(vFujiNrm);
  float fang = atan(vFujiPos.z, vFujiPos.x);
  // noisy snow boundary + more snow on flatter slopes
  float nse = sin(fang * 13.0 + hf * 21.0) * 0.5 + sin(fang * 29.0 + 3.0 + hf * 15.0) * 0.3
            + sin(fang * 53.0 - hf * 37.0) * 0.2;
  float flatB = smoothstep(0.55, 0.95, fnrm.y) * 0.06;
  float snowLn = uSnowLine + nse * 0.04;
  kwsSnow = smoothstep(snowLn - 0.03, snowLn + 0.07, hf + flatB);
  // rock, with faint seasonal forest tint near the base
  float baseM = (1.0 - smoothstep(0.03, 0.30, hf)) * uSeasonGreen;
  vec3 col = mix(diffuseColor.rgb, uBaseTint, baseM);
  col *= 0.94 + 0.06 * sin(fang * 41.0 + hf * 63.0) * sin(fang * 17.0 - hf * 29.0);
  col = mix(col, vec3(0.83, 0.87, 0.94), kwsSnow);
  diffuseColor.rgb = col;
}`
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
{
  // akafuji: warm the sunlit flank (strongest on snow) before tone mapping
  vec3 anrm = normalize(vFujiNrm);
  float sl = pow(clamp(dot(anrm, uSunDir), 0.0, 1.0), 1.3);
  vec3 akaC = vec3(1.05, 0.38, 0.18) * (0.45 + 0.75 * kwsSnow);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, akaC, clamp(uAkafuji * sl * 0.8, 0.0, 1.0));
}`
      )
      .replace(
        '#include <fog_fragment>',
        `// fixed distance haze + fujiVisibility melt into the fog/sky color
gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, 0.25);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, uVisFade);
#include <fog_fragment>`
      )
  }
  m.customProgramCacheKey = () => 'kws-fuji-1'
  return m
}

// ---------- kasagumo (lens cloud) shader ----------
interface KasaUniforms {
  uOpacity: { value: number }
  uTime: { value: number }
  uColor: { value: THREE.Color }
  uFogColor: { value: THREE.Color }
  uFogMix: { value: number }
}

const KASA_VERT = /* glsl */ `
varying vec3 vPosL;
varying vec3 vNv;
varying vec3 vVdir;
void main() {
  vPosL = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNv = normalize(normalMatrix * normal);
  vVdir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`

const KASA_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogMix;
varying vec3 vPosL;
varying vec3 vNv;
varying vec3 vVdir;
void main() {
  float rim = abs(dot(normalize(vNv), normalize(vVdir)));
  float a = smoothstep(0.18, 0.72, rim);
  a *= 0.82 + 0.18 * sin(vPosL.y * 6.0 - uTime * 0.35);
  a *= 0.85 + 0.15 * sin(vPosL.x * 3.1 + uTime * 0.22) * sin(vPosL.z * 3.7 - uTime * 0.19);
  float alpha = a * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uFogColor, uFogMix), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

// ---------- soft puff sprite texture ----------
function makePuffTexture(rand: () => number): THREE.CanvasTexture {
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = S; cv.height = S
  const ctx = cv.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, S, S)
    for (let i = 0; i < 11; i++) {
      const a = rand() * Math.PI * 2
      const rr = rand() * 0.24 * S
      const cx = S / 2 + Math.cos(a) * rr * 1.2
      const cy = S / 2 + Math.sin(a) * rr * 0.5
      const br = S * (0.12 + rand() * 0.13)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, br)
      g.addColorStop(0, 'rgba(255,255,255,0.5)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, S, S)
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// ---------- silhouette strips (ridges / treeline) ----------
function silhouetteStrip(
  width: number, cols: number, topFn: (nx: number) => number, bottomY: number
): THREE.BufferGeometry {
  const pos = new Float32Array((cols + 1) * 2 * 3)
  const idx: number[] = []
  for (let i = 0; i <= cols; i++) {
    const f = i / cols
    const x = (f - 0.5) * width
    const j = i * 6
    pos[j] = x; pos[j + 1] = topFn(f * 2 - 1); pos[j + 2] = 0
    pos[j + 3] = x; pos[j + 4] = bottomY; pos[j + 5] = 0
  }
  for (let i = 0; i < cols; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

function ridgeProfile(nx: number, seed: number): number {
  return (
    (Math.sin(nx * 6.3 + seed) * 0.5 +
      Math.sin(nx * 11.7 + seed * 2.1) * 0.3 +
      Math.sin(nx * 19.1 + seed * 3.7) * 0.2 + 1) * 0.5
  )
}

// ---------- rig ----------
interface PuffData {
  spr: THREE.Sprite
  mat: THREE.SpriteMaterial
  ang: number
  rad: number
  y0: number
  ph: number
  spd: number
}
interface RidgeData { mat: THREE.MeshBasicMaterial; base: THREE.Color; fogK: number }

interface Rig {
  group: THREE.Group
  uni: FujiUniforms
  puffs: PuffData[]
  kasaGroup: THREE.Group
  kasaMeshes: THREE.Mesh[]
  kasaBase: THREE.Vector3[]
  kasaUni: KasaUniforms
  ridges: RidgeData[]
  treeMat: THREE.MeshBasicMaterial
  treeBase: THREE.Color
  bldgMat: THREE.MeshBasicMaterial
  bldgBase: THREE.Color
  lightsMat: THREE.PointsMaterial
  boat: THREE.Group
  boatMat: THREE.MeshBasicMaterial
  boatBase: THREE.Color
  boatX: number
  disposables: Array<{ dispose(): void }>
}

function buildRig(quality: Quality): Rig {
  const rand = mulberry32(1337)
  const group = new THREE.Group()
  const disposables: Array<{ dispose(): void }> = []

  // --- Mt. Fuji ---
  const uni: FujiUniforms = {
    uSnowLine: { value: 0.8 },
    uAkafuji: { value: 0 },
    uVisFade: { value: 0 },
    uFogColor: { value: new THREE.Color('#bcd8ee') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uBaseTint: { value: new THREE.Color('#3f7d33') },
    uSeasonGreen: { value: 0.5 },
  }
  const fujiGeo = buildFujiGeometry(SEG[quality])
  const fujiMat = makeFujiMaterial(uni)
  const fuji = new THREE.Mesh(fujiGeo, fujiMat)
  fuji.position.copy(WORLD.FUJI_POS)
  fuji.receiveShadow = false
  fuji.castShadow = false
  group.add(fuji)
  disposables.push(fujiGeo, fujiMat)

  // --- summit cloud band (soft sprites wrapped around 55-75% height) ---
  const puffTex = makePuffTexture(rand)
  disposables.push(puffTex)
  const puffGroup = new THREE.Group()
  puffGroup.position.copy(WORLD.FUJI_POS)
  const puffs: PuffData[] = []
  const n = PUFF_N[quality]
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({
      map: puffTex, transparent: true, depthWrite: false, opacity: 0,
    })
    const spr = new THREE.Sprite(mat)
    spr.scale.set(38 + rand() * 24, 15 + rand() * 9, 1)
    spr.renderOrder = 20
    const p: PuffData = {
      spr, mat,
      ang: (i / n) * Math.PI * 2 + rand() * 0.8,
      rad: 42 + rand() * 20,
      y0: H * (0.55 + rand() * 0.2),
      ph: rand() * Math.PI * 2,
      spd: 0.6 + rand() * 0.8,
    }
    puffGroup.add(spr)
    puffs.push(p)
    disposables.push(mat)
  }
  group.add(puffGroup)

  // --- kasagumo: stacked flattened discs above the summit ---
  const kasaUni: KasaUniforms = {
    uOpacity: { value: 0 },
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) },
    uFogColor: { value: new THREE.Color('#bcd8ee') },
    uFogMix: { value: 0 },
  }
  const kasaMat = new THREE.ShaderMaterial({
    uniforms: kasaUni as unknown as Record<string, THREE.IUniform>,
    vertexShader: KASA_VERT,
    fragmentShader: KASA_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  })
  const kasaGeo = new THREE.SphereGeometry(1, quality === 'low' ? 18 : 28, quality === 'low' ? 12 : 16)
  disposables.push(kasaMat, kasaGeo)
  const kasaGroup = new THREE.Group()
  kasaGroup.position.copy(WORLD.FUJI_POS)
  const kasaBase = [
    new THREE.Vector3(46, 7, 30),
    new THREE.Vector3(34, 5.2, 22),
    new THREE.Vector3(23, 4, 15),
  ]
  const kasaOffsets = [
    new THREE.Vector3(2, 96, 0),
    new THREE.Vector3(-3, 102, 2),
    new THREE.Vector3(1, 107.5, -1),
  ]
  const kasaMeshes: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(kasaGeo, kasaMat)
    const off = kasaOffsets[i]
    const bs = kasaBase[i]
    if (off) m.position.copy(off)
    if (bs) m.scale.copy(bs)
    m.renderOrder = 21
    kasaGroup.add(m)
    kasaMeshes.push(m)
  }
  group.add(kasaGroup)

  // --- background ridges ---
  const ridgeDefs: Array<{
    w: number; h: number; x: number; z: number; seed: number; dip: number
    base: string; fogK: number
  }> = [
    { w: 1000, h: 26, x: 0, z: -305, seed: 2.3, dip: 0.55, base: '#3a453d', fogK: 0.35 },
    { w: 1250, h: 40, x: -140, z: -332, seed: 5.1, dip: 0.15, base: '#39434c', fogK: 0.5 },
    { w: 1450, h: 54, x: 170, z: -358, seed: 8.7, dip: 0.0, base: '#3c4650', fogK: 0.62 },
  ]
  const ridges: RidgeData[] = []
  for (const rd of ridgeDefs) {
    const geo = silhouetteStrip(rd.w, 160, nx => {
      const env = 1 - nx * nx * 0.6
      let hh = rd.h * env * (0.5 + 0.5 * ridgeProfile(nx, rd.seed))
      hh *= 1 - rd.dip * Math.exp(-(nx * nx) / 0.05)
      return Math.max(0.5, hh)
    }, -6)
    const mat = new THREE.MeshBasicMaterial({ color: rd.base, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(rd.x, 0, rd.z)
    group.add(mesh)
    ridges.push({ mat, base: new THREE.Color(rd.base), fogK: rd.fogK })
    disposables.push(geo, mat)
  }

  // --- opposite shore ---
  const shore = new THREE.Group()
  // treeline band
  const treeGeo = silhouetteStrip(WORLD.LAKE_HALF_W * 2, 256, nx => {
    return (
      1.6 +
      1.1 * (0.5 + 0.5 * Math.sin(nx * 61 + 1.7)) +
      0.7 * (0.5 + 0.5 * Math.sin(nx * 137 + 4.2)) +
      0.5 * (0.5 + 0.5 * Math.sin(nx * 211))
    )
  }, -1.2)
  const treeBase = new THREE.Color('#16211a')
  const treeMat = new THREE.MeshBasicMaterial({ color: treeBase, side: THREE.DoubleSide })
  const treeline = new THREE.Mesh(treeGeo, treeMat)
  treeline.position.set(0, 0, WORLD.FAR_SHORE_Z)
  shore.add(treeline)
  disposables.push(treeGeo, treeMat)

  // tiny building silhouettes (instanced boxes)
  const unitBox = new THREE.BoxGeometry(1, 1, 1)
  const bldgBase = new THREE.Color('#242a33')
  const bldgMat = new THREE.MeshBasicMaterial({ color: bldgBase })
  const N_B = 9
  const bldg = new THREE.InstancedMesh(unitBox, bldgMat, N_B)
  bldg.frustumCulled = false
  const dummy = new THREE.Object3D()
  const bx: number[] = []
  const bh: number[] = []
  for (let i = 0; i < N_B; i++) {
    let x = 0
    for (let tries = 0; tries < 20; tries++) {
      x = (rand() * 2 - 1) * 270
      if (Math.abs(x) > 25) break
    }
    const hgt = 1.4 + rand() * 2.4
    bx.push(x); bh.push(hgt)
    dummy.position.set(x, hgt / 2 - 0.3, WORLD.FAR_SHORE_Z + 2)
    dummy.scale.set(2.2 + rand() * 3.4, hgt, 2)
    dummy.rotation.set(0, 0, 0)
    dummy.updateMatrix()
    bldg.setMatrixAt(i, dummy.matrix)
  }
  bldg.instanceMatrix.needsUpdate = true
  shore.add(bldg)
  disposables.push(unitBox, bldgMat)

  // warm window/street lights (visible at night, bloom faintly)
  const N_L = 15
  const lp = new Float32Array(N_L * 3)
  for (let i = 0; i < N_L; i++) {
    const near = bx[i % N_B] ?? 0
    lp[i * 3] = near + (rand() * 2 - 1) * 3
    lp[i * 3 + 1] = 0.3 + rand() * Math.max(0.6, (bh[i % N_B] ?? 1.5) - 0.4)
    lp[i * 3 + 2] = WORLD.FAR_SHORE_Z + 2.6
  }
  const lightsGeo = new THREE.BufferGeometry()
  lightsGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3))
  const lightsMat = new THREE.PointsMaterial({
    size: 1.3, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false,
  })
  lightsMat.color.setRGB(2.2, 1.4, 0.6)
  const lights = new THREE.Points(lightsGeo, lightsMat)
  shore.add(lights)
  disposables.push(lightsGeo, lightsMat)

  // tiny distant boat
  const boatBase = new THREE.Color('#0d1116')
  const boatMat = new THREE.MeshBasicMaterial({ color: boatBase })
  const boat = new THREE.Group()
  const hull = new THREE.Mesh(unitBox, boatMat)
  hull.scale.set(3, 0.5, 1)
  const cabin = new THREE.Mesh(unitBox, boatMat)
  cabin.scale.set(1, 0.55, 0.7)
  cabin.position.set(-0.4, 0.5, 0)
  boat.add(hull, cabin)
  const boatX = rand() * 160 - 80
  boat.position.set(boatX, WORLD.LAKE_Y + 0.12, -266)
  boat.rotation.y = 0.3
  shore.add(boat)
  disposables.push(boatMat)

  group.add(shore)

  return {
    group, uni, puffs, kasaGroup, kasaMeshes, kasaBase, kasaUni,
    ridges, treeMat, treeBase, bldgMat, bldgBase, lightsMat,
    boat, boatMat, boatBase, boatX, disposables,
  }
}

// ---------- component ----------
export default function Fuji() {
  const quality = useAppStore(s => s.quality)
  const rig = useMemo(() => buildRig(quality), [quality])
  const seasonRef = useRef<{ season: Season | null; tgt: THREE.Color; green: number }>({
    season: null, tgt: new THREE.Color('#3f7d33'), green: 0.5,
  })

  useEffect(() => {
    return () => {
      for (const d of rig.disposables) d.dispose()
    }
  }, [rig])

  useFrame((state, dt) => {
    const d = sim.derived
    const p = sim.params
    const t = sim.elapsed
    // --- Fuji uniforms ---
    const uni = rig.uni
    uni.uSnowLine.value = d.snowLine
    uni.uAkafuji.value = d.akafuji
    uni.uVisFade.value = 1 - clamp01(p.fujiVisibility)
    uni.uFogColor.value.copy(d.fogColor)
    uni.uSunDir.value.copy(d.sunDir)
    // seasonal base tint (damped so season switches never pop)
    const sr = seasonRef.current
    if (sr.season !== sim.season) {
      sr.season = sim.season
      sr.tgt.set(SEASONS[sim.season].foliage)
      sr.green = GREENS[sim.season]
    }
    const k = 1 - Math.exp(-dt * 1.2)
    uni.uBaseTint.value.lerp(sr.tgt, k)
    uni.uSeasonGreen.value += (sr.green - uni.uSeasonGreen.value) * k

    // --- summit cloud band: strongest at mid fujiVisibility ---
    const band =
      smoothstep(0.03, 0.3, p.fujiVisibility) * (1 - smoothstep(0.55, 0.92, p.fujiVisibility))
    _c1.copy(d.fogColor).lerp(WHITE, 0.35 * d.dayF)
    for (const pf of rig.puffs) {
      pf.ang += dt * (0.015 + 0.05 * d.wind01) * pf.spd
      pf.spr.position.set(
        Math.cos(pf.ang) * pf.rad,
        pf.y0 + Math.sin(t * 0.22 + pf.ph) * 1.6,
        Math.sin(pf.ang) * pf.rad * 0.55
      )
      pf.mat.opacity = band * (0.55 + 0.3 * Math.sin(t * 0.17 + pf.ph * 3.1))
      pf.mat.color.copy(_c1)
    }

    // --- kasagumo ---
    const ku = rig.kasaUni
    ku.uTime.value = t
    ku.uOpacity.value = clamp01(p.kasagumo) * smoothstep(0.12, 0.5, p.fujiVisibility) * 0.85
    const dist = state.camera.position.distanceTo(_summit)
    const ff = d.fogDensityFinal * dist
    ku.uFogMix.value = clamp01(1 - Math.exp(-ff * ff))
    ku.uFogColor.value.copy(d.fogColor)
    ku.uColor.value
      .copy(d.fogColor)
      .lerp(WHITE, 0.5 * d.dayF + 0.15 * d.duskF)
      .lerp(AKA_PINK, d.akafuji * 0.5)
    rig.kasaGroup.rotation.y += dt * 0.04
    rig.kasaGroup.visible = ku.uOpacity.value > 0.002
    for (let i = 0; i < rig.kasaMeshes.length; i++) {
      const m = rig.kasaMeshes[i]
      const b = rig.kasaBase[i]
      if (!m || !b) continue
      m.scale.set(
        b.x * (1 + 0.05 * Math.sin(t * 0.13 + i * 2.1)),
        b.y,
        b.z * (1 + 0.05 * Math.sin(t * 0.11 + i * 1.3))
      )
    }

    // --- ridges + shore silhouettes (unlit: shade by daylight, tint by fog) ---
    const lum = 0.18 + 0.82 * d.dayF + sim.flash * 0.6
    for (const r of rig.ridges) r.mat.color.copy(r.base).multiplyScalar(lum).lerp(d.fogColor, r.fogK)
    rig.treeMat.color
      .copy(rig.treeBase).multiplyScalar(0.1 + 0.9 * d.dayF + sim.flash * 0.7)
      .lerp(d.fogColor, 0.22)
    rig.bldgMat.color
      .copy(rig.bldgBase).multiplyScalar(0.15 + 0.85 * d.dayF + sim.flash * 0.7)
      .lerp(d.fogColor, 0.28)
    rig.boatMat.color
      .copy(rig.boatBase).multiplyScalar(0.15 + 0.85 * d.dayF + sim.flash * 0.7)
      .lerp(d.fogColor, 0.3)

    // --- window lights: on at night, warm, > 1 so they bloom faintly ---
    rig.lightsMat.opacity = clamp01(d.nightF * 1.1)
    rig.lightsMat.color.setRGB(2.2, 1.4, 0.6).multiplyScalar(0.2 + 0.8 * d.nightF)

    // --- boat drift + bob ---
    rig.boat.position.x = rig.boatX + Math.sin(t * 0.011) * 45
    rig.boat.position.y = WORLD.LAKE_Y + 0.12 + Math.sin(t * 0.8 + 2) * 0.05 * (0.3 + d.wave * 1.4)
    rig.boat.rotation.z = Math.sin(t * 0.9) * 0.05 * (0.2 + d.wave)
  })

  return <primitive object={rig.group} />
}
