import * as THREE from 'three'
import { sim, smoothstep } from '../engine/sim'

// ---------- shared per-frame uniforms (one object, updated once per frame) ----------
export const campUniforms = {
  uWet: { value: 0 },
  uSnow: { value: 0 },
  uTime: { value: 0 },
  uWind01: { value: 0 },
  uWindX: { value: 0 },
  uWindZ: { value: 0 },
}

export function updateCampUniforms(): void {
  const p = sim.params
  const d = sim.derived
  campUniforms.uWet.value = p.wetness
  campUniforms.uSnow.value = p.snowCover
  campUniforms.uTime.value = sim.elapsed
  campUniforms.uWind01.value = d.wind01
  campUniforms.uWindX.value = d.windX
  campUniforms.uWindZ.value = d.windZ
}

// ---------- wet / snow / cloth material helper ----------
const VERT_HEAD = /* glsl */ `
#include <common>
uniform float uWet, uSnow, uTime, uWind01, uCloth;
varying vec3 vCampN;
varying vec3 vCampP;
`

const VERT_BODY = /* glsl */ `
#include <begin_vertex>
{
  vec3 campWN = objectNormal;
  vec4 campWP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    campWN = mat3( instanceMatrix ) * campWN;
    campWP = instanceMatrix * campWP;
  #endif
  vCampN = normalize( mat3( modelMatrix ) * campWN );
  vec3 campPos = ( modelMatrix * campWP ).xyz;
  if ( uCloth > 0.0 ) {
    float campFl = sin( dot( campPos, vec3( 5.0, 4.0, 5.0 ) ) + uTime * ( 2.0 + uWind01 * 10.0 ) );
    transformed += objectNormal * campFl * ( 0.005 + uWind01 * 0.09 ) * uCloth;
    campPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  }
  vCampP = campPos;
}
`

const FRAG_HEAD = /* glsl */ `
#include <common>
uniform float uWet, uSnow;
varying vec3 vCampN;
varying vec3 vCampP;
float campSnowAmt;
float campHash21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
`

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
{
  diffuseColor.rgb *= ( 1.0 - 0.4 * uWet );
  float campNse = ( campHash21( floor( vCampP.xz * 14.0 ) ) - 0.5 ) * 0.4;
  campSnowAmt = smoothstep( 0.42 - uSnow * 0.3, 0.78, vCampN.y + campNse ) * clamp( uSnow * 1.25, 0.0, 1.0 );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.95, 0.97 ), campSnowAmt );
}
`

const FRAG_ROUGH = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.25, uWet * 0.9 );
roughnessFactor = mix( roughnessFactor, 0.8, campSnowAmt );
`

export interface CampMatOpts {
  color: THREE.ColorRepresentation
  roughness?: number
  metalness?: number
  /** cloth flutter amplitude multiplier, 0 = rigid */
  cloth?: number
  flatShading?: boolean
  side?: THREE.Side
  vertexColors?: boolean
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
}

/** MeshStandardMaterial that darkens/gloss-es when wet, accumulates snow on top, optional cloth flutter. */
export function makeCampMaterial(o: CampMatOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: o.color,
    roughness: o.roughness ?? 0.9,
    metalness: o.metalness ?? 0,
    flatShading: o.flatShading ?? false,
    side: o.side ?? THREE.FrontSide,
    vertexColors: o.vertexColors ?? false,
  })
  if (o.emissive !== undefined) m.emissive.set(o.emissive)
  if (o.emissiveIntensity !== undefined) m.emissiveIntensity = o.emissiveIntensity
  m.onBeforeCompile = shader => {
    shader.uniforms.uWet = campUniforms.uWet
    shader.uniforms.uSnow = campUniforms.uSnow
    shader.uniforms.uTime = campUniforms.uTime
    shader.uniforms.uWind01 = campUniforms.uWind01
    shader.uniforms.uCloth = { value: o.cloth ?? 0 }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_HEAD)
      .replace('#include <begin_vertex>', VERT_BODY)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_HEAD)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
  }
  return m
}

// ---------- deterministic RNG ----------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- terrain ----------
export interface Puddle { x: number; z: number; rx: number; rz: number; rot: number }
export const PUDDLES: Puddle[] = [
  { x: -4.0, z: -0.6, rx: 1.15, rz: 0.7, rot: 0.4 },
  { x: 4.9, z: 8.8, rx: 0.95, rz: 0.6, rot: -0.3 },
  { x: -2.6, z: 10.8, rx: 1.3, rz: 0.8, rot: 0.15 },
]

/** Camp terrain height at (x, z). Gentle noise, puddle depressions, dip into the lake at the shore. */
export function groundHeight(x: number, z: number): number {
  let h =
    0.15 * Math.sin(x * 0.32 + 1.7) * Math.sin(z * 0.27 + 0.4) +
    0.07 * Math.sin(x * 0.85 + 0.3) * Math.sin(z * 0.7 + 2.1)
  h *= smoothstep(-5.5, -2.5, z)
  for (const p of PUDDLES) {
    const dx = (x - p.x) / p.rx
    const dz = (z - p.z) / p.rz
    h -= 0.14 * Math.exp(-(dx * dx + dz * dz) * 1.6)
  }
  h -= smoothstep(-4, -7, z) * 0.5
  return h
}

