import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import { MeshReflectorMaterial as MeshReflectorMaterialImpl } from '@react-three/drei/materials/MeshReflectorMaterial'
import { sim, WORLD, smoothstep, clamp01, type Quality } from '../engine/sim'
import { useAppStore } from '../stores/appStore'

// ---------------------------------------------------------------- constants

const RIPPLE_COUNTS: Record<Quality, number> = { low: 60, medium: 120, high: 200, ultra: 300 }
const WHITECAP_COUNTS: Record<Quality, number> = { low: 36, medium: 60, high: 90, ultra: 130 }
const MIST_COUNTS: Record<Quality, number> = { low: 2, medium: 3, high: 4, ultra: 4 }
const REFLECTOR_RES: Record<Quality, number> = { low: 256, medium: 512, high: 1024, ultra: 2048 }

const RIPPLE_LIFE = 0.8

// preallocated scratch (never allocate per frame)
const _m4 = new THREE.Matrix4()
const _c = new THREE.Color()
const _dummy = new THREE.Object3D()
const _waterCol = new THREE.Color()
const WATER_DEEP = new THREE.Color('#12262f')
const WATER_NIGHT = new THREE.Color('#030608')

// ---------------------------------------------------------------- procedural textures (module-level lazy singletons, quality independent)

let _normalTex: THREE.DataTexture | null = null
/** Tileable noise-based water normal map (also reused as reflector distortion map). */
function waterNormalTex(): THREE.DataTexture {
  if (_normalTex) return _normalTex
  const S = 128
  const h = new Float32Array(S * S)
  // tileable value noise, 4 octaves
  const octaves = [4, 8, 16, 32]
  const amps = [1.0, 0.55, 0.3, 0.16]
  for (let o = 0; o < octaves.length; o++) {
    const g = octaves[o]!
    const amp = amps[o]!
    const grid = new Float32Array(g * g)
    for (let i = 0; i < grid.length; i++) grid[i] = Math.random()
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = (x / S) * g
        const fy = (y / S) * g
        const x0 = Math.floor(fx) % g, y0 = Math.floor(fy) % g
        const x1 = (x0 + 1) % g, y1 = (y0 + 1) % g
        let tx = fx - Math.floor(fx), ty = fy - Math.floor(fy)
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
        const a = grid[y0 * g + x0]!, b = grid[y0 * g + x1]!
        const c = grid[y1 * g + x0]!, d = grid[y1 * g + x1]!
        h[y * S + x]! += (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * amp
      }
    }
  }
  // height -> normals (wrapped finite differences)
  const data = new Uint8Array(S * S * 4)
  const strength = 2.2
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S
      const ym = (y - 1 + S) % S, yp = (y + 1) % S
      const dx = (h[y * S + xp]! - h[y * S + xm]!) * strength
      const dy = (h[yp * S + x]! - h[ym * S + x]!) * strength
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * S + x) * 4
      data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255)
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 4
  tex.repeat.set(56, 20)
  tex.needsUpdate = true
  _normalTex = tex
  return tex
}

let _foamTex: THREE.CanvasTexture | null = null
function foamTex(): THREE.CanvasTexture {
  if (_foamTex) return _foamTex
  const cv = document.createElement('canvas')
  cv.width = 256; cv.height = 32
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 256, 32)
  // soft central band
  const band = ctx.createLinearGradient(0, 0, 0, 32)
  band.addColorStop(0, 'rgba(255,255,255,0)')
  band.addColorStop(0.45, 'rgba(255,255,255,0.35)')
  band.addColorStop(0.6, 'rgba(255,255,255,0.3)')
  band.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = band
  ctx.fillRect(0, 0, 256, 32)
  // noisy foam blobs
  for (let i = 0; i < 240; i++) {
    const x = Math.random() * 256
    const y = 16 + (Math.random() + Math.random() - 1) * 11
    const r = 1 + Math.random() * 3.5
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(255,255,255,${0.25 + Math.random() * 0.4})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.repeat.set(6, 1)
  _foamTex = tex
  return tex
}

