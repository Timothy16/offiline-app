// The only contract the UI knows about. Any model/runtime (transformers.js, llama.cpp wasm,
// a native bridge...) can sit behind it. Voice will get its own small interfaces in lib/voice/.

export type Role = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  content: string
}

export interface EngineStatus {
  /** Human-readable model name, e.g. "Qwen3-0.6B". */
  model: string
  /** Where inference will run on this device. */
  device: 'webgpu' | 'wasm'
  /** Model precision/quantization variant, e.g. "q4f16". */
  dtype: string
  /** True when every file needed is already stored on the device (no network needed). */
  cached: boolean
  /** Approximate bytes still to download before `load()` can finish offline. 0 when cached. */
  downloadBytes: number
}

export interface LoadProgress {
  /** "download" while fetching bytes, "init" while the runtime prepares the model. */
  phase: 'download' | 'init'
  loaded: number
  total: number
}

export interface GenerateOptions {
  signal?: AbortSignal
  maxNewTokens?: number
}

export interface LLMEngine {
  /** Cheap check: which variant this device will use and whether it is already stored. */
  inspect(): Promise<EngineStatus>
  /** Download (first run only) and initialise the model. Safe to call more than once. */
  load(onProgress?: (p: LoadProgress) => void): Promise<void>
  /** Stream the assistant reply as text chunks. Abort via `opts.signal`. */
  generate(messages: ChatMessage[], opts?: GenerateOptions): AsyncIterable<string>
  /** Free the model's memory (workers, wasm heap, GPU buffers). The engine is unusable afterwards. */
  dispose(): Promise<void>
}
