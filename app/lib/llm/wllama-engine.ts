// LLMEngine backed by llama.cpp (wllama) running a GGUF model. wllama runs its own worker and
// stores downloaded models in OPFS. Multi-threading needs cross-origin isolation (COOP/COEP headers).
import { LoggerWithoutDebug, Wllama, WllamaAbortError } from '@wllama/wllama/esm/index.js' // package 'main' is broken; use the built bundle
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url'
import type { ChatMessage, EngineStatus, GenerateOptions, LLMEngine, LoadProgress } from './types'

// Pinned to a commit so every user gets the exact file we benchmarked, even if the repo changes.
const MODEL_URL = 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_K_M.gguf'
const MB = 1_000_000
const DOWNLOAD_BYTES = (397 + 8) * MB // model + llama.cpp wasm

export interface WllamaEngineOptions {
  /** Offload layers to WebGPU when available. Default false (CPU). */
  gpu?: boolean
  /** CPU threads; default lets wllama pick (needs cross-origin isolation for >1). */
  threads?: number
}

export class WllamaEngine implements LLMEngine {
  private wllama = new Wllama({ default: wasmUrl }, {
    allowOffline: true,
    suppressNativeLog: true,
    logger: LoggerWithoutDebug,
  })

  private loadPromise: Promise<void> | null = null

  constructor(private opts: WllamaEngineOptions = {}) {}

  private get device(): EngineStatus['device'] {
    return this.opts.gpu && 'gpu' in navigator ? 'webgpu' : 'wasm'
  }

  private async isCached(): Promise<boolean> {
    try {
      const cm = this.wllama.cacheManager
      return (await cm.getSize(await cm.getNameFromURL(MODEL_URL))) > 0
    }
    catch {
      return false
    }
  }

  async inspect(): Promise<EngineStatus> {
    const cached = await this.isCached()
    return {
      model: 'Qwen3-0.6B',
      device: this.device,
      dtype: 'Q4_K_M',
      cached,
      downloadBytes: cached ? 0 : DOWNLOAD_BYTES,
    }
  }

  load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    this.loadPromise ??= (async () => {
      let initStarted = false
      await this.wllama.loadModelFromUrl(MODEL_URL, {
        n_ctx: 2048,
        n_threads: this.opts.threads,
        n_gpu_layers: this.device === 'webgpu' ? 999 : 0,
        progressCallback: ({ loaded, total }) => {
          if (initStarted) return
          if (total && loaded >= total) {
            initStarted = true
            onProgress?.({ phase: 'init', loaded: 0, total: 0 })
          }
          else {
            onProgress?.({ phase: 'download', loaded, total })
          }
        },
      })
    })().catch((err) => {
      this.loadPromise = null
      throw err
    })
    return this.loadPromise
  }

  async* generate(messages: ChatMessage[], opts: GenerateOptions = {}): AsyncIterable<string> {
    const stream = await this.wllama.createChatCompletion({
      messages: messages.map(({ role, content }) => ({ role, content })),
      stream: true,
      max_tokens: opts.maxNewTokens ?? 512,
      abortSignal: opts.signal,
      // Reuse the already-processed start of the conversation (system prompt, earlier turns):
      // only the new question has to be read, which is most of the wait on slow CPUs.
      cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false }, // Qwen3: skip the <think> block
      // Qwen3's recommended sampling for non-thinking mode.
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
    } as Parameters<Wllama['createChatCompletion']>[0] & { stream: true })
    try {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content
        if (text) yield text
      }
    }
    catch (err) {
      if (!(err instanceof WllamaAbortError)) throw err
    }
  }

  async dispose() {
    await this.wllama.exit()
  }
}
