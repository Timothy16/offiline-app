// Registry of what can be said right now. The layout registers app-wide commands and the screens
// that can be reached by voice; each screen registers its own commands for as long as it is open.
// Screen commands are checked first.
import type { VoiceCommand, VoiceScreen } from '~/lib/voice/commands'

export type RegisteredCommand = VoiceCommand & {
  /** Short spoken hint for "help", e.g. "go to FAQ". */
  help?: string
}

/** A screen plus how to get there; matched by meaning ("I'm going to the FAQ page"). */
export type RegisteredScreen = VoiceScreen & {
  /** How the app names it when speaking ("the chat"), e.g. in "Did you mean the chat?". */
  label: string
  go: () => void | Promise<void>
}

const registered = shallowRef<RegisteredCommand[][]>([])
const screens = shallowRef<RegisteredScreen[]>([])

/** All commands, newest registration (current screen) first. */
function all(): RegisteredCommand[] {
  return registered.value.slice().reverse().flat()
}

/** Screens reachable by voice (registered once, by the layout). */
function allScreens(): RegisteredScreen[] {
  return screens.value
}

function registerScreens(list: RegisteredScreen[]) {
  screens.value = list
}

/** Register commands for the lifetime of the calling component. */
export function useVoiceCommands(commands?: RegisteredCommand[]) {
  if (commands) {
    registered.value = [...registered.value, commands]
    onScopeDispose(() => {
      registered.value = registered.value.filter(c => c !== commands)
    })
  }
  return { all, screens: allScreens, registerScreens }
}
