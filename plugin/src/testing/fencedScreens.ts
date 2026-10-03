import { createApp, h, type App as VueApp } from 'vue'
import FencedScreenFixture from './FencedScreenFixture.vue'
export const FENCED_SCREENS = [
  'folder',
  'group',
  'initial-batch',
  'invitation',
  'creation',
  'books',
  'publication',
  'unshare',
  'script-approval',
  'plugin-code',
  'personal-join',
] as const
export type FencedScreen = (typeof FENCED_SCREENS)[number]
export const FENCED_STATES = [
  'pending',
  'scope-updating',
  'cache-unknown',
  'offline',
  'revoked',
  'unsupported-transport',
  'recovery',
] as const
export type FencedState = (typeof FENCED_STATES)[number]
let mounted: VueApp | null = null,
  host: HTMLElement | null = null
export function closeFencedScreen() {
  mounted?.unmount()
  mounted = null
  host?.remove()
  host = null
}
/** Development-only actual components with anonymous read-only data. No port/runtime/credential mutation. */
export function openFencedScreen(screen: FencedScreen, state: FencedState = 'pending') {
  if (!FENCED_SCREENS.includes(screen) || !FENCED_STATES.includes(state))
    throw new Error('Unknown fenced inspection screen/state')
  closeFencedScreen()
  host = createDiv()
  host.id = 'abele-fenced-inspection-host'
  document.body.appendChild(host)
  mounted = createApp({
    render: () => h(FencedScreenFixture, { screen, state, onClose: closeFencedScreen }),
  })
  mounted.mount(host)
  return { screen, state, readOnly: true }
}