// ---------- swaying vegetation (grass / susuki) ----------
const SWAY_VERT = /* glsl */ `
attribute float aPhase;
uniform float uTime, uWind01, uWindX, uWindZ, uSnow, uScaleY;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec3 p = position;
  p.y *= uScaleY * ( 1.0 - uSnow * 0.7 );
  float sway = sin( uTime * ( 1.5 + uWind01 * 5.0 ) + aPhase ) * ( 0.05 + uWind01 * 0.5 ) * vUv.y * vUv.y;
  float wl = length( vec2( uWindX, uWindZ ) );
  vec2 dir = wl > 0.001 ? vec2( uWindX, uWindZ ) / wl : vec2( 0.7, 0.7 );
  p.x += sway * dir.x;
  p.z += sway * dir.y;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const SWAY_FRAG = /* glsl */ `
uniform vec3 uColor, uColorB;
uniform float uPlumeCut, uSnow;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec3 c = mix( uColor * ( 0.5 + 0.5 * vUv.y ), uColorB, smoothstep( uPlumeCut, uPlumeCut + 0.06, vUv.y ) );
  c = mix( c, vec3( 0.9, 0.92, 0.95 ), uSnow * 0.65 );
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export interface SwayMat extends THREE.ShaderMaterial {
  uniforms: {
    uTime: { value: number }
    uWind01: { value: number }
    uWindX: { value: number }
    uWindZ: { value: number }
    uSnow: { value: number }
    uScaleY: { value: number }
    uColor: { value: THREE.Color }
    uColorB: { value: THREE.Color }
    uPlumeCut: { value: number }
    fogColor: { value: THREE.Color }
    fogDensity: { value: number }
    fogNear: { value: number }
    fogFar: { value: number }
  }
}

export function makeSwayMaterial(color: string, colorB: string, plumeCut: number): SwayMat {
  const m = new THREE.ShaderMaterial({
    vertexShader: SWAY_VERT,
    fragmentShader: SWAY_FRAG,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: {
      uTime: campUniforms.uTime,
      uWind01: campUniforms.uWind01,
      uWindX: campUniforms.uWindX,
      uWindZ: campUniforms.uWindZ,
      uSnow: campUniforms.uSnow,
      uScaleY: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uColorB: { value: new THREE.Color(colorB) },
      uPlumeCut: { value: plumeCut },
      fogColor: { value: new THREE.Color('#bcd8ee') },
      fogDensity: { value: 0.001 },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
    },
  })
  return m as SwayMat
}

/** Crossed-quad geometry: `quads` crossed planes, width w, from y0 to y1. uv.y spans 0..1 over [0, vMax]. */
export function crossedQuads(
  quads: { w: number; y0: number; y1: number }[],
  vMax: number
): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let base = 0
  for (const q of quads) {
    for (let k = 0; k < 2; k++) {
      const a = (k * Math.PI) / 2
      const dx = Math.cos(a) * q.w * 0.5
      const dz = Math.sin(a) * q.w * 0.5
      pos.push(-dx, q.y0, -dz, dx, q.y0, dz, dx, q.y1, dz, -dx, q.y1, -dz)
      const v0 = q.y0 / vMax
      const v1 = q.y1 / vMax
      uv.push(0, v0, 1, v0, 1, v1, 0, v1)
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      base += 4
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

// ---------- flame shader ----------
const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`

const FLAME_FRAG = /* glsl */ `
uniform float uTime, uFire;
varying vec2 vUv;
float fh( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float fnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( fh( i ), fh( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( fh( i + vec2( 0.0, 1.0 ) ), fh( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {
  float t = uTime * ( 2.2 + uFire * 1.6 );
  float n = fnoise( vec2( vUv.x * 3.5, vUv.y * 4.0 - t ) ) * 0.65 +
            fnoise( vec2( vUv.x * 7.0 + 3.1, vUv.y * 8.0 - t * 1.7 ) ) * 0.35;
  float xx = abs( vUv.x - 0.5 ) * 2.0;
  float width = mix( 0.85, 0.08, pow( vUv.y, 0.8 ) );
  float mask = smoothstep( width, width * 0.35, xx + n * 0.35 * vUv.y );
  float body = mask * smoothstep( 1.0, 0.55, vUv.y ) * smoothstep( 0.0, 0.08, vUv.y );
  float a = body * ( 0.55 + n * 0.45 );
  float core = mask * mask * ( 1.0 - vUv.y ) * ( 1.0 - vUv.y );
  vec3 col = mix( vec3( 1.0, 0.22, 0.02 ), vec3( 1.0, 0.85, 0.3 ), clamp( core * 2.2 + n * 0.15, 0.0, 1.0 ) );
  gl_FragColor = vec4( col * ( 1.6 + 1.6 * uFire ) * a, a * clamp( uFire * 3.0, 0.0, 1.0 ) );
}
`

export interface FlameMat extends THREE.ShaderMaterial {
  uniforms: { uTime: { value: number }; uFire: { value: number } }
}

export function makeFlameMaterial(): FlameMat {
  const m = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: { uTime: campUniforms.uTime, uFire: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  return m as FlameMat
}

// ---------- soft round sprite texture (smoke) ----------
export function makeSoftTexture(): THREE.Texture {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = s
  cv.height = s
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.4)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
