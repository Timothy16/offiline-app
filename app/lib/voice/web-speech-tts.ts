// TTSEngine using the phone's built-in voices (Web Speech API). 0 MB to download; offline when
// the chosen voice is installed on the device (`localService`). Always kept as the fallback voice.
import type { TTSEngine, TTSStatus } from './types'

// African English locales first (installed on some Android phones), then common English voices.
const PREFERRED_LANGS = ['en-NG', 'en-KE', 'en-GH', 'en-ZA', 'en-GB', 'en-US']

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = speechSynthesis.getVoices()
  if (voices.length) return Promise.resolve(voices)
  // Chrome fills the list asynchronously; some devices never fire the event, hence the timeout.
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1500)
  })
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith('en'))
  const rank = (v: SpeechSynthesisVoice) => {
    const lang = PREFERRED_LANGS.findIndex(l => v.lang.replace('_', '-').toLowerCase() === l.toLowerCase())
    // Offline voices always beat online ones: the app must speak with no internet.
    return (v.localService ? 0 : 100) + (lang === -1 ? PREFERRED_LANGS.length : lang)
  }
  return english.sort((a, b) => rank(a) - rank(b))[0] ?? null
}

export class WebSpeechTTS implements TTSEngine {
  private voice: SpeechSynthesisVoice | null = null
  private ready: Promise<void> | null = null

  private init() {
    this.ready ??= loadVoices().then((voices) => {
      this.voice = pickVoice(voices)
    })
    return this.ready
  }

  async inspect(): Promise<TTSStatus> {
    if (typeof speechSynthesis === 'undefined') return { available: false, offline: false, voice: 'none' }
    await this.init()
    return {
      available: !!this.voice,
      offline: !!this.voice?.localService,
      voice: this.voice ? `${this.voice.name} (${this.voice.lang})` : 'none',
    }
  }

  async speak(text: string): Promise<void> {
    await this.init()
    if (!this.voice || !text.trim()) return
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      u.voice = this.voice
      u.lang = this.voice!.lang
      u.rate = 1
      u.onend = () => resolve()
      u.onerror = () => resolve() // "interrupted"/"canceled" on stop(): not an error for us
      speechSynthesis.speak(u)
    })
  }

  stop() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  }
}
