// Picks the model variant for this device. Runs inside the worker (navigator.gpu is available there).

export const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX'
export const MODEL_NAME = 'Qwen3-0.6B'

export interface Variant {
  device: 'webgpu' | 'wasm'
  dtype: 'q4f16' | 'q8'
  /** Self-hosted ONNX Runtime build (see modules/ort-wasm.ts). */
  ortBuild: string
  /** Approximate one-time download: model weights + tokenizer/config + runtime wasm. */
  downloadBytes: number
}

const MB = 1_000_000

// WebGPU needs the asyncify runtime build; CPU-only uses the smaller plain build.
export const WEBGPU_VARIANT: Variant = {
  device: 'webgpu',
  dtype: 'q4f16',
  ortBuild: 'ort-wasm-simd-threaded.asyncify',
  downloadBytes: (570 + 9 + 27) * MB,
}

export const WASM_VARIANT: Variant = {
  device: 'wasm',
  dtype: 'q8',
  ortBuild: 'ort-wasm-simd-threaded',
  downloadBytes: (618 + 9 + 14) * MB,
}

/** WebGPU with fp16 shaders runs q4f16; anything else falls back to q8 on WASM/CPU. */
export async function supportsWebGPUf16(): Promise<boolean> {
  const gpu = (navigator as any).gpu
  if (!gpu) return false
  try {
    const adapter = await gpu.requestAdapter()
    return !!adapter?.features.has('shader-f16')
  }
  catch {
    return false
  }
}
