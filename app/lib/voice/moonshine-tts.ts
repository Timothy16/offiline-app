// Natural offline voice: Kokoro "Emma" (British female) through Moonshine's text-to-speech (MIT,
// own G2P — no GPL espeak-ng). 100% on-device; the system voice (WebSpeechTTS) stays the fallback.
//
// We drive the library's TTS *worker* directly instead of its `TextToSpeech` class because:
//  - its stop() never resolves a pending say() (it clears the `onended` handlers),
//  - only say() synthesizes off the main thread (synthesize()/stream() would freeze the page),
//  - the class keeps extra copies of the ~109 MB voice on the main thread; here the worker holds
//    the only copy once it is initialised.
import type { LoadProgress } from '../llm/types'
import { type AssetManifest, downloadAsset, manifestBytes, missingAssets, readAsset } from './moonshine-assets'
import { MOONSHINE_BASE } from './moonshine-version'
import type { TTSEngine, TTSStatus } from './types'

const LANGUAGE = 'en_gb'
// Kokoro's highest-graded British voice (B-). Clearly different from most built-in phone voices,
// which makes it obvious when the natural voice is the one speaking. To change voice, change these
// three names; every Kokoro voice uses the same model files plus its own ~0.5 MB voice file.
const VOICE = 'kokoro_bf_emma'
const VOICE_NAME = 'Emma (British)'
const VOICE_FILE = 'kokoro/voices/bf_emma.kokorovoice'

// From the library's own dependency manifest for en_gb + this voice (en_gb uses the en_us
// pronunciation files). NOTE: these CDN paths carry no version, so sizes are verified on download;
// if a file changes upstream the download is rejected and the app keeps the system voice.
const ASSET_BASE = 'https://download.moonshine.ai/tts/'
const FILES: AssetManifest = {
  'en_us/dict_filtered_heteronyms.tsv': 2_900_453,
  'en_us/g2p-config.json': 60,
  'en_us/oov/model.ort': 22_143_488,
  'en_us/oov/onnx-config.json': 4_641,
  'kokoro/prosody.model.ort': 12_376_656,
  'kokoro/prosody.weights.ort': 16_480_288,
  'kokoro/decoder.model.ort': 39_257_640,
  'kokoro/decoder.weights.ort': 15_299_512,
  'kokoro/config.json': 2_351,
  [VOICE_FILE]: 522_252,
}

// Speech stutters if a sentence takes longer to synthesize than to say (ratio > 1). Measured on a
// memory-starved laptop Kokoro ran 12–43× slower than real time, so slowness must be detected
// quickly, never by making the user sit through silent sentences:
//  1. a calibration phrase right after loading (in the background),
//  2. a hard limit on how long one sentence may take to become audible,
//  3. a running average over recent sentences.
const SLOW_RATIO = 1.3
const SLOW_SAMPLES = 3
const CALIBRATION_TEXT = 'Hello, I am ready.'
const CALIBRATION_TIMEOUT_MS = 10_000
const SENTENCE_TIMEOUT_MS = 4_000

const timeout = (ms: number) => new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), ms))

interface Synthesized { audio: Float32Array, sampleRate: number }

/** The library's internal worker host (dist/tts-worker-host.js), which its own say() uses. */
interface TtsWorkerHost {
  setEngine(config: { language: string, keys: string[], buffers: Uint8Array[], optionNames: string[], optionValues: string[] }): Promise<void>
  synthesize(text: string): Promise<Synthesized>
  close(): void
}

export class MoonshineTTS implements TTSEngine {
  private host: TtsWorkerHost | null = null
  private loadPromise: Promise<void> | null = null
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  /** Resolves the speak() that is currently playing (on natural end or stop()). */
  private finishPlaying: (() => void) | null = null
  /** Bumped by stop(): audio synthesized for an older generation is discarded. */
  private generation = 0
  /** Sentences being (or already) synthesized, so the next one is ready when the current ends. */
  private prepared = new Map<string, Promise<Synthesized>>()
  private inFlight = 0
  private ratios: number[] = []
  tooSlow = false

  async inspect(): Promise<TTSStatus> {
    let missing: string[]
    try {
      missing = await missingAssets(ASSET_BASE, FILES)
    }
    catch {
      missing = Object.keys(FILES)
    }
    return {
      available: true,
      offline: missing.length === 0,
      voice: VOICE_NAME,
      downloadBytes: manifestBytes(FILES, missing),
    }
  }

