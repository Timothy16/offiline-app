// Voice contracts. Like LLMEngine, UI never touches a concrete engine — composables pick one,
// so voices/languages/runtimes can be swapped (built-in voice now, Piper next).

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
