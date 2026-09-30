// Downloads Moonshine model files into the Cache Storage bucket the library itself uses, with real
// byte progress and a size check, so only complete files are ever stored and later launches need
// no network.

export const MOONSHINE_CACHE = 'moonshine-models-v1'

/** File name → exact size in bytes, relative to a base URL. */
export type AssetManifest = Record<string, number>

export function manifestBytes(files: AssetManifest, names = Object.keys(files)): number {
  return names.reduce((sum, name) => sum + files[name]!, 0)
}

/** Names of the files that are not on the device yet. */
export async function missingAssets(base: string, files: AssetManifest): Promise<string[]> {
  const cache = await caches.open(MOONSHINE_CACHE)
  const missing: string[] = []
  for (const name of Object.keys(files)) {
    if (!(await cache.match(base + name))) missing.push(name)
  }
  return missing
}

/** Download one file, reporting bytes as they arrive; throws if it isn't the expected size. */
export async function downloadAsset(base: string, files: AssetManifest, name: string, onBytes: (n: number) => void) {
  const res = await fetch(base + name)
  if (!res.ok || !res.body) throw new Error(`Download failed (${name}: ${res.status})`)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    onBytes(value.byteLength)
  }
  // Also catches a file that changed upstream: better to fall back than load something untested.
  if (size !== files[name]) throw new Error(`Download was incomplete or changed (${name}). Please try again.`)
  const cache = await caches.open(MOONSHINE_CACHE)
  await cache.put(base + name, new Response(new Blob(chunks as BlobPart[]), {
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' },
  }))
}

/** Read a cached file's bytes (call only after missingAssets() reported it present). */
export async function readAsset(base: string, name: string): Promise<Uint8Array> {
  const cache = await caches.open(MOONSHINE_CACHE)
  const hit = await cache.match(base + name)
  if (!hit) throw new Error(`Voice file is missing from the device (${name}).`)
  return new Uint8Array(await hit.arrayBuffer())
}
