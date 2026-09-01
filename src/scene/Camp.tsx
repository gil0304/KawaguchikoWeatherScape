import * as THREE from 'three'
import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { sim, SEASONS, WORLD, smoothstep, type Quality } from '../engine/sim'
import { useAppStore } from '../stores/appStore'
import {
  updateCampUniforms, makeCampMaterial, mulberry32,
  PUDDLES, groundHeight, makeSwayMaterial, crossedQuads,
  makeFlameMaterial, makeSoftTexture,
} from './campHelpers'

// ---------- shared geometries ----------
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cylThin: new THREE.CylinderGeometry(1, 1, 1, 5),
  ico: new THREE.IcosahedronGeometry(1, 0),
  dod: new THREE.DodecahedronGeometry(1, 0),
  cone: new THREE.ConeGeometry(1, 1, 8),
  sph: new THREE.SphereGeometry(1, 10, 8),
}

// ---------- shared materials (updated per frame in the central updater) ----------
const MAT = {
  ground: makeCampMaterial({ color: '#5e8a42', roughness: 0.95 }),
  gravel: makeCampMaterial({ color: '#726c62', roughness: 0.98, vertexColors: true }),
  wood: makeCampMaterial({ color: '#7a5638', roughness: 0.85, flatShading: true }),
  woodDark: makeCampMaterial({ color: '#54402a', roughness: 0.9, flatShading: true }),
  plank: makeCampMaterial({ color: '#8a6b48', roughness: 0.8 }),
  stone: makeCampMaterial({ color: '#7d7a74', roughness: 0.95, flatShading: true }),
  tent: makeCampMaterial({ color: '#3f7a78', roughness: 0.75, cloth: 0.7, side: THREE.DoubleSide }),
  tentDark: makeCampMaterial({ color: '#1e3a39', roughness: 0.85, side: THREE.DoubleSide }),
  tarp: makeCampMaterial({ color: '#4a6d5c', roughness: 0.75, cloth: 1, side: THREE.DoubleSide }),
  rope: makeCampMaterial({ color: '#cbbfa4', roughness: 0.9 }),
  metal: makeCampMaterial({ color: '#8f979e', roughness: 0.45, metalness: 0.6 }),
  cooler: makeCampMaterial({ color: '#3a6ea8', roughness: 0.6 }),
  coolerLid: makeCampMaterial({ color: '#e6e6e2', roughness: 0.6 }),
  mug: makeCampMaterial({ color: '#b8452e', roughness: 0.55 }),
  boat: makeCampMaterial({ color: '#4a5a66', roughness: 0.8, flatShading: true }),
  deciduous: makeCampMaterial({ color: '#3f7d33', roughness: 0.9, flatShading: true }),
  sakura: makeCampMaterial({ color: '#86b45f', roughness: 0.9, flatShading: true }),
  evergreen: makeCampMaterial({ color: '#2f5a33', roughness: 0.9, flatShading: true }),
  bush: makeCampMaterial({ color: '#4a7a3a', roughness: 0.9, flatShading: true }),
  charcoal: makeCampMaterial({ color: '#26221f', roughness: 1, flatShading: true }),
}

const grassMat = makeSwayMaterial('#5e9440', '#e8dcc0', 2)
const susukiMat = makeSwayMaterial('#9c8a55', '#e9ddc2', 0.68)

const GRASS_COUNT: Record<Quality, number> = { low: 600, medium: 1500, high: 3000, ultra: 5000 }

// keep-out check for vegetation scatter (gear area, deck, pier, fire, puddles)
function scatterOk(x: number, z: number): boolean {
  if (x > -7.5 && x < 8.2 && z > 0.2 && z < 9.8) return false
  if (x > -5.2 && x < -1.6 && z > -4.9 && z < -2.0) return false
  if (x > 8.4 && x < 11.6 && z < -3.5) return false
  for (const p of PUDDLES) {
    const dx = x - p.x, dz = z - p.z
    if (dx * dx + dz * dz < 1.8) return false
  }
  return true
}

