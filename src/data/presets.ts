import { DEFAULT_PARAMS, type WeatherParams, type WeatherPreset, type Category, type Season } from '../engine/sim'

function P(id: string, name: string, category: Category, over: Partial<WeatherParams>, time?: number, season?: Season): WeatherPreset {
  return { id, name, category, time, season, params: { ...DEFAULT_PARAMS, ...over } }
}

export const PRESETS: WeatherPreset[] = [
  // ---- 晴天系 ----
  P('clear', '快晴', 'clear', {
    cloudCoverage: 0.02, visibility: 1, fujiVisibility: 1, sunIntensity: 1.05, lakeWave: 0.12, windSpeed: 0.14, temperature: 20,
  }, 11),
  P('thin-clouds', '薄雲の晴れ', 'clear', {
    cloudCoverage: 0.35, cloudHeight: 0.95, cloudDensity: 0.15, sunIntensity: 0.9, fujiVisibility: 0.95, temperature: 19,
  }, 13),
  P('calm-morning', '風のない朝', 'clear', {
    windSpeed: 0.02, lakeWave: 0.02, mist: 0.35, fogDensity: 0.03, fujiVisibility: 1, sunIntensity: 0.85, humidity: 0.7, temperature: 13,
  }, 6.2),
  P('summer-sky', '夏の青空', 'clear', {
    cloudCoverage: 0.28, cloudHeight: 0.55, cloudDensity: 0.55, cumulonimbus: 0.25, sunIntensity: 1.15, windSpeed: 0.22, temperature: 29, humidity: 0.6,
  }, 11.5, 'summer'),
  P('winter-clear', '冬晴れ', 'clear', {
    cloudCoverage: 0.03, visibility: 1, sunIntensity: 0.95, temperature: 2, humidity: 0.25, windSpeed: 0.18, wetness: 0.05, snowCover: 0.08,
  }, 10.5, 'winter'),
  // ---- 曇天系 ----
  P('high-overcast', '薄曇り', 'cloudy', {
    cloudCoverage: 0.75, cloudHeight: 0.85, cloudDensity: 0.3, sunIntensity: 0.6, fujiVisibility: 0.9, temperature: 17,
  }, 12),
  P('overcast', '曇り', 'cloudy', {
    cloudCoverage: 0.95, cloudHeight: 0.6, cloudDensity: 0.6, sunIntensity: 0.35, fujiVisibility: 0.75, visibility: 0.85, lakeWave: 0.2, temperature: 15,
  }, 13),
  P('heavy-overcast', '重い曇り空', 'cloudy', {
    cloudCoverage: 1, cloudHeight: 0.3, cloudDensity: 0.85, sunIntensity: 0.18, fujiVisibility: 0.45, visibility: 0.7, humidity: 0.85, windSpeed: 0.3, lakeWave: 0.3, temperature: 14,
  }, 15),
  P('fuji-hidden', '富士山だけ雲隠れ', 'cloudy', {
    cloudCoverage: 0.4, cloudHeight: 0.45, cloudDensity: 0.6, sunIntensity: 0.8, fujiVisibility: 0.4, temperature: 18,
  }, 10),
  P('kasagumo', '笠雲', 'cloudy', {
    cloudCoverage: 0.3, cloudHeight: 0.8, cloudDensity: 0.4, kasagumo: 1, sunIntensity: 0.75, fujiVisibility: 0.85, humidity: 0.75, windSpeed: 0.28, temperature: 16,
  }, 9),
  // ---- 雨天系 ----
  P('drizzle', '小雨', 'rain', {
    cloudCoverage: 0.95, cloudHeight: 0.4, cloudDensity: 0.7, rainIntensity: 0.2, sunIntensity: 0.25, fujiVisibility: 0.5, visibility: 0.7, wetness: 0.4, humidity: 0.9, lakeWave: 0.22, temperature: 14,
  }, 13),
  P('long-rain', '静かな長雨', 'rain', {
    cloudCoverage: 1, cloudHeight: 0.35, cloudDensity: 0.75, rainIntensity: 0.4, sunIntensity: 0.18, fujiVisibility: 0.3, visibility: 0.55, wetness: 0.75, humidity: 0.95, mist: 0.15, lakeWave: 0.25, temperature: 13,
  }, 14),
  P('passing-shower', '通り雨', 'rain', {
    cloudCoverage: 0.65, cloudHeight: 0.45, cloudDensity: 0.65, rainIntensity: 0.55, sunIntensity: 0.45, fujiVisibility: 0.55, visibility: 0.75, wetness: 0.5, windSpeed: 0.35, cloudSpeed: 0.6, lakeWave: 0.3, temperature: 16,
  }, 15),
  P('heavy-rain', '強い雨', 'rain', {
    cloudCoverage: 1, cloudHeight: 0.3, cloudDensity: 0.85, rainIntensity: 0.75, sunIntensity: 0.12, fujiVisibility: 0.15, visibility: 0.45, wetness: 0.9, windSpeed: 0.4, humidity: 1, lakeWave: 0.45, temperature: 15,
  }, 14),
  P('downpour', '豪雨', 'rain', {
    cloudCoverage: 1, cloudHeight: 0.2, cloudDensity: 1, rainIntensity: 1, sunIntensity: 0.07, fujiVisibility: 0.03, visibility: 0.25, wetness: 1, windSpeed: 0.5, humidity: 1, lakeWave: 0.55, fogDensity: 0.1, temperature: 16,
  }, 13),
  P('sunshower', '天気雨', 'special', {
    cloudCoverage: 0.35, cloudHeight: 0.6, cloudDensity: 0.4, rainIntensity: 0.3, sunIntensity: 0.9, fujiVisibility: 0.85, rainbow: 1, wetness: 0.4, temperature: 19,
  }, 15.5),
  P('after-rain', '雨上がり', 'rain', {
    cloudCoverage: 0.55, cloudHeight: 0.5, cloudDensity: 0.45, rainIntensity: 0.05, sunIntensity: 0.7, fujiVisibility: 0.7, wetness: 0.85, mist: 0.4, humidity: 0.95, cloudSpeed: 0.45, rainbow: 0.3, temperature: 15,
  }, 16),
  // ---- 雷・嵐系 ----
  P('distant-thunder', '遠雷', 'storm', {
    cloudCoverage: 0.8, cloudHeight: 0.45, cloudDensity: 0.75, cumulonimbus: 0.7, rainIntensity: 0.15, lightningFrequency: 0.25, sunIntensity: 0.2, fujiVisibility: 0.4, visibility: 0.65, wetness: 0.3, temperature: 19,
  }, 18),
  P('thunderstorm', '雷雨', 'storm', {
    cloudCoverage: 1, cloudHeight: 0.25, cloudDensity: 1, cumulonimbus: 1, rainIntensity: 0.8, lightningFrequency: 0.65, sunIntensity: 0.08, fujiVisibility: 0.1, visibility: 0.4, wetness: 0.95, windSpeed: 0.5, lakeWave: 0.55, temperature: 18,
  }, 16),
  P('violent-storm', '激しい嵐', 'storm', {
    cloudCoverage: 1, cloudHeight: 0.2, cloudDensity: 1, cumulonimbus: 1, rainIntensity: 1, lightningFrequency: 0.8, sunIntensity: 0.05, fujiVisibility: 0.02, visibility: 0.25, wetness: 1, windSpeed: 0.95, lakeWave: 0.95, cloudSpeed: 1, humidity: 1, temperature: 17,
  }, 15),
  P('storm-passed', '嵐の通過後', 'storm', {
    cloudCoverage: 0.55, cloudHeight: 0.5, cloudDensity: 0.6, cumulonimbus: 0.3, rainIntensity: 0.08, lightningFrequency: 0.1, sunIntensity: 0.75, fujiVisibility: 0.6, wetness: 0.9, windSpeed: 0.35, cloudSpeed: 0.7, mist: 0.2, lakeWave: 0.35, temperature: 16,
  }, 17),
  // ---- 霧系 ----
  P('lake-mist', '湖面の朝霧', 'fog', {
    mist: 0.9, fogDensity: 0.06, windSpeed: 0.05, lakeWave: 0.05, sunIntensity: 0.75, fujiVisibility: 0.9, humidity: 0.95, temperature: 11,
  }, 5.8),
  P('thin-fog', '薄い霧', 'fog', {
    fogDensity: 0.3, mist: 0.3, visibility: 0.6, sunIntensity: 0.5, fujiVisibility: 0.6, windSpeed: 0.08, humidity: 0.95, lakeWave: 0.08, temperature: 12,
  }, 8),
  P('dense-fog', '濃霧', 'fog', {
    fogDensity: 1, mist: 0.8, visibility: 0.1, sunIntensity: 0.3, fujiVisibility: 0, windSpeed: 0.04, humidity: 1, lakeWave: 0.05, cloudCoverage: 0.9, cloudHeight: 0.3, temperature: 10,
  }, 7),
  P('fog-clearing', '霧が晴れる瞬間', 'fog', {
    fogDensity: 0.35, mist: 0.5, visibility: 0.5, sunIntensity: 0.7, fujiVisibility: 0.65, windSpeed: 0.12, humidity: 0.9, cloudCoverage: 0.3, temperature: 12,
  }, 8.5),
  // ---- 雪系 ----
  P('first-snow', '初雪', 'snow', {
    cloudCoverage: 0.85, cloudHeight: 0.5, cloudDensity: 0.6, snowIntensity: 0.25, sunIntensity: 0.35, fujiVisibility: 0.6, snowCover: 0.05, temperature: 1, humidity: 0.8, visibility: 0.8,
  }, 14, 'winter'),
  P('quiet-snow', '静かな雪', 'snow', {
    cloudCoverage: 0.95, cloudHeight: 0.45, cloudDensity: 0.65, snowIntensity: 0.5, sunIntensity: 0.28, fujiVisibility: 0.4, snowCover: 0.5, windSpeed: 0.06, temperature: -1, visibility: 0.65, lakeWave: 0.08,
  }, 15, 'winter'),
  P('heavy-snow', '大雪', 'snow', {
    cloudCoverage: 1, cloudHeight: 0.3, cloudDensity: 0.85, snowIntensity: 0.85, sunIntensity: 0.18, fujiVisibility: 0.12, snowCover: 0.85, windSpeed: 0.2, temperature: -3, visibility: 0.4,
  }, 13, 'winter'),
  P('blizzard', '吹雪', 'snow', {
    cloudCoverage: 1, cloudHeight: 0.2, cloudDensity: 1, snowIntensity: 1, sunIntensity: 0.1, fujiVisibility: 0.02, snowCover: 1, windSpeed: 0.9, temperature: -6, visibility: 0.2, lakeWave: 0.6, cloudSpeed: 1,
  }, 14, 'winter'),
  P('snow-clear', '雪上がりの快晴', 'snow', {
    cloudCoverage: 0.06, snowCover: 1, sunIntensity: 1.05, fujiVisibility: 1, temperature: -2, visibility: 1, windSpeed: 0.1, wetness: 0.15,
  }, 10, 'winter'),
  // ---- 特殊景観系 ----
  P('akafuji', '朝焼けと赤富士', 'special', {
    cloudCoverage: 0.12, cloudHeight: 0.85, cloudDensity: 0.2, sunIntensity: 0.75, fujiVisibility: 1, windSpeed: 0.06, lakeWave: 0.05, mist: 0.15, temperature: 10,
  }, 5.1, 'autumn'),
  P('sunset', '夕焼け', 'special', {
    cloudCoverage: 0.3, cloudHeight: 0.8, cloudDensity: 0.3, sunIntensity: 0.85, fujiVisibility: 0.95, windSpeed: 0.12, lakeWave: 0.12, temperature: 16,
  }, 18.1, 'autumn'),
  P('rainbow', '虹', 'special', {
    cloudCoverage: 0.45, cloudHeight: 0.55, cloudDensity: 0.4, rainIntensity: 0.12, sunIntensity: 0.85, fujiVisibility: 0.8, rainbow: 1, wetness: 0.7, mist: 0.1, temperature: 17,
  }, 16),
  P('starry-night', '夜の快晴', 'special', {
    cloudCoverage: 0.02, sunIntensity: 0.8, fujiVisibility: 0.9, windSpeed: 0.08, lakeWave: 0.06, temperature: 9, visibility: 1,
  }, 22.5),
  P('moonlit-snow', '月明かりの雪景色', 'special', {
    cloudCoverage: 0.08, snowCover: 1, sunIntensity: 0.8, fujiVisibility: 0.9, windSpeed: 0.05, lakeWave: 0.05, temperature: -5, visibility: 1,
  }, 22, 'winter'),
  P('meteor-night', '流れ星の夜', 'special', {
    cloudCoverage: 0, sunIntensity: 0.8, fujiVisibility: 0.9, windSpeed: 0.04, lakeWave: 0.04, temperature: 7, visibility: 1,
  }, 23.5, 'autumn'),
]

export const CATEGORIES: { key: Category; icon: string; label: string }[] = [
  { key: 'clear', icon: '☀', label: '晴' },
  { key: 'cloudy', icon: '☁', label: '曇' },
  { key: 'rain', icon: '🌧', label: '雨' },
  { key: 'storm', icon: '⚡', label: '雷' },
  { key: 'fog', icon: '🌫', label: '霧' },
  { key: 'snow', icon: '❄', label: '雪' },
  { key: 'special', icon: '✦', label: '特' },
]

export function getPreset(id: string): WeatherPreset | undefined {
  return PRESETS.find(p => p.id === id)
}
