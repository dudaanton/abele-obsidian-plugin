import { createApp, h, render, type App as VueApp, type Component } from 'vue'
import type { Component as ObsidianComponent } from 'obsidian'

/**
 * The two ways a kit screen goes into an element Obsidian, CodeMirror or a library hands us.
 *
 * - `mountKit`: a whole Vue app of its own — a view's content, a dialog's body, a block in a
 *   note. Unmounted by the handle, and by the owner's unload when one is given (a view, a
 *   `MarkdownRenderChild`, the plugin), whichever comes first.
 * - `renderKit`: one small component patched in synchronously with `render()` — a suggestion
 *   row, a marker. The element has its children and its size before the call returns, which is
 *   what code that measures it right after needs. Cheap, so it stays flat: props only, no store
 *   reads, and an explicit `unrenderKit` before the element is redrawn or dropped.
 */

export interface KitMount {
  readonly app: VueApp
  readonly el: HTMLElement
  /** Unmounts the app; safe to call twice. */
  unmount(this: void): void
}

export function mountKit(
  el: HTMLElement,
  component: Component,
  props: Record<string, unknown> | null = null,
  options: {
    /** Unmounts along with it. */
    owner?: ObsidianComponent
    /** Takes the element out of the page too, for a container made only to hold the app. */
    remove?: boolean
  } = {}
): KitMount {
  const app = createApp(component, props)
  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    app.unmount()
    if (options.remove) el.remove()
  }
  options.owner?.register(unmount)
  app.mount(el)
  return { app, el, unmount }
}

/** Patches one component into `el` synchronously; returns what takes it out again. */
export function renderKit(
  el: HTMLElement,
  component: Component,
  props: Record<string, unknown> | null = null,
  owner?: ObsidianComponent
): () => void {
  render(h(component, props), el)
  const dispose = () => unrenderKit(el)
  owner?.register(dispose)
  return dispose
}

/** Takes out what `renderKit` put into `el`, running its unmount hooks; nothing when empty. */
export function unrenderKit(el: HTMLElement): void {
  render(null, el)
}
