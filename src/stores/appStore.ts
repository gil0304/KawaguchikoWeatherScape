import { create } from 'zustand'
import { sim, applyPreset, tweakParams, type Category, type Season, type Quality, type WeatherPreset, type WeatherParams } from '../engine/sim'
import { PRESETS, getPreset } from '../data/presets'

const LS_CUSTOM = 'kws.customPresets'
const LS_QUALITY = 'kws.quality'

function loadCustom(): WeatherPreset[] {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM) || '[]') } catch { return [] }
}

export interface AppState {
  presetId: string
  presetName: string
  openCategory: Category | 'custom' | null
  season: Season
  quality: Quality
  paused: boolean
  auto: boolean
  cinematicId: string | null
  uiHidden: boolean
  detailsOpen: boolean
  audioOn: boolean
  transChoice: number // 3 | 15 | 60 | 180 seconds
  timeDisplay: number // low-frequency mirror of sim.time for UI
  playing: boolean // time flowing
  recording: boolean
  customPresets: WeatherPreset[]
  // actions
  selectPreset: (id: string) => void
  setOpenCategory: (c: Category | 'custom' | null) => void
  setSeason: (s: Season) => void
  setTime: (h: number) => void
  setTransChoice: (s: number) => void
  togglePause: () => void
  togglePlaying: () => void
  toggleAuto: () => void
  setCinematic: (id: string | null) => void
  toggleUI: () => void
  toggleDetails: () => void
  toggleAudio: () => void
  setQuality: (q: Quality) => void
  setRecording: (b: boolean) => void
  tweak: (partial: Partial<WeatherParams>) => void
  saveCustom: (name: string) => void
  deleteCustom: (id: string) => void
  syncTime: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  presetId: 'clear',
  presetName: '快晴',
  openCategory: null,
  season: 'summer',
  quality: (localStorage.getItem(LS_QUALITY) as Quality) || 'high',
  paused: false,
  auto: false,
  cinematicId: null,
  uiHidden: false,
  detailsOpen: false,
  audioOn: false,
  transChoice: 15,
  timeDisplay: 10,
  playing: false,
  recording: false,
  customPresets: loadCustom(),

  selectPreset: (id) => {
    const p = getPreset(id) || get().customPresets.find(c => c.id === id)
    if (!p) return
    applyPreset(p, get().transChoice)
    set({ presetId: id, presetName: p.name, season: sim.season })
  },
  setOpenCategory: (c) => set(s => ({ openCategory: s.openCategory === c ? null : c })),
  setSeason: (s) => { sim.season = s; set({ season: s }) },
  setTime: (h) => { sim.time = ((h % 24) + 24) % 24; sim.timeTarget = null; set({ timeDisplay: sim.time }) },
  setTransChoice: (s) => set({ transChoice: s }),
  togglePause: () => { sim.paused = !sim.paused; set({ paused: sim.paused }) },
  togglePlaying: () => {
    const playing = !get().playing
    sim.timeSpeed = playing ? 24 / 1200 : 0 // full day in 20 min
    set({ playing })
  },
  toggleAuto: () => { sim.auto = !sim.auto; sim.autoTimer = 0; set({ auto: sim.auto }) },
  setCinematic: (id) => {
    sim.cinematic = id !== null
    set({ cinematicId: id, uiHidden: id !== null })
    if (id === null) sim.timeSpeed = get().playing ? 24 / 1200 : 0
  },
  toggleUI: () => set(s => ({ uiHidden: !s.uiHidden })),
  toggleDetails: () => set(s => ({ detailsOpen: !s.detailsOpen })),
  toggleAudio: () => set(s => ({ audioOn: !s.audioOn })),
  setQuality: (q) => { sim.quality = q; localStorage.setItem(LS_QUALITY, q); set({ quality: q }) },
  setRecording: (b) => set({ recording: b }),
  tweak: (partial) => tweakParams(partial),
  saveCustom: (name) => {
    const id = 'custom-' + Date.now().toString(36)
    const preset: WeatherPreset = {
      id, name: name || 'カスタム', category: 'special',
      time: sim.time, season: sim.season, params: { ...sim.target },
    }
    const customPresets = [...get().customPresets, preset]
    localStorage.setItem(LS_CUSTOM, JSON.stringify(customPresets))
    set({ customPresets, presetId: id, presetName: preset.name })
  },
  deleteCustom: (id) => {
    const customPresets = get().customPresets.filter(p => p.id !== id)
    localStorage.setItem(LS_CUSTOM, JSON.stringify(customPresets))
    set({ customPresets })
  },
  syncTime: () => set({ timeDisplay: sim.time, season: sim.season }),
}))

// keep sim.quality in sync at boot
sim.quality = useAppStore.getState().quality

export { PRESETS }
