import { Suspense, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { sim, applyPreset, tweakParams, WORLD } from './engine/sim'
import { SimTick, CameraRig, PostFX } from './engine/systems'
import { useAppStore } from './stores/appStore'
import { getPreset } from './data/presets'
import SkySystem from './scene/SkySystem'
import Fuji from './scene/Fuji'
import Lake from './scene/Lake'
import Camp from './scene/Camp'
import WeatherFX from './scene/WeatherFX'
import UIRoot from './ui/UIRoot'

export default function App() {
  const quality = useAppStore(s => s.quality)

  useEffect(() => {
    // dev hook for automated testing
    const prev = (window as any).KWS
    ;(window as any).KWS = { ...prev, sim, applyPreset, tweakParams, getPreset, store: useAppStore }
    // URL params: ?preset=starry-night&time=23.5&season=winter&hideui=1 (deep-linkable states)
    const q = new URLSearchParams(location.search)
    const pid = q.get('preset')
    if (pid) {
      const p = getPreset(pid)
      if (p) {
        applyPreset(p, 0.01)
        useAppStore.setState({ presetId: p.id, presetName: p.name })
      }
    }
    const t = q.get('time')
    if (t !== null && !Number.isNaN(+t)) { sim.time = +t; sim.timeTarget = +t }
    const se = q.get('season')
    if (se === 'spring' || se === 'summer' || se === 'autumn' || se === 'winter') {
      useAppStore.getState().setSeason(se)
    }
    if (q.get('hideui')) useAppStore.setState({ uiHidden: true })
  }, [])

  return (
    <>
      <Canvas
        shadows={quality !== 'low'}
        dpr={quality === 'ultra' ? [1, 2] : quality === 'high' ? [1, 1.75] : [1, 1.25]}
        gl={{ preserveDrawingBuffer: true, antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 50, near: 0.1, far: 1600, position: [WORLD.CAM_START.x, WORLD.CAM_START.y, WORLD.CAM_START.z] }}
        onCreated={({ scene, camera }) => { const k = (window as any).KWS; if (k) { k.scene = scene; k.camera = camera } else (window as any).KWS = { scene, camera } }}
      >
        <Suspense fallback={null}>
          <SimTick />
          <CameraRig />
          <SkySystem />
          <Fuji />
          <Lake />
          <Camp />
          <WeatherFX />
          <PostFX />
        </Suspense>
      </Canvas>
      <UIRoot />
    </>
  )
}
