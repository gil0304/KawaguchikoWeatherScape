/// <reference types="vite/client" />
import { useEffect, useState } from 'react'
import { sim, type Season, type Quality, type WeatherParams, type WeatherPreset } from '../engine/sim'
import { useAppStore } from '../stores/appStore'
import { PRESETS, CATEGORIES } from '../data/presets'
import { CINEMATICS } from '../data/cinematics'
import { audioEngine } from '../audio/engine'
import { capturePNG, startRecording, stopRecording } from './capture'
import './ui.css'

const SEASON_KANJI: Record<Season, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }
const SEASON_LIST: Season[] = ['spring', 'summer', 'autumn', 'winter']
const QUALITY_KANJI: Record<Quality, string> = { low: '低', medium: '中', high: '高', ultra: '超' }
const QUALITY_CYCLE: Record<Quality, Quality> = { low: 'medium', medium: 'high', high: 'ultra', ultra: 'low' }
const TRANS_CHOICES: { label: string; s: number }[] = [
  { label: '3s', s: 3 }, { label: '15s', s: 15 }, { label: '1m', s: 60 }, { label: '3m', s: 180 },
]
const DETAIL_SLIDERS: { k: keyof WeatherParams; label: string; max: number }[] = [
  { k: 'cloudCoverage', label: '雲', max: 1 },
  { k: 'cloudHeight', label: '雲高', max: 1 },
  { k: 'rainIntensity', label: '雨', max: 1 },
  { k: 'snowIntensity', label: '雪', max: 1 },
  { k: 'fogDensity', label: '霧', max: 1 },
  { k: 'windSpeed', label: '風', max: 1 },
  { k: 'windDirection', label: '風向', max: Math.PI * 2 },
  { k: 'lakeWave', label: '波', max: 1 },
  { k: 'wetness', label: '濡れ', max: 1 },
  { k: 'snowCover', label: '積雪', max: 1 },
  { k: 'visibility', label: '視程', max: 1 },
  { k: 'fujiVisibility', label: '富士', max: 1 },
  { k: 'lightningFrequency', label: '雷', max: 1 },
]

