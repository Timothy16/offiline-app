<script setup lang="ts">
// Temporary: finds out why speech recognition is slow. Records one clip, then times whisper
// alone (1 and 2 threads) and again while the chat model is loaded (engine contention test).
import { WllamaEngine } from '~/lib/llm/wllama-engine'
import { MicRecorder } from '~/lib/voice/recorder'
import { WhisperSTT } from '~/lib/voice/whisper-stt'

interface Row { label: string, ms: number, text: string }

const clip = shallowRef<{ blob: Blob, seconds: number } | null>(null)
const rows = ref<Row[]>([])
const status = ref('')
const busy = ref(false)
const level = ref(0)

async function record() {
  busy.value = true
  status.value = 'Listening… say something like “What is the capital of Kenya?”'
  try {
    const r = await new MicRecorder().record({ onLevel: l => (level.value = l) })
    clip.value = { blob: r.blob, seconds: Math.round(r.durationMs / 100) / 10 }
    status.value = r.hadSpeech ? 'Recorded. Now run the test.' : 'No speech heard — try again.'
  }
  catch (err) {
    status.value = `Mic error: ${err instanceof Error ? err.message : err}`
  }
  finally {
    busy.value = false
  }
}

async function time(label: string, stt: WhisperSTT) {
  status.value = `Running: ${label}…`
  const t0 = performance.now()
  const text = await stt.transcribe(clip.value!.blob)
  rows.value.push({ label, ms: Math.round(performance.now() - t0), text })
}

async function run() {
  if (!clip.value) return
  busy.value = true
  rows.value = []
  let llm: WllamaEngine | null = null
  const stt2 = new WhisperSTT({ threads: 2 })
  const stt1 = new WhisperSTT({ threads: 1 })
  try {
    status.value = 'Loading speech model…'
    await stt2.load()
    await time('speech only · 2 threads (1st run)', stt2)
    await time('speech only · 2 threads (2nd run)', stt2)
    await stt2.dispose()

    await stt1.load()
    await time('speech only · 1 thread', stt1)

    status.value = 'Loading chat model (from device)…'
    llm = new WllamaEngine({ gpu: false })
    await llm.load()
    await time('WITH chat model loaded · 1 thread', stt1)
    await stt1.dispose()

    const stt2b = new WhisperSTT({ threads: 2 })
    await stt2b.load()
    await time('WITH chat model loaded · 2 threads', stt2b)
    await stt2b.dispose()
    status.value = 'Done — copy the table.'
  }
  catch (err) {
    status.value = `Error: ${err instanceof Error ? err.message : err}`
  }
  finally {
    await llm?.dispose()
    busy.value = false
  }
}
</script>

<template>
  <section class="card">
    <strong>Speech recognition speed test</strong>
    <p class="muted">Close every other Afronet tab/app window first, so nothing else uses the CPU.</p>
    <div class="row">
      <button :disabled="busy" @click="record()">1. Record a question</button>
      <button :disabled="busy || !clip" @click="run()">2. Run test</button>
    </div>
    <div v-if="busy && level" class="meter"><div :style="{ width: `${level * 100}%` }" /></div>
    <p class="muted">{{ status }}<template v-if="clip"> · clip {{ clip.seconds }} s</template></p>
    <table v-if="rows.length">
      <tbody>
        <tr v-for="r in rows" :key="r.label">
          <td>{{ r.label }}</td>
          <td><strong>{{ (r.ms / 1000).toFixed(1) }} s</strong></td>
          <td class="muted">“{{ r.text }}”</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  background: var(--surface);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}

button {
  padding: 10px 18px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 0.95rem;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
}

.meter {
  height: 6px;
  border-radius: 3px;
  background: var(--bg);
  overflow: hidden;
}

.meter div {
  height: 100%;
  background: var(--accent-soft);
}

table {
  border-collapse: collapse;
  font-size: 0.9rem;
}

td {
  padding: 3px 12px 3px 0;
  vertical-align: top;
}
</style>
