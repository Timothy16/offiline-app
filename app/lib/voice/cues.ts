// Short sound cues so the user knows what the assistant is doing without looking at the screen.
// Synthesized with Web Audio (nothing to download). Kept short and quiet: they play right before
// or after the microphone is open, and echo cancellation removes them from the recording.

export type Cue = 'listening' | 'heard' | 'not-understood' | 'done'

// [frequency Hz, duration ms] per note.
const NOTES: Record<Cue, Array<[number, number]>> = {
  'listening': [[660, 70], [880, 90]], // rising: "go ahead"
  'heard': [[988, 60]], // single blip: "got it"
  'not-understood': [[392, 110], [330, 150]], // low, falling: "didn't get that"
  'done': [[880, 70], [660, 110]], // falling: conversation closed
}

const VOLUME = 0.12

let ctx: AudioContext | null = null

export async function playCue(cue: Cue): Promise<void> {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    let t = ctx.currentTime + 0.01
    for (const [freq, ms] of NOTES[cue]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const end = t + ms / 1000
      // Short attack/release so the tone doesn't click.
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(VOLUME, t + 0.01)
      gain.gain.setValueAtTime(VOLUME, end - 0.02)
      gain.gain.linearRampToValueAtTime(0, end)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(end)
      t = end + 0.02
    }
    await new Promise(resolve => setTimeout(resolve, (t - ctx!.currentTime) * 1000))
  }
  catch {
    // Audio can be unavailable (no output device, autoplay policy): cues are optional.
  }
}
