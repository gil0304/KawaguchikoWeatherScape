import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import { sim, applyPreset, tickSim, WORLD, type Season } from './sim'
import { PRESETS, getPreset } from '../data/presets'
import { CINEMATICS } from '../data/cinematics'
import { useAppStore } from '../stores/appStore'

// ---------------- SimTick: advances the simulation every frame ----------------
const SEASON_OK: Record<Season, (cat: string, id: string) => boolean> = {
  winter: (cat) => cat !== 'storm',
  summer: (cat, id) => cat !== 'snow' && id !== 'moonlit-snow' && id !== 'winter-clear',
  spring: (cat, id) => cat !== 'snow' || id === 'first-snow',
  autumn: (cat, id) => cat !== 'snow' || id === 'first-snow',
}

export function SimTick() {
  const cine = useRef({ id: null as string | null, step: -1, timer: 0 })
  const uiSync = useRef(0)

  useFrame((_, dt) => {
    tickSim(dt)
    const st = useAppStore.getState()

    // auto weather
    if (sim.auto && !sim.cinematic && !sim.paused) {
      sim.autoTimer += dt
      if (sim.autoTimer > 45) {
        sim.autoTimer = 0
        const pool = PRESETS.filter(p => p.id !== sim.presetId && SEASON_OK[sim.season](p.category, p.id))
        const p = pool[Math.floor(Math.random() * pool.length)]
        if (p) {
          applyPreset({ ...p, season: undefined }, 25, { jumpTime: false })
          useAppStore.setState({ presetId: p.id, presetName: p.name })
        }
      }
    }

    // cinematic sequence
    const c = cine.current
    if (st.cinematicId !== c.id) { c.id = st.cinematicId; c.step = -1; c.timer = 0 }
    if (c.id && !sim.paused) {
      const seq = CINEMATICS.find(s => s.id === c.id)
      if (seq) {
        c.timer -= dt
        if (c.step < 0 || c.timer <= 0) {
          c.step = (c.step + 1) % seq.steps.length
          const step = seq.steps[c.step]
          const p = getPreset(step.presetId)
          if (p) {
            applyPreset(p, step.trans, { jumpTime: false })
            if (step.time !== undefined) sim.timeTarget = step.time
            useAppStore.setState({ presetId: p.id, presetName: p.name })
          }
          sim.timeSpeed = seq.timeSpeed ?? 0
          c.timer = step.trans + step.hold
        }
      }
    }

    // low-frequency UI sync
    uiSync.current += dt
    if (uiSync.current > 0.5) { uiSync.current = 0; st.syncTime() }
  })
  return null
}

// ---------------- CameraRig: orbit + WASD + cinematic paths ----------------
interface Shot { fp: [number, number, number]; tp: [number, number, number]; ft: [number, number, number]; tt: [number, number, number]; dur: number }
const SHOTS: Shot[] = [
  { fp: [0, 1.8, 12], tp: [0, 1.6, 8], ft: [0, 16, -140], tt: [0, 16, -140], dur: 26 },
  { fp: [5, 1.4, 5], tp: [3.2, 1.7, 3], ft: [-3, 12, -150], tt: [0, 18, -200], dur: 24 },
  { fp: [-2, 0.5, -10], tp: [2, 0.7, -18], ft: [0, 24, -320], tt: [0, 24, -320], dur: 28 },
  { fp: [0, 2, 8], tp: [0, 2.8, -10], ft: [0, 30, -320], tt: [0, 45, -320], dur: 30 },
  { fp: [-8, 1.8, 7], tp: [8, 1.8, 7], ft: [0, 14, -120], tt: [0, 14, -120], dur: 26 },
  { fp: [11, 1.3, -12], tp: [9.5, 1.6, -16], ft: [0, 20, -300], tt: [0, 20, -300], dur: 24 },
  { fp: [-6, 32, 34], tp: [4, 24, 20], ft: [0, 8, -140], tt: [0, 12, -160], dur: 30 },
]
const ease = (t: number) => t * t * (3 - 2 * t)

export function CameraRig() {
  const { camera } = useThree()
  const controls = useRef<any>(null)
  const keys = useRef<Record<string, boolean>>({})
  const shot = useRef({ idx: 0, t: 0 })
  const v = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3() }).current
  const cinematicId = useAppStore(s => s.cinematicId)

  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      keys.current[e.key.toLowerCase()] = true
      if (e.key.toLowerCase() === 'f') resetCamera()
    }
    const up = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [])

  const resetCamera = () => {
    camera.position.copy(WORLD.CAM_START)
    if (controls.current) { controls.current.target.copy(WORLD.CAM_TARGET); controls.current.update() }
  }

  useEffect(() => {
    const k = (window as any).KWS
    if (k) k.controls = controls
  })

  useFrame((_, dt) => {
    dt = Math.min(dt, 0.1)
    if (cinematicId) {
      const s = shot.current
      s.t += dt
      let sh = SHOTS[s.idx % SHOTS.length]
      if (s.t > sh.dur) { s.t = 0; s.idx = (s.idx + 1) % SHOTS.length; sh = SHOTS[s.idx] }
      const k = ease(Math.min(1, s.t / sh.dur))
      v.a.set(...sh.fp).lerp(v.b.set(...sh.tp), k)
      camera.position.lerp(v.a, Math.min(1, dt * 2 + (s.t < 0.1 ? 1 : 0)))
      v.a.set(...sh.ft).lerp(v.b.set(...sh.tt), k)
      camera.lookAt(v.a)
      if (controls.current) controls.current.enabled = false
      return
    }
    if (controls.current && !controls.current.enabled) {
      controls.current.enabled = true
      resetCamera()
    }
    // WASD first-person-ish movement
    const k = keys.current
    if (k['w'] || k['a'] || k['s'] || k['d']) {
      const speed = 6 * dt
      v.a.set(0, 0, 0)
      camera.getWorldDirection(v.b); v.b.y = 0; v.b.normalize()
      if (k['w']) v.a.add(v.b)
      if (k['s']) v.a.addScaledVector(v.b, -1)
      v.b.cross(camera.up)
      if (k['d']) v.a.add(v.b)
      if (k['a']) v.a.addScaledVector(v.b, -1)
      v.a.multiplyScalar(speed)
      camera.position.add(v.a)
      camera.position.y = Math.max(0.4, camera.position.y)
      if (controls.current) { controls.current.target.add(v.a); controls.current.update() }
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[WORLD.CAM_TARGET.x, WORLD.CAM_TARGET.y, WORLD.CAM_TARGET.z]}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI * 0.52}
      minDistance={2}
      maxDistance={260}
      zoomSpeed={0.6}
      rotateSpeed={0.5}
    />
  )
}

// ---------------- PostFX ----------------
export function PostFX() {
  const quality = useAppStore(s => s.quality)
  if (quality === 'low') return null
  return (
    <EffectComposer multisampling={quality === 'ultra' ? 4 : 0}>
      <Bloom mipmapBlur intensity={0.55} luminanceThreshold={1.0} luminanceSmoothing={0.3} />
      <Vignette eskil={false} offset={0.18} darkness={0.62} />
    </EffectComposer>
  )
}
