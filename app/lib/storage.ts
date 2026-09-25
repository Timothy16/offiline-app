// Persistent storage helpers. The model lives in OPFS (managed by wllama); persist() asks the
// browser not to evict it under storage pressure.

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  }
  catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number, quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}

/**
 * Resolves true once a service worker controls this page. Downloads made before that bypass the
 * worker, so the AI runtimes (fetched during setup) would never be cached and offline launch
 * would fail. Returns false immediately when no worker is registered (dev), or after a timeout.
 */
export async function waitForServiceWorkerControl(timeoutMs = 10_000): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  if (navigator.serviceWorker.controller) return true
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined)
  if (!registration) return false
  return Promise.race([
    new Promise<boolean>(resolve =>
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true })),
    new Promise<boolean>(resolve => setTimeout(() => resolve(!!navigator.serviceWorker.controller), timeoutMs)),
  ])
}
