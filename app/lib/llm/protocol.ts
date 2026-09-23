// Messages between TransformersEngine (main thread) and llm.worker.ts.
import type { ChatMessage, EngineStatus, LoadProgress } from './types'

export type WorkerRequest =
  | { type: 'inspect', id: number }
  | { type: 'load', id: number, threads?: number }
  | { type: 'generate', id: number, messages: ChatMessage[], maxNewTokens: number }
  | { type: 'interrupt' }

export type WorkerResponse =
  | { type: 'result', id: number, value?: EngineStatus }
  | { type: 'error', id: number, message: string }
  | { type: 'progress', progress: LoadProgress }
  | { type: 'chunk', id: number, text: string }
