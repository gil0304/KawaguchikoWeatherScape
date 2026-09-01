import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { sim, clamp01, smoothstep } from '../engine/sim'
import { useAppStore } from '../stores/appStore'

// ============================================================ sky dome shader

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uGlowColor;
uniform vec3 uMoonDir;
uniform float uSunVis;
uniform float uMoonVis;
uniform float uDuskF;
uniform float uStarAlpha;
uniform float uFlash;
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogMix;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float starField(vec3 d, float t) {
  vec3 p = d * 260.0;
  vec3 id = floor(p);
  float rnd = hash13(id);
  float s = smoothstep(0.9955, 1.0, rnd);
  float b = hash13(id + vec3(91.7));
  float tw = 0.6 + 0.4 * sin(t * (1.5 + b * 5.0) + b * 44.0);
  return s * (0.3 + 0.7 * b) * tw;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;

  // ---- base vertical gradient
  float g = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uSkyHorizon, uSkyTop, g);
  col = mix(col, uSkyHorizon * 0.82, smoothstep(0.0, 0.18, -h));

  // ---- stars + milky way (added before moon/sun so the moon occludes them)
  float horizFade = smoothstep(0.02, 0.14, h);
  float starA = uStarAlpha * horizFade;
  if (starA > 0.002) {
    col += vec3(0.85, 0.9, 1.0) * starField(dir, uTime) * 1.25 * starA;
    vec3 mwN = normalize(vec3(0.62, 0.28, 0.55));
    float mwD = dot(dir, mwN);
    float mwBand = exp(-mwD * mwD * 26.0);
    float n1 = vnoise(dir * 7.0 + vec3(3.0));
    float n2 = vnoise(dir * 19.0);
    float milky = mwBand * (0.12 + 0.88 * n1 * n1) * (0.45 + 0.55 * n2);
    col += vec3(0.6, 0.66, 0.85) * milky * 0.30 * starA;
    col += vec3(0.85, 0.9, 1.0) * starField(dir.zxy * 1.31 + vec3(7.0), uTime) * mwBand * 0.55 * starA;
  }

  // ---- moon with crescent phase shading
  float md = dot(dir, uMoonDir);
  vec3 rel = dir - uMoonDir * md;
  vec3 mU = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 1e-4));
  vec3 mV = cross(mU, uMoonDir);
  vec2 lc = vec2(dot(rel, mU), dot(rel, mV)) / 0.016;
  float r2 = dot(lc, lc);
  float nearMoon = smoothstep(0.5, 0.9, md);
  float mdisc = (1.0 - smoothstep(0.82, 1.0, r2)) * nearMoon;
  float mz = sqrt(max(1.0 - min(r2, 1.0), 0.0));
  vec3 mN = vec3(lc.x, lc.y, mz);
  vec3 phaseL = normalize(vec3(0.85, 0.18, 0.45));
  float lit = smoothstep(-0.12, 0.4, dot(mN, phaseL));
  vec3 moonCol = vec3(0.92, 0.95, 1.02) * (0.1 + 0.95 * lit);
  col = mix(col, moonCol, mdisc * uMoonVis);
  col += vec3(0.5, 0.6, 0.85) * pow(max(md, 0.0), 200.0) * 0.16 * uMoonVis;

  // ---- sun glow + disc (disc pushed >1 so it blooms)
  float sd = dot(dir, uSunDir);
  float glow = pow(max(sd, 0.0), 90.0) * 0.4 + pow(max(sd, 0.0), 7.0) * 0.10;
  col += uSunColor * glow * uSunVis;
  float disc = smoothstep(0.99985, 0.99995, sd);
  col += uSunColor * disc * 3.4 * uSunVis;

  // ---- warm dusk band near horizon around sun azimuth
  vec2 sAz = normalize(uSunDir.xz + vec2(1e-4));
  vec2 dAz = normalize(dir.xz + vec2(1e-4));
  float az = max(dot(sAz, dAz), 0.0);
  float band = exp(-abs(h) * 7.0) * (0.2 + 0.8 * pow(az, 3.0));
  col += uGlowColor * band * uDuskF * 0.75;

  // ---- thick fog swallows the sky itself (keeps faded objects from silhouetting)
  float fogSw = uFogMix * (1.0 - clamp(h, 0.0, 1.0) * mix(0.85, 0.2, uFogMix));
  col = mix(col, uFogColor, fogSw);

  // ---- lightning flash: cold blue-white wash over the whole dome
  col += vec3(0.72, 0.82, 1.0) * uFlash * 0.55;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

// ============================================================ shooting star

