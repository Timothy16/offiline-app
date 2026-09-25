// The speech-recognition model. Only this file knows which STTEngine is in use.
import type { LoadProgress } from '~/lib/llm/types'
import { MoonshineSTT } from '~/lib/voice/moonshine-stt'
import type { ListenOptions, STTEngine, STTStatus } from '~/lib/voice/types'

const status = ref<STTStatus | null>(null)
const ready = ref(false)

let engine: STTEngine | null = null
const getEngine = () => (engine ??= new MoonshineSTT())

async function inspect() {
  status.value = await getEngine().inspect()
  return status.value
}

async function load(onProgress?: (p: LoadProgress) => void) {
  await getEngine().load(onProgress)
  if (status.value) status.value = { ...status.value, cached: true, downloadBytes: 0 }
  ready.value = true
}

function listen(opts?: ListenOptions) {
  return getEngine().listen(opts)
}

export function useSTT() {
  return { status: readonly(status), ready: readonly(ready), inspect, load, listen }
}
