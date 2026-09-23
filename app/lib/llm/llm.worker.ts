// The only file that touches transformers.js. Runs off the main thread so the UI stays responsive.
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  InterruptableStoppingCriteria,
  ModelRegistry,
  TextStreamer,
} from '@huggingface/transformers'
import type { PreTrainedModel, PreTrainedTokenizer } from '@huggingface/transformers'
import { MODEL_ID, MODEL_NAME, supportsWebGPUf16, WASM_VARIANT, WEBGPU_VARIANT } from './device'
import type { Variant } from './device'
import type { WorkerRequest, WorkerResponse } from './protocol'
import type { ChatMessage, EngineStatus } from './types'

env.allowLocalModels = false

let tokenizer: PreTrainedTokenizer | null = null
let model: PreTrainedModel | null = null
let loading: Promise<void> | null = null
const stopping = new InterruptableStoppingCriteria()

function post(msg: WorkerResponse) {
  self.postMessage(msg)
}

const ortUrl = (v: Variant, ext: '.wasm' | '.mjs') => new URL(`/ort/${v.ortBuild}${ext}`, self.location.origin).href

async function isCached(v: Variant): Promise<boolean> {
  try {
    const cache = await caches.open(env.cacheKey)
    if (!(await cache.match(ortUrl(v, '.wasm')))) return false
    return await ModelRegistry.is_cached(MODEL_ID, { dtype: v.dtype, device: v.device })
  }
  catch {
    return false
  }
}

// Prefer whatever is already on the device so a browser update never triggers a second 600 MB download.
async function pickVariant(): Promise<{ variant: Variant, cached: boolean }> {
  const f16 = await supportsWebGPUf16()
  const candidates = f16 ? [WEBGPU_VARIANT, WASM_VARIANT] : [WASM_VARIANT]
  for (const v of candidates) {
    if (await isCached(v)) return { variant: v, cached: true }
  }
  return { variant: candidates[0]!, cached: false }
}

async function inspect(): Promise<EngineStatus> {
  const { variant: v, cached } = await pickVariant()
  return {
    model: MODEL_NAME,
    device: v.device,
    dtype: v.dtype,
    cached,
    downloadBytes: cached ? 0 : v.downloadBytes,
  }
}

// Download a file into the cache transformers.js reads the runtime from, reporting bytes as they arrive.
async function fetchToCache(url: string, onBytes: (loaded: number, total: number) => void) {
  const cache = await caches.open(env.cacheKey)
  if (await cache.match(url)) return
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onBytes(loaded, total || loaded)
  }
  await cache.put(url, new Response(new Blob(chunks as BlobPart[]), { headers: res.headers }))
}

async function load(threads?: number) {
  const { variant: v, cached } = await pickVariant()

  // Aggregate per-file byte progress into one bar, throttled to keep postMessage traffic low.
  const files = new Map<string, { loaded: number, total: number }>()
  let lastPost = 0
  let initStarted = false
  const report = (force = false) => {
    if (initStarted) return
    const now = performance.now()
    if (!force && now - lastPost < 150) return
    lastPost = now
    let loaded = 0
    let total = 0
    for (const f of files.values()) {
      loaded += f.loaded
      total += f.total
    }
    if (!cached) total = Math.max(total, v.downloadBytes)
    post({ type: 'progress', progress: { phase: 'download', loaded, total } })
  }
  const startInit = () => {
    if (initStarted) return
    initStarted = true
    post({ type: 'progress', progress: { phase: 'init', loaded: 0, total: 0 } })
  }
  const progress_callback = (info: any) => {
    if (info.status === 'progress' && info.file) {
      files.set(info.file, { loaded: info.loaded, total: info.total })
      report()
    }
    else if (info.status === 'done' && typeof info.file === 'string' && info.file.endsWith('.onnx')) {
      report(true)
      startInit()
    }
  }

  if (threads) env.backends.onnx.wasm!.numThreads = threads

  // Self-hosted runtime, stored in the Cache API so later launches work offline.
  env.backends.onnx.wasm!.wasmPaths = { wasm: ortUrl(v, '.wasm'), mjs: ortUrl(v, '.mjs') }
  await Promise.all([
    fetchToCache(ortUrl(v, '.wasm'), (loaded, total) => {
      files.set('ort.wasm', { loaded, total })
      report()
    }),
    fetchToCache(ortUrl(v, '.mjs'), () => {}),
  ])

  const [tok, mdl] = await Promise.all([
    AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback }),
    AutoModelForCausalLM.from_pretrained(MODEL_ID, { dtype: v.dtype, device: v.device, progress_callback }),
  ])
  startInit()
  tokenizer = tok
  model = mdl

  // Warm-up: compiles WebGPU shaders / wasm kernels now instead of on the user's first question.
  await model.generate({ ...tokenizer('Hi'), max_new_tokens: 1 } as any)
}

async function generate(id: number, messages: ChatMessage[], maxNewTokens: number) {
  if (!tokenizer || !model) throw new Error('Model not loaded')
  stopping.reset()
  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
    enable_thinking: false, // Qwen3: skip the <think> block — faster, fewer tokens
  } as any) as Record<string, unknown>
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => {
      if (text) post({ type: 'chunk', id, text })
    },
  })
  // Qwen3's recommended sampling for non-thinking mode.
  await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: true,
    temperature: 0.7,
    top_p: 0.8,
    top_k: 20,
    streamer,
    stopping_criteria: stopping,
  } as any)
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'interrupt') {
    stopping.interrupt()
    return
  }
  try {
    if (msg.type === 'inspect') {
      post({ type: 'result', id: msg.id, value: await inspect() })
    }
    else if (msg.type === 'load') {
      loading ??= load(msg.threads).catch((err) => {
        loading = null
        throw err
      })
      await loading
      post({ type: 'result', id: msg.id })
    }
    else if (msg.type === 'generate') {
      await generate(msg.id, msg.messages, msg.maxNewTokens)
      post({ type: 'result', id: msg.id })
    }
  }
  catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) })
  }
}
