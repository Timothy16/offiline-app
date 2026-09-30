// Voice contracts. Like LLMEngine, UI never touches a concrete engine — composables pick one,
// so voices/languages/runtimes can be swapped.
import type { LoadProgress } from '../llm/types'

export interface TTSStatus {
  /** False when this device can't speak at all (no engine / no English voice). */
  available: boolean
  /** True when speech works with no network (voice is installed on the device). */
  offline: boolean
  /** Human-readable voice name, for debugging and settings. */
  voice: string
  /** For downloadable voices: bytes still to fetch before it can be used. 0 when on the device. */
  downloadBytes?: number
}

export interface TTSEngine {
  inspect(): Promise<TTSStatus>
  /** Downloadable voices only: fetch (first time) and initialise. Safe to call more than once. */
  load?(onProgress?: (p: LoadProgress) => void): Promise<void>
  /** Start preparing the next sentence while the current one plays, so there is no gap. */
  prepare?(text: string): void
  /** Speak one short piece of text (a sentence). Resolves when finished or stopped. */
  speak(text: string): Promise<void>
  /** Stop immediately and drop anything in progress. */
  stop(): void
  /**
   * True when this engine can't keep up on this device (speech would stutter); the caller should
   * switch to a lighter voice.
   */
  readonly tooSlow?: boolean
  /** Free the engine's memory and workers (e.g. once it turned out too slow). */
  dispose?(): void
}

export interface STTStatus {
  model: string
  /** True when every model file is stored on the device (works offline). */
  cached: boolean
  /** Bytes still to download before `load()` can finish offline. 0 when cached. */
  downloadBytes: number
}

export interface ListenOptions {
  /**
   * Called once the microphone is really capturing. Anything said before this is lost, so the
   * UI must only invite the user to speak ("Listening…") from here on.
   */
  onReady?: () => void
  /** Called with the words heard so far, while the user is still speaking. */
  onPartial?: (text: string) => void
}

/** One spoken turn: the engine owns the microphone and decides when the user has finished. */
export interface ListenSession {
  /**
   * Everything said in this turn ('' when nothing was heard). Rejects if the microphone can't
   * be opened (e.g. permission denied: a DOMException named NotAllowedError).
   */
  result: Promise<string>
  /** Finish now and keep what was heard (user tapped the mic again). */
  stop(): void
  /** Finish now and discard what was heard. */
  cancel(): void
}

export interface STTEngine {
  inspect(): Promise<STTStatus>
  /** Download (first run only) and initialise the model. Safe to call more than once. */
  load(onProgress?: (p: LoadProgress) => void): Promise<void>
  /** Open the microphone and transcribe one turn while it is spoken. */
  listen(opts?: ListenOptions): ListenSession
  dispose(): Promise<void>
}