// ---------- central per-frame updater (uniforms + seasonal colors) ----------
const colGrass = new THREE.Color(), colFoliage = new THREE.Color(), colSakura = new THREE.Color()
const colGround = new THREE.Color(), colBush = new THREE.Color()
const PINK = new THREE.Color('#e8a8bd')
let lastSeason = ''
// smoothed unlit-material base colors (sway shaders ignore scene lights, so we bake lighting in)
const grassBase = new THREE.Color('#5e9440'), susukiBase = new THREE.Color('#9c8a55')
const grassPlume = new THREE.Color('#e8dcc0'), susukiPlume = new THREE.Color('#e9ddc2')

function CentralUpdater() {
  useFrame((_, dt) => {
    updateCampUniforms()
    if (sim.season !== lastSeason) {
      lastSeason = sim.season
      const se = SEASONS[sim.season]
      colGrass.set(se.grass)
      colFoliage.set(se.foliage)
      colSakura.copy(se.sakura > 0 ? PINK : colFoliage)
      colGround.copy(colGrass).multiplyScalar(0.82)
      colBush.copy(colFoliage).lerp(colGrass, 0.4)
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 1.6)
    MAT.ground.color.lerp(colGround, k)
    MAT.deciduous.color.lerp(colFoliage, k)
    MAT.sakura.color.lerp(colSakura, k)
    MAT.bush.color.lerp(colBush, k)
    grassBase.lerp(colGrass, k)
    // unlit sway shaders: modulate by scene light so grass never glows in storms / at night
    const d = sim.derived
    const lightF = Math.min(1.15, 0.08 + d.ambientI * 0.85 + d.sunI * 0.1)
    grassMat.uniforms.uColor.value.copy(grassBase).multiplyScalar(lightF)
    grassMat.uniforms.uColorB.value.copy(grassPlume).multiplyScalar(lightF)
    susukiMat.uniforms.uColor.value.copy(susukiBase).multiplyScalar(lightF)
    susukiMat.uniforms.uColorB.value.copy(susukiPlume).multiplyScalar(lightF)
    const su = susukiMat.uniforms.uScaleY
    su.value += (SEASONS[sim.season].susuki - su.value) * k
  })
  return null
}

// ---------- ground + gravel ----------
function Ground() {
  const { groundGeo, gravelGeo } = useMemo(() => {
    const g = new THREE.PlaneGeometry(64, 30, 96, 48)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, 7)
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)))
    }
    g.computeVertexNormals()

    const gv = new THREE.PlaneGeometry(64, 2.8, 64, 4)
    gv.rotateX(-Math.PI / 2)
    gv.translate(0, 0, -4.7)
    const gp = gv.attributes.position as THREE.BufferAttribute
    const rng = mulberry32(41)
    const cols = new Float32Array(gp.count * 3)
    for (let i = 0; i < gp.count; i++) {
      gp.setY(i, groundHeight(gp.getX(i), gp.getZ(i)) + 0.02)
      const v = 0.75 + rng() * 0.5
      cols[i * 3] = v; cols[i * 3 + 1] = v; cols[i * 3 + 2] = v
    }
    gv.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    gv.computeVertexNormals()
    return { groundGeo: g, gravelGeo: gv }
  }, [])
  return (
    <group>
      <mesh geometry={groundGeo} material={MAT.ground} receiveShadow />
      <mesh geometry={gravelGeo} material={MAT.gravel} receiveShadow />
    </group>
  )
}

// ---------- puddles ----------
const puddleGeo = new THREE.CircleGeometry(1, 24)
function Puddles() {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: '#9db8cc', metalness: 0.85, roughness: 0.06,
      transparent: true, opacity: 0, envMapIntensity: 2.5,
    })
    return m
  }, [])
  const refs = useRef<(THREE.Mesh | null)[]>([])
  useFrame(() => {
    const w = smoothstep(0.35, 0.9, sim.params.wetness)
    mat.opacity = w
    mat.color.copy(sim.derived.skyHorizon)
    mat.visible = w > 0.01
    const f = 0.55 + 0.45 * w
    for (let i = 0; i < PUDDLES.length; i++) {
      const m = refs.current[i]
      if (m) m.scale.set(PUDDLES[i].rx * f, PUDDLES[i].rz * f, 1)
    }
  })
  return (
    <group>
      {PUDDLES.map((p, i) => (
        <mesh
          key={i}
          ref={el => { refs.current[i] = el }}
          geometry={puddleGeo}
          material={mat}
          position={[p.x, groundHeight(p.x, p.z) + 0.045, p.z]}
          rotation={[-Math.PI / 2, 0, p.rot]}
        />
      ))}
    </group>
  )
}

