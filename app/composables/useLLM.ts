// The chat model. Only this file knows which LLMEngine is in use; first-run download and
// loading are coordinated by useSetup together with the speech model.
import type { ChatMessage, EngineStatus, GenerateOptions, LLMEngine, LoadProgress } from '~/lib/llm/types'
import { WllamaEngine } from '~/lib/llm/wllama-engine'

const status = ref<EngineStatus | null>(null)
const ready = ref(false)

let engine: LLMEngine | null = null
// CPU by default: WebGPU gave only ~12% on a laptop iGPU and is unreliable on low-end Android.
const getEngine = () => (engine ??= new WllamaEngine({ gpu: false }))

async function inspect() {
  status.value = await getEngine().inspect()
  return status.value
}

async function load(onProgress?: (p: LoadProgress) => void) {
  await getEngine().load(onProgress)
  if (status.value) status.value = { ...status.value, cached: true, downloadBytes: 0 }
  ready.value = true
}

function generate(messages: ChatMessage[], opts?: GenerateOptions) {
  return getEngine().generate(messages, opts)
}

export function useLLM() {
  return { status: readonly(status), ready: readonly(ready), inspect, load, generate }
}
