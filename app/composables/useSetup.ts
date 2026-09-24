// First-run setup: ONE download for everything the app needs offline (chat model + speech
// recognition), then loads both on every launch. Never downloads without the user's tap.
import type { LoadProgress } from '~/lib/llm/types'
import { requestPersistentStorage } from '~/lib/storage'

export type SetupPhase = 'idle' | 'checking' | 'needs-download' | 'downloading' | 'initializing' | 'ready' | 'error'

const phase = ref<SetupPhase>('idle')
const progress = ref({ loaded: 0, total: 0 })
const error = ref<string | null>(null)
const persisted = ref<boolean | null>(null)
/** Bytes left to download across all models (0 when everything is on the device). */
const downloadBytes = ref(0)

async function init() {
  if (phase.value !== 'idle') return
  phase.value = 'checking'
  try {
    const [llm, stt] = await Promise.all([useLLM().inspect(), useSTT().inspect()])
    downloadBytes.value = llm.downloadBytes + stt.downloadBytes
    // Everything already on the device: no data cost, so load straight away.
    if (!downloadBytes.value) await load()
    else phase.value = 'needs-download'
  }
  catch (err) {
    fail(err)
  }
}

async function load() {
  error.value = null
  persisted.value = await requestPersistentStorage()
  const llm = useLLM()
  const stt = useSTT()
  const sttBytes = stt.status.value?.downloadBytes ?? 0
  const total = downloadBytes.value
  phase.value = total ? 'downloading' : 'initializing'

  // One progress bar across both downloads: `offset` is what earlier files already contributed.
  const report = (offset: number) => (p: LoadProgress) => {
    if (p.phase === 'download') {
      phase.value = 'downloading'
      progress.value = { loaded: offset + p.loaded, total: Math.max(total, offset + p.total) }
    }
    else {
      phase.value = 'initializing'
    }
  }

  try {
    // Speech model first: it is small, so the bar moves right away.
    await stt.load(report(0))
    await llm.load(report(sttBytes))
    downloadBytes.value = 0
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

export function useSetup() {
  return {
    phase: readonly(phase),
    progress: readonly(progress),
    error: readonly(error),
    persisted: readonly(persisted),
    downloadBytes: readonly(downloadBytes),
    init,
    load,
  }
}