// ---------- grass field (instanced crossed quads) ----------
function GrassField({ count }: { count: number }) {
  const mesh = useMemo(() => {
    const geo = crossedQuads([{ w: 0.34, y0: 0, y1: 0.34 }], 0.34)
    const rng = mulberry32(7)
    const phases = new Float32Array(count)
    const im = new THREE.InstancedMesh(geo, grassMat, count)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
    const pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0
      for (let a = 0; a < 12; a++) {
        x = (rng() - 0.5) * 60
        z = -3.2 + rng() * 23.2
        if (scatterOk(x, z)) break
      }
      pv.set(x, groundHeight(x, z) - 0.02, z)
      q.setFromAxisAngle(up, rng() * Math.PI)
      const s = 0.7 + rng() * 0.7
      sc.set(s, s, s)
      m4.compose(pv, q, sc)
      im.setMatrixAt(i, m4)
      phases[i] = rng() * Math.PI * 2
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
    im.instanceMatrix.needsUpdate = true
    im.frustumCulled = false
    return im
  }, [count])
  useEffect(() => () => { mesh.geometry.dispose() }, [mesh])
  return <primitive object={mesh} />
}

// ---------- susuki (pampas grass) near the shore ----------
function SusukiField({ count }: { count: number }) {
  const mesh = useMemo(() => {
    const geo = crossedQuads(
      [{ w: 0.12, y0: 0, y1: 1.5 }, { w: 0.38, y0: 1.26, y1: 1.78 }], 1.78
    )
    const rng = mulberry32(23)
    const phases = new Float32Array(count)
    const im = new THREE.InstancedMesh(geo, susukiMat, count)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
    const pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const x = side * (9 + rng() * 19)
      const z = -5.4 + rng() * 3.6
      pv.set(x, groundHeight(x, z) - 0.02, z)
      q.setFromAxisAngle(up, rng() * Math.PI)
      const s = 0.75 + rng() * 0.5
      sc.set(s, s, s)
      m4.compose(pv, q, sc)
      im.setMatrixAt(i, m4)
      phases[i] = rng() * Math.PI * 2
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
    im.instanceMatrix.needsUpdate = true
    im.frustumCulled = false
    return im
  }, [count])
  useEffect(() => () => { mesh.geometry.dispose() }, [mesh])
  return <primitive object={mesh} />
}

// ---------- trees ----------
interface TreeSpec { x: number; z: number; kind: 'deciduous' | 'sakura' | 'evergreen'; seed: number }
const TREES: TreeSpec[] = [
  { x: -11.5, z: 4.5, kind: 'deciduous', seed: 1.3 },
  { x: -9, z: 11.5, kind: 'sakura', seed: 3.7 },
  { x: 12.5, z: 8.5, kind: 'evergreen', seed: 5.1 },
  { x: 14.5, z: 2, kind: 'deciduous', seed: 2.2 },
]