let _capTex: THREE.CanvasTexture | null = null
function whitecapTex(): THREE.CanvasTexture {
  if (_capTex) return _capTex
  const cv = document.createElement('canvas')
  cv.width = 64; cv.height = 32
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 64, 32)
  ctx.save()
  ctx.translate(32, 16)
  ctx.scale(2, 1) // elongated streak
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 15)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  _capTex = tex2(cv)
  return _capTex
}
function tex2(cv: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

let _mistTex: THREE.CanvasTexture | null = null
function mistTex(): THREE.CanvasTexture {
  if (_mistTex) return _mistTex
  const cv = document.createElement('canvas')
  cv.width = 256; cv.height = 64
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 256, 64)
  for (let i = 0; i < 26; i++) {
    const x = 30 + Math.random() * 196
    const y = 22 + Math.random() * 20
    const r = 18 + Math.random() * 30
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(255,255,255,${0.1 + Math.random() * 0.14})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  }
  _mistTex = tex2(cv)
  return _mistTex
}

// ---------------------------------------------------------------- shared geometries / materials (lazy singletons)

let _rippleGeo: THREE.RingGeometry | null = null
function rippleGeo(): THREE.RingGeometry {
  if (_rippleGeo) return _rippleGeo
  const geo = new THREE.RingGeometry(0.55, 1, 20, 3)
  geo.rotateX(-Math.PI / 2) // flat on water (XZ plane)
  // bake radial fade into vertex colors: 0 at inner/outer edges, 1 mid-band
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i))
    const t = clamp01((r - 0.55) / 0.45)
    const f = Math.sin(t * Math.PI)
    colors[i * 3] = f; colors[i * 3 + 1] = f; colors[i * 3 + 2] = f
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  _rippleGeo = geo
  return geo
}

let _rippleMat: THREE.MeshBasicMaterial | null = null
function rippleMat(): THREE.MeshBasicMaterial {
  if (_rippleMat) return _rippleMat
  _rippleMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })
  return _rippleMat
}

let _capGeo: THREE.PlaneGeometry | null = null
function capGeo(): THREE.PlaneGeometry {
  if (_capGeo) return _capGeo
  _capGeo = new THREE.PlaneGeometry(1.8, 0.3)
  _capGeo.rotateX(-Math.PI / 2)
  return _capGeo
}

let _capMat: THREE.MeshBasicMaterial | null = null
function capMat(): THREE.MeshBasicMaterial {
  if (_capMat) return _capMat
  _capMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, alphaMap: whitecapTex(), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })
  return _capMat
}

let _mistMat: THREE.MeshBasicMaterial | null = null
function mistMat(): THREE.MeshBasicMaterial {
  if (_mistMat) return _mistMat
  _mistMat = new THREE.MeshBasicMaterial({
    color: 0xe9eef2, alphaMap: mistTex(), transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide,
  })
  return _mistMat
}

// ---------------------------------------------------------------- water plane (real reflections — sakasa-Fuji)

