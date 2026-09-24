// The speech-recognition model. Only this file knows which STTEngine is in use.
import type { LoadProgress } from '~/lib/llm/types'
import type { STTEngine, STTStatus } from '~/lib/voice/types'
import { WhisperSTT } from '~/lib/voice/whisper-stt'

const status = ref<STTStatus | null>(null)
const ready = ref(false)

let engine: STTEngine | null = null
const getEngine = () => (engine ??= new WhisperSTT())

async function inspect() {
  status.value = await getEngine().inspect()
  return status.value
}

async function load(onProgress?: (p: LoadProgress) => void) {
  await getEngine().load(onProgress)
  if (status.value) status.value = { ...status.value, cached: true, downloadBytes: 0 }
  ready.value = true
}

function transcribe(audio: Blob) {
  return getEngine().transcribe(audio)
}

export function useSTT() {
  return { status: readonly(status), ready: readonly(ready), inspect, load, transcribe }
}