function Tree({ spec }: { spec: TreeSpec }) {
  const canopy = useRef<THREE.Group>(null)
  const scaleRef = useRef(1)
  useFrame((_, dt) => {
    const c = canopy.current
    if (!c) return
    const d = sim.derived
    const t = sim.elapsed
    c.rotation.z = Math.sin(t * (0.8 + d.wind01 * 2.2) + spec.seed) * 0.022 * (0.15 + d.wind01)
    c.rotation.x = Math.sin(t * (0.6 + d.wind01 * 1.8) + spec.seed * 2.1) * 0.015 * (0.15 + d.wind01)
    if (spec.kind !== 'evergreen') {
      const target = sim.season === 'winter' ? 0.05 : 1
      scaleRef.current += (target - scaleRef.current) * Math.min(1, dt * 1.2)
      c.scale.setScalar(scaleRef.current)
    }
  })
  const y = groundHeight(spec.x, spec.z)
  const foliageMat = spec.kind === 'evergreen' ? MAT.evergreen : spec.kind === 'sakura' ? MAT.sakura : MAT.deciduous
  return (
    <group position={[spec.x, y, spec.z]} rotation={[0, spec.seed, 0]}>
      <mesh geometry={GEO.cyl} material={MAT.woodDark} position={[0, 1.1, 0]} scale={[0.16, 2.2, 0.16]} castShadow />
      {spec.kind !== 'evergreen' && (
        <group>
          <mesh geometry={GEO.cylThin} material={MAT.woodDark} position={[0.35, 2.5, 0.1]} rotation={[0.15, 0, -0.7]} scale={[0.045, 1.1, 0.045]} castShadow />
          <mesh geometry={GEO.cylThin} material={MAT.woodDark} position={[-0.3, 2.6, -0.1]} rotation={[-0.1, 0, 0.6]} scale={[0.04, 1, 0.04]} castShadow />
          <mesh geometry={GEO.cylThin} material={MAT.woodDark} position={[0, 2.7, 0.3]} rotation={[0.6, 0, 0.05]} scale={[0.035, 0.9, 0.035]} castShadow />
        </group>
      )}
      <group ref={canopy} position={[0, 2.5, 0]}>
        {spec.kind === 'evergreen' ? (
          <group position={[0, -0.6, 0]}>
            <mesh geometry={GEO.cone} material={foliageMat} position={[0, 0.7, 0]} scale={[1.5, 1.6, 1.5]} castShadow />
            <mesh geometry={GEO.cone} material={foliageMat} position={[0, 1.7, 0]} scale={[1.15, 1.4, 1.15]} castShadow />
            <mesh geometry={GEO.cone} material={foliageMat} position={[0, 2.6, 0]} scale={[0.8, 1.2, 0.8]} castShadow />
          </group>
        ) : (
          <group>
            <mesh geometry={GEO.ico} material={foliageMat} position={[0, 0.25, 0]} scale={[1.35, 1.15, 1.35]} castShadow />
            <mesh geometry={GEO.ico} material={foliageMat} position={[0.75, -0.15, 0.35]} scale={0.85} castShadow />
            <mesh geometry={GEO.ico} material={foliageMat} position={[-0.65, -0.05, -0.3]} scale={0.75} castShadow />
          </group>
        )}
      </group>
    </group>
  )
}

// ---------- rocks + bushes ----------
function RocksAndBushes() {
  const rocks = useMemo(() => {
    const spots: [number, number, number, number][] = [
      [-7.5, -3.2, 0.45, 0.2], [7.2, -2.6, 0.35, 1.1], [-13, 0.5, 0.55, 2.3],
      [16, 6, 0.5, 0.7], [-16, 8, 0.4, 1.9], [6.5, 12, 0.35, 0.4],
      [-6.8, 14, 0.45, 2.8], [12, -3.8, 0.3, 1.5],
    ]
    const im = new THREE.InstancedMesh(GEO.dod, MAT.stone, spots.length)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler()
    const pv = new THREE.Vector3(), sc = new THREE.Vector3()
    spots.forEach(([x, z, s, r], i) => {
      pv.set(x, groundHeight(x, z) + s * 0.35, z)
      e.set(r * 0.4, r, r * 0.2)
      q.setFromEuler(e)
      sc.set(s * 1.15, s * 0.7, s)
      m4.compose(pv, q, sc)
      im.setMatrixAt(i, m4)
    })
    im.instanceMatrix.needsUpdate = true
    im.castShadow = true
    return im
  }, [])
  const bushes: [number, number, number][] = [
    [-8.5, 7.5, 0.6], [10, 5.5, 0.5], [-14.5, 12, 0.75], [15.5, 11, 0.6], [-7, -0.5, 0.45],
  ]
  return (
    <group>
      <primitive object={rocks} />
      {bushes.map(([x, z, s], i) => (
        <mesh key={i} geometry={GEO.ico} material={MAT.bush}
          position={[x, groundHeight(x, z) + s * 0.5, z]}
          scale={[s, s * 0.7, s]} rotation={[0, i * 1.7, 0]} castShadow />
      ))}
    </group>
  )
}