const STREAK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const STREAK_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAlpha;
uniform vec3 uColor;
void main() {
  float x = vUv.x;
  float tail = pow(x, 2.4);
  float head = smoothstep(0.82, 0.99, x) * 1.4;
  float core = pow(clamp(1.0 - abs(vUv.y - 0.5) * 2.0, 0.0, 1.0), 2.0);
  float a = (tail + head) * core * uAlpha;
  gl_FragColor = vec4(uColor * (1.2 + head * 1.6), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function ShootingStar() {
  const mesh = useRef<THREE.Mesh>(null)
  const uni = useMemo(() => ({
    uAlpha: { value: 0 },
    uColor: { value: new THREE.Color('#cfe2ff') },
  }), [])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  }), [uni])
  const st = useRef({
    active: false, t: 0, life: 0.6, timer: 6,
    pos: new THREE.Vector3(), dir: new THREE.Vector3(),
    tmpN: new THREE.Vector3(), tmpY: new THREE.Vector3(), tmpZ: new THREE.Vector3(),
    m: new THREE.Matrix4(),
  })

  useFrame((_, dt) => {
    const s = st.current
    const m = mesh.current
    if (!m) return
    const meteor = sim.presetId === 'meteor-night'
    if (!s.active) {
      uni.uAlpha.value = 0
      s.timer -= dt
      if (s.timer <= 0) {
        s.timer = meteor ? 1.6 + Math.random() * 2.8 : 16 + Math.random() * 26
        if ((meteor || sim.derived.starAlpha > 0.5) && sim.derived.starAlpha > 0.05) {
          s.active = true
          s.t = 0
          s.life = 0.45 + Math.random() * 0.35
          const el = (30 + Math.random() * 40) * (Math.PI / 180)
          const az = Math.PI + (Math.random() - 0.5) * 3.2 // biased toward Fuji-side sky
          s.pos.setFromSphericalCoords(1220, Math.PI / 2 - el, az)
          const n = s.tmpN.copy(s.pos).normalize()
          s.dir.set(Math.random() - 0.5, -(0.35 + Math.random() * 0.6), Math.random() - 0.5)
          s.dir.addScaledVector(n, -s.dir.dot(n)).normalize() // tangent to sky sphere
          const z = s.tmpZ.copy(n).multiplyScalar(-1)
          const y = s.tmpY.crossVectors(z, s.dir).normalize()
          z.crossVectors(s.dir, y).normalize()
          s.m.makeBasis(s.dir, y, z)
          m.quaternion.setFromRotationMatrix(s.m)
          m.position.copy(s.pos)
        }
      }
    } else {
      s.t += dt
      const k = s.t / s.life
      if (k >= 1) {
        s.active = false
        uni.uAlpha.value = 0
      } else {
        m.position.copy(s.pos).addScaledVector(s.dir, s.t * 520)
        uni.uAlpha.value = Math.sin(k * Math.PI) * clamp01(sim.derived.starAlpha * 1.6)
      }
    }
  })

  return (
    <mesh ref={mesh} frustumCulled={false} renderOrder={2}>
      <planeGeometry args={[52, 1.7]} />
      <primitive object={mat} attach="material" />
    </mesh>
  )
}

// ============================================================ rainbow