  load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    this.loadPromise ??= (async () => {
      const missing = await missingAssets(ASSET_BASE, FILES)
      if (missing.length) {
        const total = manifestBytes(FILES, missing)
        let loaded = 0
        for (const name of missing) {
          await downloadAsset(ASSET_BASE, FILES, name, (n) => {
            loaded += n
            onProgress?.({ phase: 'download', loaded, total })
          })
        }
      }
      onProgress?.({ phase: 'init', loaded: 0, total: 0 })

      const keys = Object.keys(FILES)
      const buffers = await Promise.all(keys.map(name => readAsset(ASSET_BASE, name)))
      // Served unbundled from /vendor/ like the rest of the library (see modules/moonshine-vendor.ts).
      const { TtsWorkerHost } = await import(/* @vite-ignore */ `${MOONSHINE_BASE}tts-worker-host.js`) as {
        TtsWorkerHost: new () => TtsWorkerHost
      }
      const host = new TtsWorkerHost()
      try {
        // The worker gets its own copy; ours is released when this function returns.
        await host.setEngine({ language: LANGUAGE, keys, buffers, optionNames: ['voice'], optionValues: [VOICE] })
      }
      catch (err) {
        host.close()
        throw err
      }
      this.host = host

      // Can this device keep up? One short phrase decides, before the user ever waits on it.
      const started = performance.now()
      const calibration = host.synthesize(CALIBRATION_TEXT)
      calibration.catch(() => {}) // rejected when we close the worker after a timeout: expected
      const result = await Promise.race([calibration, timeout(CALIBRATION_TIMEOUT_MS)])
      const ratio = result === 'timeout'
        ? Infinity
        : (performance.now() - started) / ((result.audio.length / result.sampleRate) * 1000 || 1)
      if (ratio > SLOW_RATIO) {
        this.tooSlow = true
        this.dispose() // stop burning CPU and free ~109 MB
      }
    })().catch((err) => {
      this.loadPromise = null
      throw err
    })
    return this.loadPromise
  }

  private synthesize(text: string): Promise<Synthesized> {
    const cached = this.prepared.get(text)
    if (cached) return cached
    if (!this.host) return Promise.reject(new Error('Voice is not loaded'))
    // Only time a synthesis that didn't queue behind another one in the worker.
    const measured = this.inFlight === 0
    this.inFlight++
    const started = performance.now()
    const job = this.host.synthesize(text).then((result) => {
      if (measured && result.audio.length) {
        const audioMs = (result.audio.length / result.sampleRate) * 1000
        this.ratios.push((performance.now() - started) / audioMs)
        const recent = this.ratios.slice(-SLOW_SAMPLES)
        if (recent.length === SLOW_SAMPLES && recent.reduce((a, b) => a + b, 0) / SLOW_SAMPLES > SLOW_RATIO) {
          this.tooSlow = true
        }
      }
      return result
    }).finally(() => {
      this.inFlight--
    })
    this.prepared.set(text, job)
    // Keep the cache tiny: it only exists to bridge "prepare" → "speak".
    if (this.prepared.size > 4) this.prepared.delete(this.prepared.keys().next().value!)
    job.catch(() => this.prepared.delete(text))
    return job
  }

  prepare(text: string) {
    if (this.host && text.trim()) void this.synthesize(text).catch(() => {})
  }

  async speak(text: string): Promise<void> {
    if (!text.trim()) return
    const generation = this.generation
    let result: Synthesized | 'timeout'
    try {
      // A sentence that isn't audible within the limit means this device can't keep up right now.
      result = await Promise.race([this.synthesize(text), timeout(SENTENCE_TIMEOUT_MS)])
    }
    finally {
      this.prepared.delete(text)
    }
    if (result === 'timeout') {
      this.tooSlow = true
      // The caller says this sentence with the built-in voice and stops using this engine.
      throw new Error('Natural voice is too slow on this device')
    }
    // Stopped while synthesizing: this audio is no longer wanted.
    if (generation !== this.generation || !result.audio.length) return

    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    if (generation !== this.generation) return
    const buffer = this.ctx.createBuffer(1, result.audio.length, result.sampleRate)
    buffer.copyToChannel(result.audio as Float32Array<ArrayBuffer>, 0)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    this.source = source
    await new Promise<void>((resolve) => {
      const done = () => {
        if (this.source === source) {
          this.source = null
          this.finishPlaying = null
        }
        resolve()
      }
      this.finishPlaying = done
      source.onended = done
      source.start()
    })
  }

  stop() {
    this.generation++
    this.prepared.clear()
    const source = this.source
    const finish = this.finishPlaying
    this.source = null
    this.finishPlaying = null
    if (source) {
      source.onended = null
      try {
        source.stop()
      }
      catch {
        // never started or already ended
      }
      source.disconnect()
    }
    // Always resolve the speak() that was playing, or its caller would wait forever.
    finish?.()
  }

  dispose() {
    this.stop()
    this.host?.close()
    this.host = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}
