// Persistent storage helpers. The model lives in the Cache API (managed by transformers.js);
// persist() asks the browser not to evict it under storage pressure.

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
