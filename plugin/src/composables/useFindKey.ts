import { onUnmounted, watch, type Ref } from 'vue'
import { Platform } from 'obsidian'

/**
 * Cmd+F (Ctrl+F elsewhere) inside a view Obsidian's own find does not reach, calling `onFind`.
 *
 * Taken on the window's capture phase, before Obsidian's own keys are looked at: inside the chat
 * that key would otherwise go to the note left open beside it, or to the composer's editor, which
 * has nothing to find in a message being written. "Inside" is the cursor being in the view, or —
 * for a click on text, which leaves the cursor nowhere — the last press having been in it.
 *
 * Watches the element's own window, so a chat in a popped-out window hears its own keys.
 */
export function useFindKey(root: Ref<HTMLElement | null>, onFind: () => void): void {
  let win: Window | null = null
  let pressedInside = false

  const isFindKey = (e: KeyboardEvent): boolean => {
    const mod = Platform.isMacOS ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
    if (!mod || e.shiftKey || e.altKey) return false
    // By the key's place on the keyboard too: under another layout the letter is not an `f`.
    return e.code === 'KeyF' || e.key.toLowerCase() === 'f'
  }

  const inside = (): boolean => {
    const el = root.value
    if (!el?.isConnected) return false
    const active = el.ownerDocument.activeElement
    if (active && active !== el.ownerDocument.body) return el.contains(active)
    return pressedInside
  }

  const onKey = (e: KeyboardEvent) => {
    if (!isFindKey(e) || !inside()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    onFind()
  }

  const onPress = (e: Event) => {
    const el = root.value
    pressedInside = !!el && !!e.target && el.contains(e.target as Node)
  }

  const detach = () => {
    win?.removeEventListener('keydown', onKey, true)
    win?.removeEventListener('pointerdown', onPress, true)
    win = null
  }

  watch(
    root,
    (el) => {
      const next = el?.ownerDocument.defaultView ?? null
      if (next === win) return
      detach()
      win = next
      win?.addEventListener('keydown', onKey, true)
      win?.addEventListener('pointerdown', onPress, true)
    },
    { immediate: true, flush: 'post' }
  )

  onUnmounted(detach)
}
