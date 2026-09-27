import dayjs from 'dayjs'
import updateLocale from 'dayjs/plugin/updateLocale'
import { setKeyboardDiagnostics } from '@/helpers/keyboardDiagnostics'
import { GlobalStore } from '@/stores/GlobalStore'

dayjs.extend(updateLocale)

/** The settings `applySettingsLook` puts in force. */
export interface SettingsLook {
  fullWidthSidebars: boolean
  halfWidthSidebarsOnTablet: boolean
  keyboardDiagnostics: boolean
  weekStartsOnMonday: boolean
}

/**
 * The settings that take effect outside the plugin's own views, which read the settings
 * themselves: the sidebar width classes on `<body>`, the keyboard diagnostics panel and the
 * first day of the week, which dayjs and the calendar hold on their own.
 *
 * At startup, and whenever the settings are reloaded from disk: the file syncs, and a toggle
 * that arrived from another device would otherwise look ignored here until the next restart.
 * Each is set to what the settings say, on or off, so running it twice changes nothing.
 */
export function applySettingsLook(look: SettingsLook): void {
  document.body.classList.toggle('abele-full-width-sidebars', look.fullWidthSidebars)
  document.body.classList.toggle('abele-half-width-sidebars', look.halfWidthSidebarsOnTablet)
  setKeyboardDiagnostics(look.keyboardDiagnostics)
  dayjs.updateLocale('en', { weekStart: look.weekStartsOnMonday ? 1 : 0 })
  GlobalStore.getInstance().weekStartsOnMonday.value = look.weekStartsOnMonday
}
