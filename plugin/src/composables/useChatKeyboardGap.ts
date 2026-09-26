import { nextTick, onMounted, onUnmounted, type Ref } from 'vue'
import { Platform } from 'obsidian'

/** The variable the chat's stylesheet takes the gap from. */
export const BOTTOM_GAP_VAR = '--abele-bottom-gap'

/** Obsidian's own keyboard events on a phone, dispatched on the window. */
const KEYBOARD_EVENTS = ['keyboardWillShow', 'keyboardDidShow'] as const

/** The box an absolutely placed element is laid out in: its nearest positioned ancestor. */
function boxOf(el: HTMLElement): HTMLElement | null {
  const view = el.ownerDocument.defaultView
  if (!view) return null
  for (let p = el.parentElement; p; p = p.parentElement) {
    const position = view.getComputedStyle(p).position
    if (position && position !== 'static') return p
  }
  return null
}

/**
 * How much of the window lies under the box the chat fills — the drawer's own bar and the
 * home indicator — which the keyboard covers before it reaches the chat. Measured on the box
 * rather than on the chat, whose height is the thing this feeds.
 *
 * @returns Null while the box is not laid out: a panel loaded behind another tab or in a closed
 *   drawer reads as zero height at the top of the window, and that reading is not a gap.
 */
export function bottomGapOf(el: HTMLElement): number | null {
  const box = boxOf(el)
  const view = el.ownerDocument.defaultView
  if (!box || !view) return null
  const rect = box.getBoundingClientRect()
  if (rect.height <= 0) return null
  return Math.max(0, Math.round(view.innerHeight - rect.bottom))
}

/**
 * Keeps the chat's `--abele-bottom-gap` true on a phone, where the stylesheet shrinks the chat
 * by the part of Obsidian's `--keyboard-height` that reaches past that gap.
 *
 * It used to be measured once, when the chat was mounted. Obsidian loads a panel that is not
 * on screen too — behind another tab of the drawer, or in a drawer still closed — and a chat
 * mounted there measured the whole window as its gap: from then on the keyboard never reached
 * it, the composer stayed under the keyboard, and only a restart of the app measured it again
 * (2026-09-27, from the phone). So it is measured again whenever it is about to be used — the
 * composer taking focus, the keyboard coming up — and a reading from a box not laid out is
 * thrown away instead of kept.
 */
export function useChatKeyboardGap(container: Ref<HTMLElement | null>) {
  const measure = () => {
    const el = container.value
    if (!el || !Platform.isMobile) return
    const gap = bottomGapOf(el)
    if (gap !== null) el.style.setProperty(BOTTOM_GAP_VAR, `${gap}px`)
  }

  let win: Window | null = null
  onMounted(() => {
    if (!Platform.isMobile) return
    win = container.value?.ownerDocument.defaultView ?? null
    for (const name of KEYBOARD_EVENTS) win?.addEventListener(name, measure)
    win?.addEventListener('resize', measure)
    void nextTick(measure)
  })
  onUnmounted(() => {
    for (const name of KEYBOARD_EVENTS) win?.removeEventListener(name, measure)
    win?.removeEventListener('resize', measure)
    win = null
  })

  return { measure }
}
