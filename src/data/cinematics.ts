export interface CinematicStep {
  presetId: string
  time?: number // time of day to tween toward
  hold: number // seconds to hold after transition
  trans: number // transition seconds
}
export interface CinematicSequence {
  id: string
  name: string
  timeSpeed?: number // hours per second while this sequence runs
  steps: CinematicStep[]
}

export const CINEMATICS: CinematicSequence[] = [
  {
    id: 'day', name: '河口湖の一日', timeSpeed: 24 / 600, // full day in 10 min
    steps: [
      { presetId: 'calm-morning', time: 4.0, hold: 60, trans: 20 },
      { presetId: 'akafuji', hold: 60, trans: 30 },
      { presetId: 'clear', hold: 120, trans: 40 },
      { presetId: 'thin-clouds', hold: 90, trans: 40 },
      { presetId: 'sunset', hold: 80, trans: 40 },
      { presetId: 'starry-night', hold: 120, trans: 40 },
    ],
  },
  {
    id: 'storm', name: '嵐が通り過ぎる湖畔',
    steps: [
      { presetId: 'clear', time: 14, hold: 25, trans: 10 },
      { presetId: 'heavy-overcast', hold: 20, trans: 40 },
      { presetId: 'thunderstorm', hold: 60, trans: 40 },
      { presetId: 'storm-passed', hold: 40, trans: 45 },
      { presetId: 'sunshower', hold: 40, trans: 30 },
    ],
  },
  {
    id: 'winter-morning', name: '冬の静かな朝',
    steps: [
      { presetId: 'quiet-snow', time: 6.5, hold: 45, trans: 15 },
      { presetId: 'first-snow', hold: 30, trans: 45 },
      { presetId: 'snow-clear', hold: 90, trans: 60 },
    ],
  },
  {
    id: 'fog-fuji', name: '霧から現れる富士山',
    steps: [
      { presetId: 'dense-fog', time: 6.8, hold: 30, trans: 10 },
      { presetId: 'fog-clearing', hold: 40, trans: 60 },
      { presetId: 'lake-mist', hold: 40, trans: 50 },
      { presetId: 'calm-morning', hold: 60, trans: 50 },
    ],
  },
]