// ---------- tent ----------
const tentGeo = new THREE.SphereGeometry(1.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
const doorGeo = new THREE.CircleGeometry(0.5, 12)
function Tent() {
  const y = groundHeight(-4.6, 2.6)
  return (
    <group position={[-4.6, y - 0.02, 2.6]} rotation={[0, 2.55, 0]}>
      <mesh geometry={tentGeo} material={MAT.tent} scale={[1, 1.19, 1]} castShadow />
      <mesh geometry={doorGeo} material={MAT.tentDark} position={[0, 0.52, 1.25]} rotation={[-0.29, 0, 0]} scale={[0.62, 1, 1]} />
      <mesh geometry={puddleGeo} material={MAT.tentDark} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.5, 1.5, 1]} />
    </group>
  )
}

// ---------- tarp on 2 poles with 4 guy ropes ----------
const tarpGeo = new THREE.PlaneGeometry(3, 3.5, 8, 8)
tarpGeo.rotateX(-Math.PI / 2)
function Rope({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    const len = dir.length()
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    const pos = a.add(b).multiplyScalar(0.5)
    return { pos, quat, len }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <mesh geometry={GEO.cylThin} material={MAT.rope} position={pos} quaternion={quat} scale={[0.013, len, 0.013]} />
}

function TarpSet() {
  const y = groundHeight(5.6, 3.2)
  const wob = useRef<THREE.Group>(null)
  useFrame(() => {
    const g = wob.current
    if (g) g.rotation.z = Math.sin(sim.elapsed * 2.7) * 0.012 * sim.derived.wind01
  })
  return (
    <group position={[5.6, y, 3.2]} rotation={[0, 0.25, 0]}>
      <group ref={wob}>
        <mesh geometry={tarpGeo} material={MAT.tarp} position={[0, 2.2, 0]} rotation={[0.06, 0, 0.05]} castShadow />
      </group>
      <mesh geometry={GEO.cyl} material={MAT.metal} position={[0, 1.1, -1.72]} scale={[0.035, 2.2, 0.035]} castShadow />
      <mesh geometry={GEO.cyl} material={MAT.metal} position={[0, 1.1, 1.72]} scale={[0.035, 2.2, 0.035]} castShadow />
      <Rope from={[-1.5, 2.16, -1.7]} to={[-2.7, 0, -3]} />
      <Rope from={[1.5, 2.16, -1.7]} to={[2.7, 0, -3]} />
      <Rope from={[-1.5, 2.16, 1.7]} to={[-2.7, 0, 3]} />
      <Rope from={[1.5, 2.16, 1.7]} to={[2.7, 0, 3]} />
    </group>
  )
}

// ---------- table + mugs + lantern ----------
function TableSet() {
  const y = groundHeight(1.6, 6.4)
  const lampMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#3a3230', roughness: 0.5 })
    m.emissive.set('#ffb36b')
    return m
  }, [])
  const light = useRef<THREE.PointLight>(null)
  useFrame(() => {
    const d = sim.derived, t = sim.elapsed
    const flick = 0.9 + 0.1 * Math.sin(t * 9.3) + 0.06 * Math.sin(t * 17.1 + 1.2)
    lampMat.emissiveIntensity = d.lanternOn * (2 + flick * 0.3)
    if (light.current) light.current.intensity = d.lanternOn * (0.6 + d.nightF * 1.6) * flick
  })
  return (
    <group position={[1.6, y, 6.4]} rotation={[0, 0.12, 0]}>
      <mesh geometry={GEO.box} material={MAT.plank} position={[0, 0.66, 0]} scale={[1.25, 0.06, 0.72]} castShadow />
      {[[-0.55, -0.28], [0.55, -0.28], [-0.55, 0.28], [0.55, 0.28]].map(([lx, lz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MAT.metal} position={[lx, 0.32, lz]} scale={[0.03, 0.64, 0.03]} />
      ))}
      <mesh geometry={GEO.cyl} material={MAT.mug} position={[0.35, 0.74, 0.12]} scale={[0.055, 0.1, 0.055]} castShadow />
      <mesh geometry={GEO.cyl} material={MAT.mug} position={[0.18, 0.74, -0.18]} scale={[0.055, 0.1, 0.055]} castShadow />
      <group position={[-0.38, 0.69, 0.05]}>
        <mesh geometry={GEO.cyl} material={MAT.charcoal} position={[0, 0.015, 0]} scale={[0.09, 0.03, 0.09]} />
        <mesh geometry={GEO.sph} material={lampMat} position={[0, 0.13, 0]} scale={0.075} />
        <mesh geometry={GEO.cyl} material={MAT.metal} position={[0, 0.24, 0]} scale={[0.06, 0.025, 0.06]} />
        <mesh geometry={GEO.cyl} material={MAT.metal} position={[0, 0.13, 0]} scale={[0.012, 0.22, 0.012]} />
        <pointLight ref={light} color="#ffb36b" position={[0, 0.16, 0]} intensity={0} distance={8} decay={2} />
      </group>
    </group>
  )
}

