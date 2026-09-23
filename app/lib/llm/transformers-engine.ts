// LLMEngine backed by transformers.js running in a Web Worker. Main-thread side is just RPC.
import type { WorkerRequest, WorkerResponse } from './protocol'
import type { ChatMessage, EngineStatus, GenerateOptions, LLMEngine, LoadProgress } from './types'

type Pending = { resolve: (value: any) => void, reject: (err: Error) => void }
type Stream = { push: (text: string) => void }

type Request = WorkerRequest extends infer R ? R extends { id: number } ? Omit<R, 'id'> : never : never

export class TransformersEngine implements LLMEngine {
  private worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private pending = new Map<number, Pending>()
  private streams = new Map<number, Stream>()
  private progressListener?: (p: LoadProgress) => void
  private loadPromise: Promise<void> | null = null

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      switch (msg.type) {
        case 'progress':
          this.progressListener?.(msg.progress)
          break
        case 'chunk':
          this.streams.get(msg.id)?.push(msg.text)
          break
        case 'result':
          this.pending.get(msg.id)?.resolve(msg.value)
          this.pending.delete(msg.id)
          break
        case 'error':
          this.pending.get(msg.id)?.reject(new Error(msg.message))
          this.pending.delete(msg.id)
          break
      }
    }
    // Worker failed to start or crashed (e.g. out of memory on a low-end phone): fail every waiter.
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'The AI engine stopped unexpectedly')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.loadPromise = null
    }
  }

  private call<T>(req: Request): { id: number, done: Promise<T> } {
    const id = this.nextId++
    const done = new Promise<T>((resolve, reject) => this.pending.set(id, { resolve, reject }))
    this.worker.postMessage({ ...req, id } as WorkerRequest)
    return { id, done }
  }

  inspect(): Promise<EngineStatus> {
    return this.call<EngineStatus>({ type: 'inspect' }).done
  }

  load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    if (onProgress) this.progressListener = onProgress
    this.loadPromise ??= this.call<void>({ type: 'load' }).done.catch((err) => {
      this.loadPromise = null
      throw err
    })
    return this.loadPromise
  }

  async* generate(messages: ChatMessage[], opts: GenerateOptions = {}): AsyncIterable<string> {
    const queue: string[] = []
    let wake: (() => void) | null = null
    let finished = false
    let failure: Error | null = null

    // Plain objects only: Vue reactive proxies can't be structured-cloned into the worker.
    const plain = messages.map(({ role, content }) => ({ role, content }))
    const { id, done } = this.call<void>({ type: 'generate', messages: plain, maxNewTokens: opts.maxNewTokens ?? 512 })
    this.streams.set(id, {
      push: (text) => {
        queue.push(text)
        wake?.()
      },
    })
    done.then(
      () => { finished = true },
      (err) => {
        finished = true
        failure = err
      },
    ).finally(() => wake?.())

    const interrupt = () => this.worker.postMessage({ type: 'interrupt' } satisfies WorkerRequest)
    opts.signal?.addEventListener('abort', interrupt)
    try {
      for (;;) {
        if (queue.length) {
          yield queue.shift()!
          continue
        }
        if (finished) {
          if (failure) throw failure
          return
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = null
      }
    }
    finally {
      opts.signal?.removeEventListener('abort', interrupt)
      this.streams.delete(id)
      if (!finished) interrupt() // consumer stopped iterating early
    }
  }
}