function Water({ quality }: { quality: Quality }) {
  const matRef = useRef<MeshReflectorMaterialImpl | null>(null)
  const normals = waterNormalTex()
  const blur: [number, number] = quality === 'low' ? [400, 130] : [140, 50]

  useFrame((_, delta) => {
    const m = matRef.current
    if (!m) return
    const dt = Math.min(delta, 0.1)
    const d = sim.derived
    // scroll normal map along wind (water drift is slower than clouds)
    const drift = 0.006 + d.wave * 0.022
    normals.offset.x += (d.windX * 0.05 + drift) * dt
    normals.offset.y += (-d.windZ * 0.05 + drift * 0.55) * dt
    if (normals.offset.x > 10 || normals.offset.x < -10) normals.offset.x %= 1
    if (normals.offset.y > 10 || normals.offset.y < -10) normals.offset.y %= 1
    const ns = 0.05 + d.wave * 0.9
    m.normalScale.set(ns, ns)
    m.distortion = d.wave * 1.2
    m.mixBlur = 0.05 + (1 - d.reflectionClarity) * 4
    m.mixStrength = 3 + 11 * d.reflectionClarity
    m.mirror = 0.5 + d.reflectionClarity * 0.48
    m.roughness = 0.08 + d.wave * 0.6
    // keep the base tint dark so the mirrored Fuji silhouette stays high-contrast
    _waterCol.copy(WATER_DEEP).lerp(d.skyHorizon, 0.1 * d.dayF).lerp(WATER_NIGHT, d.nightF * 0.82)
    m.color.copy(_waterCol)
  })

  const centerZ = (WORLD.SHORE_Z + WORLD.LAKE_FAR_Z) / 2
  const depth = WORLD.SHORE_Z - WORLD.LAKE_FAR_Z
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, WORLD.LAKE_Y, centerZ]} receiveShadow>
      <planeGeometry args={[WORLD.LAKE_HALF_W * 2, depth]} />
      <MeshReflectorMaterial
        ref={matRef}
        resolution={REFLECTOR_RES[quality]}
        blur={blur}
        mirror={0.55}
        mixBlur={1.5}
        mixStrength={5}
        mixContrast={1}
        distortion={0.3}
        distortionMap={normals}
        minDepthThreshold={0.6}
        maxDepthThreshold={1.6}
        depthScale={0}
        normalMap={normals}
        normalScale={[0.2, 0.2]}
        color="#16323f"
        roughness={0.3}
        metalness={0}
      />
    </mesh>
  )
}

// ---------------------------------------------------------------- rain ripples (instanced expanding rings)

function RainRipples({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const st = useMemo(() => ({
    ages: new Float32Array(count).fill(-1), // -1 = dead
    xs: new Float32Array(count),
    zs: new Float32Array(count),
    acc: 0,
  }), [count])

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    _m4.makeScale(0, 0, 0)
    _m4.setPosition(0, WORLD.LAKE_Y, -40)
    _c.setRGB(0, 0, 0)
    for (let i = 0; i < count; i++) { mesh.setMatrixAt(i, _m4); mesh.setColorAt(i, _c) }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [count])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const dt = Math.min(delta, 0.1)
    const d = sim.derived
    const rain = sim.params.rainIntensity
    // spawn
    if (rain > 0.05) {
      st.acc += dt * rain * (count / RIPPLE_LIFE) * 0.9
      let n = Math.floor(st.acc)
      st.acc -= n
      for (let i = 0; i < count && n > 0; i++) {
        if (st.ages[i]! < 0) {
          st.ages[i] = 0
          st.xs[i] = (Math.random() * 2 - 1) * 70
          st.zs[i] = -6 - Math.random() * 74
          n--
        }
      }
    } else st.acc = 0
    // update
    const bright = 0.28 * (0.3 + 0.7 * d.dayF)
    let dirty = false
    for (let i = 0; i < count; i++) {
      const a = st.ages[i]!
      if (a < 0) continue
      const age = a + dt
      dirty = true
      if (age >= RIPPLE_LIFE) {
        st.ages[i] = -1
        _m4.makeScale(0, 0, 0)
        _m4.setPosition(0, WORLD.LAKE_Y, -40)
        mesh.setMatrixAt(i, _m4)
        _c.setRGB(0, 0, 0)
        mesh.setColorAt(i, _c)
        continue
      }
      st.ages[i] = age
      const t = age / RIPPLE_LIFE
      const s = 0.3 + t * 0.9 // ring expands 0.3 -> 1.2 m
      _m4.makeScale(s, 1, s)
      _m4.setPosition(st.xs[i]!, WORLD.LAKE_Y + 0.02, st.zs[i]!)
      mesh.setMatrixAt(i, _m4)
      const alpha = Math.min(1, t * 6) * (1 - t)
      _c.setScalar(alpha * bright)
      mesh.setColorAt(i, _c)
    }
    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  return <instancedMesh ref={meshRef} args={[rippleGeo(), rippleMat(), count]} frustumCulled={false} />
}

// ---------------------------------------------------------------- whitecaps (storm streaks)