// ---------- camp chair (faces -z / the lake) ----------
function Chair({ x, z, rot }: { x: number; z: number; rot: number }) {
  const y = groundHeight(x, z)
  return (
    <group position={[x, y, z]} rotation={[0, rot, 0]}>
      <mesh geometry={GEO.box} material={MAT.tent} position={[0, 0.34, 0]} scale={[0.5, 0.05, 0.45]} castShadow />
      <mesh geometry={GEO.box} material={MAT.tent} position={[0, 0.62, 0.25]} rotation={[0.35, 0, 0]} scale={[0.5, 0.55, 0.05]} castShadow />
      {[[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.19], [0.21, 0.19]].map(([lx, lz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MAT.metal} position={[lx, 0.17, lz]} scale={[0.022, 0.34, 0.022]} />
      ))}
    </group>
  )
}

// ---------- cooler / firewood ----------
function Cooler() {
  const y = groundHeight(4.6, 5.8)
  return (
    <group position={[4.6, y, 5.8]} rotation={[0, -0.4, 0]}>
      <mesh geometry={GEO.box} material={MAT.cooler} position={[0, 0.2, 0]} scale={[0.56, 0.4, 0.36]} castShadow />
      <mesh geometry={GEO.box} material={MAT.coolerLid} position={[0, 0.44, 0]} scale={[0.6, 0.09, 0.4]} castShadow />
    </group>
  )
}

function Firewood() {
  const y = groundHeight(3.4, 2.2)
  const logs: [number, number][] = [[0.08, -0.16], [0.08, 0], [0.08, 0.16], [0.22, -0.08], [0.22, 0.08], [0.36, 0]]
  return (
    <group position={[3.4, y, 2.2]} rotation={[0, 0.5, 0]}>
      {logs.map(([ly, lz], i) => (
        <mesh key={i} geometry={GEO.cyl} material={MAT.wood} position={[0, ly, lz]}
          rotation={[0, 0, Math.PI / 2]} scale={[0.075, 0.55, 0.075]} castShadow />
      ))}
    </group>
  )
}

// ---------- deck + pier + rowboat ----------
function Deck() {
  const y = Math.max(groundHeight(-3.4, -3.6), -0.15)
  return (
    <group position={[-3.4, y, -3.6]} rotation={[0, 0.06, 0]}>
      <mesh geometry={GEO.box} material={MAT.woodDark} position={[-1.1, 0.1, 0]} scale={[0.16, 0.12, 2.3]} />
      <mesh geometry={GEO.box} material={MAT.woodDark} position={[1.1, 0.1, 0]} scale={[0.16, 0.12, 2.3]} />
      {[0, 1, 2, 3, 4, 5].map(i => (
        <mesh key={i} geometry={GEO.box} material={MAT.plank} position={[0, 0.2, -1.05 + i * 0.42]}
          scale={[2.6, 0.07, 0.38]} castShadow receiveShadow />
      ))}
    </group>
  )
}

