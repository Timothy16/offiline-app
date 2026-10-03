// STTEngine using Moonshine Tiny Streaming (English) via the official @moonshine-ai/moonshine-wasm
// (MIT). Streaming: it transcribes while the user is still talking, so little work is left when
// they stop (measured 0.5–0.7 s on a phone vs ~74 s for Whisper in the browser). Its built-in VAD
// decides where a phrase ends. Needs cross-origin isolation (COOP/COEP) for its threads.
//
// Model files are downloaded by us (real progress + size check) into the same Cache Storage bucket
// the library reads (`moonshine-models-v1`), so later launches load them with no network.
import type { MicTranscriber, Transcriber } from '@moonshine-ai/moonshine-wasm'
import type { LoadProgress } from '../llm/types'
import { MOONSHINE_BASE } from './moonshine-version'
import type { ListenOptions, ListenSession, STTEngine, STTStatus } from './types'

type MoonshineLib = typeof import('@moonshine-ai/moonshine-wasm')

// The library is served unbundled from /vendor/ (see modules/moonshine-vendor.ts for why).
const LIB_URL = `${MOONSHINE_BASE}index.js`
const RUNTIME_WASM_URL = `${MOONSHINE_BASE}moonshine.wasm`

// Pinned to the model version the pinned library (0.1.5) was built against.
const MODEL_BASE = 'https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_07_30/'
const MODEL_FILES: Record<string, number> = {
  'frontend.ort': 8_324_920,
  'encoder.ort': 7_675_440,
  'adapter.ort': 1_319_664,
  'cross_kv.ort': 1_287_544,
  'decoder_kv.ort': 32_583_720,
  'streaming_config.json': 509,
  'tokenizer.bin': 249_974,
}
const RUNTIME_BYTES = 13_155_937 // moonshine.wasm, cached by the service worker on first use
const CACHE_NAME = 'moonshine-models-v1' // the library's own cache bucket

// Words the tiny model would otherwise mishear ("Go to FAQ" → "Go to every kid", "chat" →
// "church"). Keep short: every term slightly lowers accuracy on other words.
const KEYTERMS = ['FAQ', 'Afronet', 'chat', 'help']
// Documented range 1.0–4.0 (default 2.0); higher favours the terms more. Tune with real voices.
const KEYTERM_BOOST = '3.0'

// A pause inside a sentence ("read question … three") can end a line. Wait this long after a
// line ends for the user to continue before treating the turn as finished.
const CONTINUE_GRACE_MS = 450
// Give up when no speech starts at all, and cap very long turns.
const NO_SPEECH_MS = 7000
const MAX_TURN_MS = 20000

const modelUrl = (name: string) => MODEL_BASE + name
const MODEL_BYTES = Object.values(MODEL_FILES).reduce((a, b) => a + b, 0)

async function missingFiles(): Promise<string[]> {
  const cache = await caches.open(CACHE_NAME)
  const missing: string[] = []
  for (const name of Object.keys(MODEL_FILES)) {
    if (!(await cache.match(modelUrl(name)))) missing.push(name)
  }
  return missing
}

/** Download with progress; only complete, correctly-sized files are ever cached. */
async function downloadFile(name: string, onBytes: (n: number) => void) {
  const res = await fetch(modelUrl(name))
  if (!res.ok || !res.body) throw new Error(`Voice model download failed (${name}: ${res.status})`)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    onBytes(value.byteLength)
  }
  if (size !== MODEL_FILES[name]) throw new Error(`Voice model download was incomplete (${name}). Please try again.`)
  const cache = await caches.open(CACHE_NAME)
  await cache.put(modelUrl(name), new Response(new Blob(chunks as BlobPart[]), {
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' },
  }))
}

export class MoonshineSTT implements STTEngine {
  private transcriber: Transcriber | null = null
  private lib: MoonshineLib | null = null
  private loadPromise: Promise<void> | null = null
  private active: ListenSession | null = null

  async inspect(): Promise<STTStatus> {
    let missing: string[]
    try {
      missing = await missingFiles()
    }
    catch {
      missing = Object.keys(MODEL_FILES)
    }
    const bytes = missing.reduce((sum, name) => sum + MODEL_FILES[name]!, 0)
    return {
      model: 'Moonshine Tiny Streaming (English)',
      cached: missing.length === 0,
      // The runtime is only fetched when something is missing (first install).
      downloadBytes: missing.length ? bytes + RUNTIME_BYTES : 0,
    }
  }

