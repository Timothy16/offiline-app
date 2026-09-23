<script setup lang="ts">
// Step 3 placeholder: proves the installable, offline app shell. Chat UI replaces this in step 5.
const { $pwa } = useNuxtApp()

const online = ref(true)
function updateOnline() {
  online.value = navigator.onLine
}

onMounted(() => {
  updateOnline()
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})
</script>

<template>
  <main class="shell">
    <img src="/icons/logo.svg" alt="" width="72" height="72">
    <h1>Afronet</h1>

    <ul class="status">
      <li>Network: <strong>{{ online ? 'online' : 'offline' }}</strong></li>
      <li>Offline shell: <strong>{{ $pwa?.offlineReady ? 'ready' : 'not yet cached' }}</strong></li>
      <li>Installed: <strong>{{ $pwa?.isPWAInstalled ? 'yes' : 'no' }}</strong></li>
    </ul>

    <button v-if="$pwa?.showInstallPrompt && !$pwa?.isPWAInstalled" @click="$pwa.install()">
      Install app
    </button>
  </main>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 16px;
  text-align: center;
}

h1 {
  margin: 0;
}

.status {
  list-style: none;
  padding: 0;
  margin: 0;
  color: var(--muted);
  line-height: 1.8;
}

.status strong {
  color: var(--text);
}

button {
  margin-top: 8px;
  padding: 12px 24px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  font-size: 1rem;
  cursor: pointer;
}
</style>