function Pier() {
  const boat = useRef<THREE.Group>(null)
  useFrame(() => {
    const b = boat.current
    if (!b) return
    const t = sim.elapsed
    b.position.y = WORLD.LAKE_Y + 0.14 + Math.sin(t * 1.3) * 0.02 * (0.3 + sim.derived.wave)
    b.rotation.z = Math.sin(t * 1.1 + 0.7) * 0.03 * (0.3 + sim.derived.wave)
  })
  const posts: number[] = [-6.5, -9, -11.5, -14]
  return (
    <group>
      <group position={[10, 0, 0]}>
        {posts.map((pz, i) => (
          <group key={i}>
            <mesh geometry={GEO.cyl} material={MAT.woodDark} position={[-0.6, -0.5, pz]} scale={[0.09, 1.75, 0.09]} />
            <mesh geometry={GEO.cyl} material={MAT.woodDark} position={[0.6, -0.5, pz]} scale={[0.09, 1.75, 0.09]} />
          </group>
        ))}
        <mesh geometry={GEO.box} material={MAT.woodDark} position={[-0.6, 0.3, -9.9]} scale={[0.12, 0.1, 8.8]} />
        <mesh geometry={GEO.box} material={MAT.woodDark} position={[0.6, 0.3, -9.9]} scale={[0.12, 0.1, 8.8]} />
        {Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} geometry={GEO.box} material={MAT.plank} position={[0, 0.38, -5.9 - i * 0.72]}
            scale={[1.5, 0.06, 0.55]} castShadow />
        ))}
      </group>
      <group ref={boat} position={[12.4, WORLD.LAKE_Y + 0.14, -9.2]} rotation={[0, 0.5, 0]}>
        <mesh geometry={GEO.sph} material={MAT.boat} scale={[0.45, 0.26, 1.15]} castShadow />
        <mesh geometry={GEO.box} material={MAT.woodDark} position={[0, 0.12, 0]} scale={[0.62, 0.08, 1.7]} />
        <mesh geometry={GEO.box} material={MAT.plank} position={[0, 0.18, 0.2]} scale={[0.55, 0.05, 0.18]} />
      </group>
    </group>
  )
}

// ---------- campfire ----------
const flamePlaneGeo = new THREE.PlaneGeometry(1.1, 1.5)
flamePlaneGeo.translate(0, 0.75, 0)
const sparkGeo = new THREE.PlaneGeometry(0.035, 0.035)
const SPARK_N = 40
interface Spark { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number }

