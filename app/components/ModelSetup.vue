<script setup lang="ts">
// First-run card: explains the one-time download (chat + voice), shows progress, recovers from errors.
const { phase, progress, error, downloadBytes, load } = useSetup()

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`
const percent = computed(() =>
  progress.value.total ? Math.min(100, Math.floor((progress.value.loaded / progress.value.total) * 100)) : 0,
)
</script>

<template>
  <section class="setup" aria-live="polite">
    <template v-if="phase === 'idle' || phase === 'checking'">
      <div class="spinner" aria-hidden="true" />
      <p class="muted">Checking your device…</p>
    </template>

    <template v-else-if="phase === 'needs-download'">
      <h2>Set up your offline AI</h2>
      <p>
        Afronet downloads its AI and voice <strong>once</strong>. After that it works with
        <strong>no internet</strong> — you can talk to it, and nothing you say leaves your phone.
      </p>
      <ul class="facts">
        <li>Download size: <strong>{{ mb(downloadBytes) }}</strong></li>
        <li>Use Wi-Fi if you can — mobile data may cost money</li>
        <li>Keep the app open until it finishes</li>
      </ul>
      <button class="primary" @click="load()">
        Download ({{ mb(downloadBytes) }})
      </button>
    </template>

    <template v-else-if="phase === 'downloading'">
      <h2>Downloading AI and voice…</h2>
      <div class="bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
        <div :style="{ width: `${percent}%` }" />
      </div>
      <p class="muted">{{ mb(progress.loaded) }} of {{ mb(progress.total) }} · {{ percent }}%</p>
      <p class="muted small">Keep the app open and the screen on. If it stops, you can start it again.</p>
    </template>

    <template v-else-if="phase === 'initializing'">
      <div class="spinner" aria-hidden="true" />
      <p class="muted">Preparing the AI… this can take a few seconds.</p>
    </template>

    <template v-else-if="phase === 'error'">
      <h2>Something went wrong</h2>
      <p class="error">{{ error }}</p>
      <p class="muted small">
        {{ downloadBytes ? 'Check your connection and try again.' : 'Everything is on your device. Try again.' }}
      </p>
      <button class="primary" @click="load()">Try again</button>
    </template>
  </section>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 420px;
  margin: auto;
  padding: 24px 16px;
  text-align: center;
}

h2 {
  margin: 0;
  font-size: 1.2rem;
}

p {
  margin: 0;
  line-height: 1.5;
}

.facts {
  margin: 0;
  padding: 12px 16px;
  list-style: none;
  border-radius: 12px;
  background: var(--surface);
  color: var(--muted);
  line-height: 1.8;
  text-align: left;
}

.facts strong {
  color: var(--text);
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 0.85rem;
}

.error {
  color: var(--danger);
  word-break: break-word;
}

.primary {
  min-height: 48px;
  padding: 12px 28px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}

.bar {
  width: 100%;
  height: 10px;
  border-radius: 5px;
  background: var(--surface);
  overflow: hidden;
}

.bar div {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--surface);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