  load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    this.loadPromise ??= (async () => {
      const missing = await missingFiles()
      if (missing.length) {
        const total = missing.reduce((sum, n) => sum + MODEL_FILES[n]!, 0) + RUNTIME_BYTES
        let loaded = 0
        const bump = (n: number) => {
          loaded += n
          onProgress?.({ phase: 'download', loaded, total })
        }
        // Fetch the runtime through the service worker so it's cached for offline use.
        const runtime = fetch(RUNTIME_WASM_URL).then(async (r) => {
          if (!r.ok) throw new Error(`Voice runtime download failed (${r.status})`)
          bump((await r.arrayBuffer()).byteLength)
        })
        for (const name of missing) await downloadFile(name, bump)
        await runtime
      }
      onProgress?.({ phase: 'init', loaded: 0, total: 0 })

      // Moonshine's threaded WASM needs SharedArrayBuffer; without isolation it fails inside the
      // library with an uncaught error and loadFromUrls() never settles (setup would spin forever).
      if (!crossOriginIsolated) {
        throw new Error('Speech recognition needs a cross-origin isolated page (COOP/COEP headers missing)')
      }

      // Loaded on demand so the app shell stays small.
      this.lib = await import(/* @vite-ignore */ LIB_URL) as MoonshineLib
      this.transcriber = await this.lib.Transcriber.loadFromUrls(
        Object.fromEntries(Object.keys(MODEL_FILES).map(n => [n, modelUrl(n)])),
        {
          modelArch: this.lib.ModelArch.TinyStreaming,
          options: {
            keyterms: KEYTERMS.join(','),
            keyterm_boost: KEYTERM_BOOST,
            // We only need text; don't keep a copy of every line's audio in memory.
            return_audio_data: 'false',
          },
        },
      )
    })().catch((err) => {
      this.loadPromise = null
      throw err
    })
    return this.loadPromise
  }

  listen({ onReady, onPartial }: ListenOptions = {}): ListenSession {
    // One turn at a time: a new turn ends the previous one.
    this.active?.cancel()

    const lines: string[] = [] // finished lines of this turn
    let current = '' // line still being spoken
    let finished = false
    let discard = false
    let mic: MicTranscriber | null = null
    /** Pending while the microphone opens; stopping must wait for it or the mic stays on. */
    let opening: Promise<void> | null = null
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let noSpeechTimer: ReturnType<typeof setTimeout> | undefined
    let maxTimer: ReturnType<typeof setTimeout> | undefined
    let resolveResult!: (text: string) => void
    let rejectResult!: (err: unknown) => void
    const result = new Promise<string>((res, rej) => {
      resolveResult = res
      rejectResult = rej
    })

    const text = () => [...lines, current].map(s => s.trim()).filter(Boolean).join(' ')

    /** Stop timers, release the microphone and stream (the shared model stays loaded). */
    const release = async () => {
      clearTimeout(graceTimer)
      clearTimeout(noSpeechTimer)
      clearTimeout(maxTimer)
      if (this.active === session) this.active = null
      const m = mic
      mic = null
      if (!m) return
      await opening?.catch(() => {})
      try {
        // stop() flushes a final pass, so the last words arrive as a completed line.
        await m.stop()
      }
      catch {}
      m.close()
    }

    const finish = async () => {
      if (finished) return
      finished = true
      await release()
      resolveResult(discard ? '' : text())
    }

    const fail = async (err: unknown) => {
      if (finished) return
      finished = true
      await release()
      rejectResult(err)
    }

    const session: ListenSession = {
      result,
      stop: () => void finish(),
      cancel: () => {
        discard = true
        void finish()
      },
    }
    this.active = session

    void (async () => {
      try {
        await this.load()
        if (finished) return
        mic = new this.lib!.MicTranscriber()
          .useTranscriber(this.transcriber!)
          .audioConstraints({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
          .onError(err => void fail(err))
          .addListener({
            onLineStarted: () => {
              clearTimeout(graceTimer)
              clearTimeout(noSpeechTimer)
            },
            onLineTextChanged: ({ line }) => {
              current = line.text
              onPartial?.(text())
            },
            onLineCompleted: ({ line }) => {
              current = ''
              if (line.text.trim()) lines.push(line.text.trim())
              onPartial?.(text())
              if (!finished) {
                clearTimeout(graceTimer)
                graceTimer = setTimeout(() => void finish(), CONTINUE_GRACE_MS)
              }
            },
          })
        opening = mic.start()
        await opening
        opening = null
        if (finished) return
        onReady?.()
        noSpeechTimer = setTimeout(() => void finish(), NO_SPEECH_MS)
        maxTimer = setTimeout(() => void finish(), MAX_TURN_MS)
      }
      catch (err) {
        opening = null
        await fail(err)
      }
    })()

    return session
  }

  async dispose() {
    this.active?.cancel()
    this.transcriber?.close()
    this.transcriber = null
    this.loadPromise = null
  }
}
