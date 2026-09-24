// Voice contracts. Like LLMEngine, UI never touches a concrete engine — composables pick one,
// so voices/languages/runtimes can be swapped (built-in voice now, Piper next).
import type { LoadProgress } from '../llm/types'

export interface TTSStatus {
  /** False when this device can't speak at all (no engine / no English voice). */
  available: boolean
  /** True when speech works with no network (voice is installed on the device). */
  offline: boolean
  /** Human-readable voice name, for debugging and settings. */
  voice: string
}

export interface TTSEngine {
  inspect(): Promise<TTSStatus>
  /** Speak one short piece of text (a sentence). Resolves when finished or stopped. */
  speak(text: string): Promise<void>
  /** Stop immediately and drop anything in progress. */
  stop(): void
}

export interface STTStatus {
  model: string
  /** True when the model is stored on the device (works offline). */
  cached: boolean
  /** Bytes still to download before `load()` can finish offline. 0 when cached. */
  downloadBytes: number
}

export interface STTEngine {
  inspect(): Promise<STTStatus>
  /** Download (first run only) and initialise the model. Safe to call more than once. */
  load(onProgress?: (p: LoadProgress) => void): Promise<void>
  /** Turn a recording (any browser audio format) into text. */
  transcribe(audio: Blob): Promise<string>
  dispose(): Promise<void>
}
