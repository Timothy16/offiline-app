// App-wide model state. Components use this; only this file knows which LLMEngine is in use.
import { TransformersEngine } from '~/lib/llm/transformers-engine'
import type { ChatMessage, EngineStatus, GenerateOptions, LLMEngine, LoadProgress } from '~/lib/llm/types'
import { requestPersistentStorage } from '~/lib/storage'

export type LLMPhase = 'idle' | 'checking' | 'needs-download' | 'downloading' | 'initializing' | 'ready' | 'error'

const phase = ref<LLMPhase>('idle')
const status = ref<EngineStatus | null>(null)
const progress = ref<LoadProgress>({ phase: 'download', loaded: 0, total: 0 })
const error = ref<string | null>(null)
const persisted = ref<boolean | null>(null)

let engine: LLMEngine | null = null
const getEngine = () => (engine ??= new TransformersEngine())

async function init() {
  if (phase.value !== 'idle') return
  phase.value = 'checking'
  try {
    status.value = await getEngine().inspect()
    // Already on the device: no data cost, so load straight away.
    if (status.value.cached) await load()
    else phase.value = 'needs-download'
  }
  catch (err) {
    fail(err)
  }
}

async function load() {
  error.value = null
  phase.value = status.value?.cached ? 'initializing' : 'downloading'
  persisted.value = await requestPersistentStorage()
  try {
    await getEngine().load((p) => {
      progress.value = p
      phase.value = p.phase === 'download' ? 'downloading' : 'initializing'
    })
    if (status.value) status.value = { ...status.value, cached: true, downloadBytes: 0 }
    phase.value = 'ready'
  }
  catch (err) {
    fail(err)
  }
}

function fail(err: unknown) {
  error.value = err instanceof Error ? err.message : String(err)
  phase.value = 'error'
}

function generate(messages: ChatMessage[], opts?: GenerateOptions) {
  return getEngine().generate(messages, opts)
}

export function useLLM() {
  return {
    phase: readonly(phase),
    status: readonly(status),
    progress: readonly(progress),
    error: readonly(error),
    persisted: readonly(persisted),
    init,
    load,
    generate,
  }
}
