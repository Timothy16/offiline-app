// STTEngine using whisper.cpp compiled to WebAssembly (@transcribe/*, MIT) with the English-only
// base model. Same engine family as the chat model (llama.cpp); multi-threaded via COOP/COEP.
// The model file is kept in the Cache API so it works offline after the one-time download.
import type { FileTranscriber } from '@transcribe/transcriber'
import type { LoadProgress } from '../llm/types'
import type { STTEngine, STTStatus } from './types'

// Pinned to a commit so every user gets the exact file we tested.
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en-q5_1.bin'
const MODEL_BYTES = 59_700_000
const CACHE_NAME = 'afronet-models'

// whisper.cpp writes these for silence/noise instead of words.
const NON_SPEECH = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g

async function cachedModel(): Promise<Response | undefined> {
  const cache = await caches.open(CACHE_NAME)
  return cache.match(MODEL_URL)
}

async function downloadModel(onProgress?: (p: LoadProgress) => void) {
  const res = await fetch(MODEL_URL)
  if (!res.ok || !res.body) throw new Error(`Voice model download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || MODEL_BYTES
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress?.({ phase: 'download', loaded, total })
  }
  const cache = await caches.open(CACHE_NAME)
  await cache.put(MODEL_URL, new Response(new Blob(chunks as BlobPart[]), {
    headers: { 'content-type': 'application/octet-stream' },
  }))
}

export class WhisperSTT implements STTEngine {
  private transcriber: FileTranscriber | null = null
  private loadPromise: Promise<void> | null = null

  /** `threads`: override for benchmarking; default is half the logical CPUs (2–4). */
  constructor(private opts: { threads?: number } = {}) {}

  async inspect(): Promise<STTStatus> {
    const cached = !!(await cachedModel().catch(() => undefined))
    return { model: 'Whisper base.en', cached, downloadBytes: cached ? 0 : MODEL_BYTES }
  }

  load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    this.loadPromise ??= (async () => {
      if (!(await cachedModel())) await downloadModel(onProgress)
      onProgress?.({ phase: 'init', loaded: 0, total: 0 })
      const blob = await (await cachedModel())!.blob()
      // Loaded on demand (1.5 MB) so it isn't part of the app shell everyone downloads on first visit.
      const [{ default: createModule }, { FileTranscriber }] = await Promise.all([
        import('@transcribe/shout'),
        import('@transcribe/transcriber'),
      ])
      const transcriber = new FileTranscriber({
        createModule,
        model: new File([blob], 'ggml-base.en-q5_1.bin'),
        print: () => {},
        printErr: () => {},
      })
      await transcriber.init()
      this.transcriber = transcriber
    })().catch((err) => {
      this.loadPromise = null
      throw err
    })
    return this.loadPromise
  }

  async transcribe(audio: Blob): Promise<string> {
    await this.load()
    const result = await this.transcriber!.transcribe(new File([audio], 'speech.webm', { type: audio.type }), {
      lang: 'en',
      // Same rule as llama.cpp: half the logical CPUs (≈ physical/big cores), 2–4.
      threads: this.opts.threads ?? Math.min(4, Math.max(2, Math.floor((navigator.hardwareConcurrency || 2) / 2))),
      suppress_non_speech: true,
      token_timestamps: false,
    })
    return result.transcription
      .map(s => s.text)
      .join(' ')
      .replace(NON_SPEECH, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  async dispose() {
    this.transcriber?.destroy()
    this.transcriber = null
    this.loadPromise = null
  }
}