function fmtClock(t: number): string {
  const h = Math.floor(t) % 24
  const m = Math.floor((t - Math.floor(t)) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ---------- top-left info ----------
function TopInfo({ temp }: { temp: number }) {
  const season = useAppStore(s => s.season)
  const timeDisplay = useAppStore(s => s.timeDisplay)
  const presetName = useAppStore(s => s.presetName)
  return (
    <div className="kws-panel kws-top">
      <div className="kws-title">Kawaguchiko WeatherScape</div>
      <div className="kws-now">
        <span className="kanji">{SEASON_KANJI[season]}</span>
        <span className="clock">{fmtClock(timeDisplay)}</span>
        <span className="wname">{presetName}</span>
        <span className="temp">{temp}°</span>
      </div>
    </div>
  )
}

// ---------- right rail + preset popover ----------
function CategoryRail() {
  const openCategory = useAppStore(s => s.openCategory)
  const setOpenCategory = useAppStore(s => s.setOpenCategory)
  const presetId = useAppStore(s => s.presetId)
  const selectPreset = useAppStore(s => s.selectPreset)
  const deleteCustom = useAppStore(s => s.deleteCustom)
  const customPresets = useAppStore(s => s.customPresets)

  const list: WeatherPreset[] = openCategory === null ? []
    : openCategory === 'custom' ? customPresets
      : PRESETS.filter(p => p.category === openCategory)

  return (
    <>
      <div className="kws-panel kws-rail">
        {CATEGORIES.map(c => (
          <button
            key={c.key} type="button" title={c.label}
            className={'kws-cat' + (openCategory === c.key ? ' on' : '')}
            onClick={() => setOpenCategory(c.key)}
          >{c.icon}</button>
        ))}
        <button
          type="button" title="カスタム"
          className={'kws-cat' + (openCategory === 'custom' ? ' on' : '')}
          onClick={() => setOpenCategory('custom')}
        >★</button>
      </div>
      {openCategory !== null && (
        <div className="kws-panel kws-presets">
          {list.length === 0 && <div className="kws-empty">—</div>}
          {list.map(p => (
            <div
              key={p.id}
              className={'kws-preset' + (presetId === p.id ? ' on' : '')}
              onClick={() => { selectPreset(p.id); setOpenCategory(openCategory) }}
            >
              <span>{p.name}</span>
              {openCategory === 'custom' && (
                <button
                  type="button" className="del"
                  onClick={e => { e.stopPropagation(); deleteCustom(p.id) }}
                >×</button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ---------- bottom bar ----------
function BottomBar() {
  const timeDisplay = useAppStore(s => s.timeDisplay)
  const setTime = useAppStore(s => s.setTime)
  const playing = useAppStore(s => s.playing)
  const togglePlaying = useAppStore(s => s.togglePlaying)
  const paused = useAppStore(s => s.paused)
  const togglePause = useAppStore(s => s.togglePause)
  const transChoice = useAppStore(s => s.transChoice)
  const setTransChoice = useAppStore(s => s.setTransChoice)
  const season = useAppStore(s => s.season)
  const setSeason = useAppStore(s => s.setSeason)
  const auto = useAppStore(s => s.auto)
  const toggleAuto = useAppStore(s => s.toggleAuto)
  const cinematicId = useAppStore(s => s.cinematicId)
  const setCinematic = useAppStore(s => s.setCinematic)
  const audioOn = useAppStore(s => s.audioOn)
  const toggleAudio = useAppStore(s => s.toggleAudio)
  const recording = useAppStore(s => s.recording)
  const toggleDetails = useAppStore(s => s.toggleDetails)
  const detailsOpen = useAppStore(s => s.detailsOpen)
  const quality = useAppStore(s => s.quality)
  const setQuality = useAppStore(s => s.setQuality)
  const [cineOpen, setCineOpen] = useState(false)

  return (
    <div className="kws-panel kws-bar">
      <input
        type="range" className="kws-time" min={0} max={24} step={0.05}
        value={timeDisplay} aria-label="時刻"
        onChange={e => setTime(parseFloat(e.target.value))}
      />
      <button type="button" className={'kws-chip icon' + (playing ? ' on' : '')} title="時間の流れ" onClick={togglePlaying}>
        {playing ? '⏸' : '▶'}
      </button>
      <button type="button" className={'kws-chip icon' + (paused ? ' on' : '')} title="一時停止" onClick={togglePause}>
        {paused ? '⏵' : '⏸'}
      </button>
      <span className="kws-sep" />
      {TRANS_CHOICES.map(t => (
        <button
          key={t.s} type="button"
          className={'kws-chip' + (transChoice === t.s ? ' on' : '')}
          onClick={() => setTransChoice(t.s)}
        >{t.label}</button>
      ))}
      <span className="kws-sep" />
      {SEASON_LIST.map(s => (
        <button
          key={s} type="button"
          className={'kws-chip' + (season === s ? ' on' : '')}
          onClick={() => setSeason(s)}
        >{SEASON_KANJI[s]}</button>
      ))}
      <button type="button" className={'kws-chip' + (auto ? ' on' : '')} title="自動天候" onClick={toggleAuto}>AUTO</button>
      <span className="kws-sep" />
      <span className="kws-popwrap">
        {cinematicId !== null ? (
          <button type="button" className="kws-chip icon on" title="シネマ停止" onClick={() => setCinematic(null)}>🎬✕</button>
        ) : (
          <button type="button" className={'kws-chip icon' + (cineOpen ? ' on' : '')} title="シネマ" onClick={() => setCineOpen(o => !o)}>🎬</button>
        )}
        {cineOpen && cinematicId === null && (
          <div className="kws-panel kws-pop">
            {CINEMATICS.map(c => (
              <div key={c.id} className="kws-preset" onClick={() => { setCineOpen(false); setCinematic(c.id) }}>
                <span>{c.name}</span>
              </div>
            ))}
          </div>
        )}
      </span>
      <button
        type="button" className={'kws-chip icon' + (audioOn ? ' on' : '')} title="音"
        onClick={() => { audioEngine.init(); toggleAudio() }}
      >{audioOn ? '🔊' : '🔇'}</button>
      <button type="button" className="kws-chip icon" title="撮影" onClick={capturePNG}>📷</button>
      <button
        type="button" className={'kws-chip icon rec' + (recording ? ' on' : '')} title="録画"
        onClick={() => { if (recording) stopRecording(); else startRecording() }}
      >{recording ? '⏹' : '⏺'}</button>
      <span className="kws-sep" />
      <button type="button" className={'kws-chip icon' + (detailsOpen ? ' on' : '')} title="詳細" onClick={toggleDetails}>⚙</button>
      <button type="button" className="kws-chip" title="画質" onClick={() => setQuality(QUALITY_CYCLE[quality])}>
        {QUALITY_KANJI[quality]}
      </button>
    </div>
  )
}

// ---------- details panel ----------
function DetailsPanel() {
  const tweak = useAppStore(s => s.tweak)
  const saveCustom = useAppStore(s => s.saveCustom)
  const [name, setName] = useState('')
  return (
    <div className="kws-panel kws-details">
      {DETAIL_SLIDERS.map(d => (
        <div className="kws-drow" key={d.k}>
          <label>{d.label}</label>
          <input
            type="range" min={0} max={d.max} step={0.01}
            defaultValue={sim.target[d.k]}
            aria-label={d.label}
            onChange={e => tweak({ [d.k]: parseFloat(e.target.value) } as Partial<WeatherParams>)}
          />
        </div>
      ))}
      <div className="kws-save">
        <input
          type="text" placeholder="名前" value={name} maxLength={20}
          onChange={e => setName(e.target.value)}
        />
        <button type="button" className="kws-chip" onClick={() => { saveCustom(name.trim()); setName('') }}>保存</button>
      </div>
    </div>
  )
}

// ---------- root ----------
export default function UIRoot() {
  const uiHidden = useAppStore(s => s.uiHidden)
  const toggleUI = useAppStore(s => s.toggleUI)
  const detailsOpen = useAppStore(s => s.detailsOpen)
  const presetId = useAppStore(s => s.presetId)
  const audioOn = useAppStore(s => s.audioOn)
  const recording = useAppStore(s => s.recording)
  const [temp, setTemp] = useState(() => Math.round(sim.params.temperature))

  // 2Hz UI sync — mirrors sim.time / temperature into low-frequency React state
  useEffect(() => {
    const id = window.setInterval(() => {
      useAppStore.getState().syncTime()
      setTemp(Math.round(sim.params.temperature))
    }, 500)
    return () => window.clearInterval(id)
  }, [])

  // hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      const st = useAppStore.getState()
      const k = e.key.toLowerCase()
      if (k === 'h') st.toggleUI()
      else if (e.code === 'Space') { e.preventDefault(); st.togglePause() }
      else if (k === 'p') capturePNG()
      else if (k === 'r') { if (st.recording) stopRecording(); else startRecording() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // unlock audio context on first user gesture
  useEffect(() => {
    const unlock = () => { try { audioEngine.init() } catch { /* audio unavailable */ } }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  // reflect store.audioOn into the audio engine
  useEffect(() => {
    try { audioEngine.setEnabled(audioOn) } catch { /* audio unavailable */ }
  }, [audioOn])

  // quality auto-benchmark on first visit (no stored preference)
  useEffect(() => {
    if (localStorage.getItem('kws.quality')) return
    let raf = 0
    let cancelled = false
    const warmup = window.setTimeout(() => {
      let frames = 0
      const t0 = performance.now()
      const loop = () => {
        if (cancelled) return
        frames++
        if (performance.now() - t0 < 4000) {
          raf = requestAnimationFrame(loop)
        } else {
          const fps = frames / 4
          let q: Quality = fps < 25 ? 'low' : fps < 40 ? 'medium' : fps < 58 ? 'high' : 'ultra'
          if (window.matchMedia('(max-width: 820px)').matches && (q === 'high' || q === 'ultra')) q = 'medium'
          useAppStore.getState().setQuality(q)
        }
      }
      raf = requestAnimationFrame(loop)
    }, 3000)
    return () => { cancelled = true; window.clearTimeout(warmup); cancelAnimationFrame(raf) }
  }, [])

  // during recording: UI fully hidden, dot stops recording (touch escape hatch; R also stops)
  if (recording) {
    return <button type="button" className="kws-dot rec" aria-label="録画停止" onClick={stopRecording} />
  }
  if (uiHidden) {
    return <button type="button" className="kws-dot" aria-label="UI表示" onClick={toggleUI} />
  }
  return (
    <div className="kws-ui">
      <TopInfo temp={temp} />
      <CategoryRail />
      <BottomBar />
      {detailsOpen && <DetailsPanel key={presetId} />}
    </div>
  )
}
