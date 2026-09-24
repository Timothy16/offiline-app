// Records one spoken turn from the microphone. Stops by itself when the user goes quiet after
// speaking (or never starts speaking), so a single tap is enough. Releases the mic afterwards.

export interface Recording {
  blob: Blob
  durationMs: number
  /** False when nothing louder than background noise was heard. */
  hadSpeech: boolean
}

export interface RecordOptions {
  /** Stop this long after the user stops talking. */
  silenceMs?: number
  /** Give up if no speech starts within this time. */
  noSpeechMs?: number
  /** Hard limit (Whisper handles up to 30 s; short turns are faster). */
  maxMs?: number
  /** 0..1 input level for a visual meter. */
  onLevel?: (level: number) => void
}

export class MicRecorder {
  private stopRequested: (() => void) | null = null

  /** Records until silence/limit or stop(); resolves with the audio. Throws if the mic is blocked. */
  async record({ silenceMs = 1300, noSpeechMs = 6000, maxMs = 15000, onLevel }: RecordOptions = {}): Promise<Recording> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const ctx = new AudioContext()
    await ctx.resume() // some browsers create it suspended
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)

    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data)
    const stopped = new Promise<void>(resolve => (recorder.onstop = () => resolve()))
    recorder.start()

    const start = performance.now()
    let noiseFloor = 0
    let calibrated = 0
    let hadSpeech = false
    let lastLoud = start

    await new Promise<void>((resolve) => {
      this.stopRequested = resolve
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const s of samples) sum += s * s
        const rms = Math.sqrt(sum / samples.length)
        onLevel?.(Math.min(1, rms * 8))

        const now = performance.now()
        // First ~300 ms: learn the background noise level of this room.
        if (now - start < 300) {
          noiseFloor = (noiseFloor * calibrated + rms) / ++calibrated
          return
        }
        const threshold = Math.max(0.012, noiseFloor * 2.5)
        if (rms > threshold) {
          hadSpeech = true
          lastLoud = now
        }
        const elapsed = now - start
        if (
          (hadSpeech && now - lastLoud > silenceMs)
          || (!hadSpeech && elapsed > noSpeechMs)
          || elapsed > maxMs
        ) {
          resolve()
        }
      }, 50)
      stopped.then(() => clearInterval(timer))
      this.stopRequested = () => {
        clearInterval(timer)
        resolve()
      }
    })

    this.stopRequested = null
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
    stream.getTracks().forEach(t => t.stop()) // turn the mic indicator off
    await ctx.close()
    onLevel?.(0)

    return {
      blob: new Blob(chunks, { type: recorder.mimeType }),
      durationMs: performance.now() - start,
      hadSpeech,
    }
  }

  /** Finish now (user tapped the mic again); the pending record() resolves with what was heard. */
  stop() {
    this.stopRequested?.()
  }
}
