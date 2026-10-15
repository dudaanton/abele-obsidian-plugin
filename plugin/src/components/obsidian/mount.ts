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
 * - `renderKitRoot`: the same, for a caller that has to hand an element on instead of filling
 *   one; `unrenderKitRoot` where that element is dropped.
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

const roots = new WeakMap<Element, () => void>()

/**
 * For a caller that hands an element on rather than fills one — a CodeMirror widget's `toDOM`,
 * an icon put between words. The component is rendered into a holder kept off the page and its
 * own root comes back, so the page holds exactly what the component draws, with no wrapper box
 * for the editor to measure or the text to flow around. The root must be one element that
 * stays the same element: render it once, from props, and draw it anew rather than patching.
 */
export function renderKitRoot(
  component: Component,
  props: Record<string, unknown> | null = null
): { el: HTMLElement; dispose: () => void } {
  const holder = createDiv()
  render(h(component, props), holder)
  const el = holder.firstElementChild as HTMLElement
  let done = false
  const dispose = () => {
    if (done) return
    done = true
    roots.delete(el)
    // Vue takes its root out of whichever parent it was moved to.
    render(null, holder)
    el.remove()
  }
  roots.set(el, dispose)
  return { el, dispose }
}

/** Takes out what `renderKitRoot` handed back, given only the element; nothing for any other. */
export function unrenderKitRoot(el: Element): void {
  roots.get(el)?.()
}

/** Whether `el` is a root `renderKitRoot` handed back and nobody has taken out yet. */
export function kitRootRendered(el: Element): boolean {
  return roots.has(el)
}