function Campfire() {
  const gy = groundHeight(1.5, 4.2)
  const flameMat = useMemo(() => makeFlameMaterial(), [])
  const flames = useRef<THREE.Group>(null)
  const light = useRef<THREE.PointLight>(null)
  const sparkMesh = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    m.color.setRGB(3, 1.5, 0.45)
    const im = new THREE.InstancedMesh(sparkGeo, m, SPARK_N)
    im.frustumCulled = false
    return im
  }, [])
  const sparks = useMemo<Spark[]>(() => {
    const rng = mulberry32(99)
    return Array.from({ length: SPARK_N }, () => ({
      p: new THREE.Vector3(), v: new THREE.Vector3(),
      life: rng() * 1.2, max: 0.5 + rng() * 0.7,
    }))
  }, [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const smokeTex = useMemo(() => makeSoftTexture(), [])
  const smokeMats = useMemo(
    () => Array.from({ length: 7 }, () => new THREE.SpriteMaterial({
      map: smokeTex, color: '#8f9498', transparent: true, opacity: 0, depthWrite: false,
    })),
    [smokeTex]
  )
  const smokeRefs = useRef<(THREE.Sprite | null)[]>([])
  const smokeSeeds = useMemo(() => {
    const rng = mulberry32(55)
    return Array.from({ length: 7 }, () => ({ off: rng() * 4, dur: 3.2 + rng() * 1.6, seed: rng() * 6.28 }))
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const d = sim.derived, t = sim.elapsed
    const fire = d.fireStrength
    flameMat.uniforms.uFire.value = fire
    const fg = flames.current
    if (fg) {
      fg.scale.set(0.25 + 0.8 * fire, 0.15 + 0.95 * fire, 0.25 + 0.8 * fire)
      fg.rotation.z = -d.windX * 0.55
      fg.rotation.x = d.windZ * 0.55
    }
    const flick = 0.78 + 0.16 * Math.sin(t * 11.3) + 0.1 * Math.sin(t * 23.7 + 1.3)
    if (light.current) light.current.intensity = fire * (1.2 + d.nightF * 2.5) * flick

    // sparks
    const active = 22 + Math.round(18 * smoothstep(0.5, 0.75, d.wind01))
    const alive = fire > 0.05
    for (let i = 0; i < SPARK_N; i++) {
      const s = sparks[i]
      s.life -= dt
      if (s.life <= 0) {
        s.max = 0.5 + Math.random() * 0.7
        s.life = s.max
        s.p.set((Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3)
        s.v.set((Math.random() - 0.5) * 0.5 + d.windX * 2.5, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 0.5 + d.windZ * 2.5)
      }
      s.v.x += (d.windX * 3 - s.v.x * 0.4) * dt
      s.v.z += (d.windZ * 3 - s.v.z * 0.4) * dt
      s.p.addScaledVector(s.v, dt)
      const sc = alive && i < active ? (s.life / s.max) * (0.5 + fire * 0.8) : 0
      dummy.position.copy(s.p)
      dummy.scale.setScalar(sc)
      dummy.updateMatrix()
      sparkMesh.setMatrixAt(i, dummy.matrix)
    }
    sparkMesh.instanceMatrix.needsUpdate = true

    // smoke: strongest when fire is weak but not dead
    const smokeAmt = smoothstep(0.02, 0.12, fire) * (0.35 + (1 - fire) * 0.65)
    const shade = 0.35 + 0.5 * d.dayF
    for (let i = 0; i < 7; i++) {
      const sp = smokeRefs.current[i]
      const mtl = smokeMats[i]
      if (!sp) continue
      const sd = smokeSeeds[i]
      const lifeF = ((t + sd.off) % sd.dur) / sd.dur
      sp.position.set(
        Math.sin(t * 0.7 + sd.seed) * 0.2 * lifeF + d.windX * lifeF * 4.5,
        0.5 + lifeF * 3.4,
        Math.cos(t * 0.6 + sd.seed) * 0.2 * lifeF + d.windZ * lifeF * 4.5
      )
      const sc = 0.5 + lifeF * 1.9
      sp.scale.set(sc, sc, 1)
      mtl.opacity = smokeAmt * 0.38 * (1 - lifeF) * smoothstep(0, 0.15, lifeF)
      mtl.color.setScalar(shade)
      mtl.rotation = sd.seed + t * 0.15
    }
  })

  const stones = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2
    return [Math.cos(a) * 0.58, Math.sin(a) * 0.58, a] as const
  })
  return (
    <group position={[1.5, gy, 4.2]}>
      {stones.map(([sx, sz, a], i) => (
        <mesh key={i} geometry={GEO.dod} material={MAT.stone} position={[sx, 0.07, sz]}
          rotation={[a, a * 2, 0]} scale={[0.16, 0.11, 0.13]} castShadow />
      ))}
      <mesh geometry={GEO.cyl} material={MAT.charcoal} position={[0, 0.03, 0]} scale={[0.42, 0.06, 0.42]} />
      {[0, 1, 2, 3].map(i => {
        const a = (i / 4) * Math.PI * 2 + 0.4
        return (
          <mesh key={i} geometry={GEO.cyl} material={MAT.woodDark}
            position={[Math.cos(a) * 0.16, 0.18, Math.sin(a) * 0.16]}
            rotation={[Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1 + 0.2]}
            scale={[0.055, 0.55, 0.055]} castShadow />
        )
      })}
      <group ref={flames} position={[0, 0.08, 0]}>
        {[0, 1, 2].map(i => (
          <mesh key={i} geometry={flamePlaneGeo} material={flameMat} rotation={[0, (i / 3) * Math.PI, 0]} />
        ))}
      </group>
      <primitive object={sparkMesh} />
      <group>
        {smokeMats.map((m, i) => (
          <sprite key={i} ref={el => { smokeRefs.current[i] = el }} material={m} />
        ))}
      </group>
      <pointLight ref={light} color="#ff9c50" position={[0, 0.7, 0]} intensity={0} distance={12} decay={2} />
    </group>
  )
}

// ---------- root ----------
export default function Camp() {
  const quality = useAppStore(s => s.quality)
  const grassCount = GRASS_COUNT[quality]
  const susukiCount = quality === 'low' ? 24 : 40
  return (
    <group>
      <CentralUpdater />
      <Ground />
      <Puddles />
      <GrassField key={`g-${quality}`} count={grassCount} />
      <SusukiField key={`s-${quality}`} count={susukiCount} />
      {TREES.map((t, i) => <Tree key={i} spec={t} />)}
      <RocksAndBushes />
      <Tent />
      <TarpSet />
      <TableSet />
      <Chair x={0.3} z={7.7} rot={0.15} />
      <Chair x={3.0} z={7.5} rot={-0.2} />
      <Cooler />
      <Firewood />
      <Deck />
      <Pier />
      <Campfire />
    </group>
  )
}