function Whitecaps({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    for (let i = 0; i < count; i++) {
      _dummy.position.set(
        (Math.random() * 2 - 1) * 200,
        WORLD.LAKE_Y + 0.06,
        -12 - Math.random() * 228,
      )
      _dummy.rotation.set(0, (Math.random() * 2 - 1) * 0.9, 0)
      const s = 0.6 + Math.random() * 1.2
      _dummy.scale.set(s * (1 + Math.random()), 1, s)
      _dummy.updateMatrix()
      mesh.setMatrixAt(i, _dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [count])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const d = sim.derived
    const k = smoothstep(0.55, 0.95, d.wave)
    const mat = capMat()
    mat.opacity = k * 0.3 * (0.3 + 0.7 * d.dayF)
    mesh.visible = mat.opacity > 0.002
  })

  return <instancedMesh ref={meshRef} args={[capGeo(), capMat(), count]} frustumCulled={false} />
}

// ---------------------------------------------------------------- shore lapping foam

function ShoreFoam() {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const anim = useRef({ off: 0, ph: 0 })

  useFrame((_, delta) => {
    const mesh = meshRef.current, mat = matRef.current
    if (!mesh || !mat) return
    const dt = Math.min(delta, 0.1)
    const d = sim.derived
    const a = anim.current
    a.off += dt * (0.008 + d.wave * 0.035)
    a.ph += dt * (0.7 + d.wave * 1.7)
    foamTex().offset.x = a.off % 1
    mat.opacity = (0.09 + d.wave * 0.5) * (0.35 + 0.65 * d.dayF)
    mesh.position.z = WORLD.SHORE_Z - 0.9 + Math.sin(a.ph) * (0.12 + d.wave * 0.3)
  })

  return (
    <mesh ref={meshRef} rotation-x={-Math.PI / 2} position={[0, WORLD.LAKE_Y + 0.03, WORLD.SHORE_Z - 0.9]}>
      <planeGeometry args={[WORLD.LAKE_HALF_W * 2, 1.8]} />
      <meshBasicMaterial
        ref={matRef}
        color="#dfeaf0"
        alphaMap={foamTex()}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  )
}

// ---------------------------------------------------------------- lake-surface mist

interface MistDef { z: number; w: number; h: number; amp: number; speed: number; phase: number }
const MIST_DEFS: MistDef[] = [
  { z: -28, w: 240, h: 7, amp: 14, speed: 0.05, phase: 0.0 },
  { z: -70, w: 360, h: 10, amp: 20, speed: 0.036, phase: 2.1 },
  { z: -110, w: 460, h: 13, amp: 26, speed: 0.028, phase: 4.2 },
  { z: -148, w: 560, h: 16, amp: 30, speed: 0.021, phase: 5.6 },
]

function LakeMist({ planes }: { planes: number }) {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  const defs = MIST_DEFS.slice(0, planes)

  useFrame(() => {
    const t = sim.elapsed
    const d = sim.derived
    mistMat().opacity = clamp01(sim.params.mist) * 0.5
    for (let i = 0; i < defs.length; i++) {
      const mesh = refs.current[i]
      const def = defs[i]!
      if (!mesh) continue
      mesh.position.x = Math.sin(t * def.speed + def.phase) * def.amp + d.windX * 12
    }
  })

  return (
    <group>
      {defs.map((def, i) => (
        <mesh
          key={i}
          ref={(m: THREE.Mesh | null) => { refs.current[i] = m }}
          position={[0, WORLD.LAKE_Y + def.h * 0.32, def.z]}
          material={mistMat()}
        >
          <planeGeometry args={[def.w, def.h]} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- root

export default function Lake() {
  const quality = useAppStore(s => s.quality)
  return (
    <group key={quality}>
      <Water quality={quality} />
      <RainRipples count={RIPPLE_COUNTS[quality]} />
      <Whitecaps count={WHITECAP_COUNTS[quality]} />
      <ShoreFoam />
      <LakeMist planes={MIST_COUNTS[quality]} />
    </group>
  )
}
