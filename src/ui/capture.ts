// Screenshot (PNG) + WebM recording of the WebGL canvas.
import { useAppStore } from '../stores/appStore'

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function getCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas')
}

/** Save the current frame as a PNG (canvas has preserveDrawingBuffer). */
export function capturePNG(): void {
  const canvas = getCanvas()
  if (!canvas) return
  canvas.toBlob(blob => {
    if (blob) download(blob, `kawaguchiko-${stamp()}.png`)
  }, 'image/png')
}

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []

export function isRecording(): boolean {
  return recorder !== null
}

/** Start recording the canvas to WebM. Returns false if unavailable / already recording. */
export function startRecording(): boolean {
  if (recorder) return false
  const canvas = getCanvas()
  if (!canvas || typeof MediaRecorder === 'undefined') return false
  const stream = canvas.captureStream(30)
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm'
  let rec: MediaRecorder
  try {
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  } catch {
    try { rec = new MediaRecorder(stream) } catch { return false }
  }
  chunks = []
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' })
    chunks = []
    stream.getTracks().forEach(t => t.stop())
    recorder = null
    useAppStore.getState().setRecording(false)
    if (blob.size > 0) download(blob, `kawaguchiko-${stamp()}.webm`)
  }
  recorder = rec
  rec.start(1000)
  useAppStore.getState().setRecording(true)
  return true
}

/** Stop recording; triggers the WebM download via onstop. */
export function stopRecording(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop()
}

export function toggleRecording(): void {
  if (recorder) stopRecording()
  else startRecording()
}
