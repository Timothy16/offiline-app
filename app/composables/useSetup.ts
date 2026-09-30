// First-run setup: ONE download for everything the app needs offline (speech recognition, natural
// voice, chat model), then loads them on every launch. Never downloads without the user's tap.
//
// The chat model and speech recognition are required. The natural voice is optional: if it fails
// to download or load, the app works with the phone's built-in voice. People who installed before
// the natural voice existed are offered it as a separate, non-blocking download.
import type { LoadProgress } from '~/lib/llm/types'
import { requestPersistentStorage, waitForServiceWorkerControl } from '~/lib/storage'

export type SetupPhase = 'idle' | 'checking' | 'needs-download' | 'downloading' | 'initializing' | 'ready' | 'error'
export type VoicePhase = 'idle' | 'downloading' | 'initializing' | 'ready' | 'too-slow' | 'error'

const phase = ref<SetupPhase>('idle')
const progress = ref({ loaded: 0, total: 0 })
const error = ref<string | null>(null)
const persisted = ref<boolean | null>(null)
/** Bytes the first-install download will fetch (required models + natural voice). */
const downloadBytes = ref(0)

/** Natural voice, for devices that already have the required models. */
const voicePhase = ref<VoicePhase>('idle')
const voiceProgress = ref({ loaded: 0, total: 0 })
/** Bytes the natural voice still needs (0 = on the device). */
const voiceBytes = ref(0)

let requiredBytes = 0

async function init() {
  if (phase.value !== 'idle') return
  phase.value = 'checking'
  try {
    const [llm, stt, voice] = await Promise.all([
      useLLM().inspect(),
      useSTT().inspect(),
      useSpeech().inspectNatural().catch(() => 0),
    ])
    requiredBytes = llm.downloadBytes + stt.downloadBytes
    voiceBytes.value = voice
    downloadBytes.value = requiredBytes ? requiredBytes + voice : 0
    // Required models already on the device: no data cost, so load straight away.
    if (!requiredBytes) await load()
    else phase.value = 'needs-download'
  }
  catch (err) {
    fail(err)
  }
}

async function load() {
  error.value = null
  persisted.value = await requestPersistentStorage()
  // Runtime files fetched below must go through the service worker to be cached for offline.
  if (downloadBytes.value) await waitForServiceWorkerControl()
  const llm = useLLM()
  const stt = useSTT()
  const firstInstall = requiredBytes > 0
  const sttBytes = stt.status.value?.downloadBytes ?? 0
  const voiceInSetup = firstInstall ? voiceBytes.value : 0
  const total = downloadBytes.value
  phase.value = total ? 'downloading' : 'initializing'

  // One progress bar across all downloads: `offset` is what earlier files already contributed.
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
    // Smallest first, so the bar moves right away.
    await stt.load(report(0))
    if (firstInstall) {
      // Part of the one setup download, but never a reason for setup to fail.
      await loadVoice(report(sttBytes))
    }
    await llm.load(report(sttBytes + voiceInSetup))
    phase.value = 'initializing'
    await useChat().warmUp()
    requiredBytes = 0
    downloadBytes.value = 0
    phase.value = 'ready'
  }
  catch (err) {
    fail(err)
    return
  }
  // Voice already on the device: start it in the background; the built-in voice covers until then.
  // Skipped on devices that recently proved too slow for it.
  if (!firstInstall && voiceBytes.value === 0) {
    if (useSpeech().knownTooSlow()) voicePhase.value = 'too-slow'
    else void loadVoice()
  }
}

/** Download (if needed) and start the natural voice. Never throws: failure keeps the built-in voice. */
async function loadVoice(onProgress?: (p: LoadProgress) => void) {
  if (['downloading', 'initializing', 'ready', 'too-slow'].includes(voicePhase.value)) return
  voicePhase.value = voiceBytes.value ? 'downloading' : 'initializing'
  try {
    const outcome = await useSpeech().loadNatural((p) => {
      if (p.phase === 'download') {
        voicePhase.value = 'downloading'
        voiceProgress.value = { loaded: p.loaded, total: p.total }
      }
      else {
        voicePhase.value = 'initializing'
      }
      onProgress?.(p)
    })
    voiceBytes.value = 0
    voicePhase.value = outcome
  }
  catch (err) {
    console.warn('[afronet] natural voice unavailable, using the built-in voice:', err)
    voicePhase.value = 'error'
    // Refresh how much is still missing (some files may have been stored).
    voiceBytes.value = await useSpeech().inspectNatural().catch(() => voiceBytes.value)
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
    voicePhase: readonly(voicePhase),
    voiceProgress: readonly(voiceProgress),
    voiceBytes: readonly(voiceBytes),
    init,
    load,
    /** For the "natural voice" offer shown to existing installs (user tap). */
    downloadVoice: () => loadVoice(),
  }
}