const RAINBOW_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const RAINBOW_FRAG = /* glsl */ `
varying vec2 vP;
uniform float uOpacity;
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(vec3(1.0), clamp(p - vec3(1.0), 0.0, 1.0), c.y);
}
void main() {
  float r = length(vP);
  vec3 col = vec3(0.0);
  float a = 0.0;
  // primary bow: red outside -> violet inside
  float t1 = (r - 96.0) / 16.0;
  float e1 = smoothstep(0.0, 0.18, t1) * (1.0 - smoothstep(0.82, 1.0, t1));
  col += hsv2rgb(vec3(0.76 * clamp(1.0 - t1, 0.0, 1.0), 0.8, 1.0)) * e1;
  a += e1;
  // secondary bow: fainter, colors reversed
  float t2 = (r - 120.0) / 9.0;
  float e2 = smoothstep(0.0, 0.25, t2) * (1.0 - smoothstep(0.75, 1.0, t2));
  col += hsv2rgb(vec3(0.76 * clamp(t2, 0.0, 1.0), 0.6, 1.0)) * e2 * 0.28;
  a += e2 * 0.28;
  float endFade = smoothstep(2.0, 30.0, vP.y); // soften where the arc meets the lake
  gl_FragColor = vec4(col, a * endFade * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function Rainbow() {
  const group = useRef<THREE.Group>(null)
  const uni = useMemo(() => ({ uOpacity: { value: 0 } }), [])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: RAINBOW_VERT, fragmentShader: RAINBOW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, fog: false,
  }), [uni])

  useFrame((_, dt) => {
    const d = sim.derived
    uni.uOpacity.value = sim.params.rainbow * d.dayF * 0.6
    const g = group.current
    if (!g) return
    // arc sits opposite the sun azimuth, across the lake
    const targetX = -d.sunDir.x * 170
    g.position.x += (targetX - g.position.x) * Math.min(1, dt * 1.5)
  })

  return (
    <group ref={group} position={[0, -6, -235]}>
      <mesh frustumCulled={false} renderOrder={1}>
        <ringGeometry args={[86, 134, 96, 1, 0, Math.PI]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  )
}

// ============================================================ SkySystem

export default function SkySystem() {
  const quality = useAppStore(s => s.quality) // remount key for shadow map size changes
  const scene = useThree(s => s.scene)

  const sunRef = useRef<THREE.DirectionalLight>(null)
  const moonRef = useRef<THREE.DirectionalLight>(null)
  const ambRef = useRef<THREE.AmbientLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)
  const fogRef = useRef<THREE.FogExp2 | null>(null)

  const uni = useMemo(() => ({
    uSkyTop: { value: new THREE.Color('#2f6fc2') },
    uSkyHorizon: { value: new THREE.Color('#bcd8ee') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color('#fff5e8') },
    uGlowColor: { value: new THREE.Color('#ff9a4d') },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunVis: { value: 1 },
    uMoonVis: { value: 0 },
    uDuskF: { value: 0 },
    uStarAlpha: { value: 0 },
    uFlash: { value: 0 },
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color('#bcd8ee') },
    uFogMix: { value: 0 },
  }), [])

  const skyMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, fog: false,
  }), [uni])

  // scene fog: created once, mutated per frame
  useEffect(() => {
    const fog = new THREE.FogExp2(0xbcd8ee, 0.001)
    fogRef.current = fog
    scene.fog = fog
    return () => {
      if (scene.fog === fog) scene.fog = null
      fogRef.current = null
    }
  }, [scene])

  useFrame(() => {
    const d = sim.derived
    const p = sim.params
    const clearness = clamp01(1 - p.cloudCoverage * 0.75)

    // sky uniforms
    uni.uSkyTop.value.copy(d.skyTop)
    uni.uSkyHorizon.value.copy(d.skyHorizon)
    uni.uSunDir.value.copy(d.sunDir)
    uni.uMoonDir.value.copy(d.moonDir)
    uni.uSunColor.value.copy(d.sunColor)
    uni.uGlowColor.value.copy(d.skyGlow)
    uni.uSunVis.value = clamp01(p.sunIntensity) * clearness *
      smoothstep(-4, 1, d.elevDeg) * clamp01(p.visibility * 1.5)
    uni.uMoonVis.value = clamp01(d.moonI / 0.5)
    uni.uDuskF.value = d.duskF * (0.25 + 0.75 * clearness)
    uni.uStarAlpha.value = d.starAlpha
    uni.uFlash.value = sim.flash
    uni.uTime.value = sim.elapsed
    uni.uFogColor.value.copy(d.fogColor)
    uni.uFogMix.value = smoothstep(0.1, 0.8, p.fogDensity) * 0.97

    // lights
    const sun = sunRef.current
    if (sun) {
      sun.position.copy(d.sunDir).multiplyScalar(300)
      sun.color.copy(d.sunColor)
      sun.intensity = d.sunI
    }
    const moon = moonRef.current
    if (moon) {
      moon.position.copy(d.moonDir).multiplyScalar(300)
      moon.intensity = d.moonI
    }
    if (ambRef.current) ambRef.current.intensity = d.ambientI
    const hemi = hemiRef.current
    if (hemi) {
      hemi.intensity = d.hemiI
      hemi.color.copy(d.skyTop).lerp(d.skyHorizon, 0.4)
    }

    // fog
    const fog = fogRef.current
    if (fog) {
      fog.color.copy(d.fogColor)
      fog.density = d.fogDensityFinal
    }
  })

  const shadowMapSize = quality === 'medium' ? 1024 : 2048

  return (
    <group>
      {/* sky dome */}
      <mesh renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[1400, 48, 32]} />
        <primitive object={skyMat} attach="material" />
      </mesh>

      <ShootingStar />
      <Rainbow />

      {/* sun directional (owns shadows) — keyed on quality so mapSize takes effect */}
      <directionalLight
        key={`sun-${quality}`}
        ref={sunRef}
        position={[0, 300, 0]}
        intensity={1}
        castShadow={quality !== 'low'}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={80}
        shadow-camera-bottom={-40}
        shadow-camera-near={100}
        shadow-camera-far={520}
        shadow-bias={-0.0002}
        shadow-normalBias={0.25}
      />

      {/* moon directional, bluish, no shadow */}
      <directionalLight ref={moonRef} color="#9db8ff" position={[0, -300, 0]} intensity={0} />

      <ambientLight ref={ambRef} intensity={0.5} />
      <hemisphereLight ref={hemiRef} args={['#88aacc', '#33291d', 0.4]} />
    </group>
  )
}
