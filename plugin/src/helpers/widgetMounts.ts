/**
 * The element a note widget's component is put into, kept by the widget's store entry.
 *
 * The widgets — task, task header, note header, footer, footnote, gallery in the editor — make
 * their mount element themselves, in `toDOM`, and used to leave it to Vue to find again by a
 * selector. Vue looks a selector up once, when the widget first appears, and at startup the
 * editor often builds its widgets before its leaf is in any document: nothing is found, the
 * Teleport is kept with no target and its component never made. The next change to any list
 * in the same component then patched that missing component and threw, every time, which took
 * the sidebars drawn by the same component down with it — silently, since those errors were
 * the kind the app's error handler files under Teleport clean-up.
 *
 * Handing Vue the element itself leaves nothing to find: it exists from the moment the widget
 * does, drawn into even while detached, and it is the same object wherever CodeMirror puts it,
 * popout windows included.
 *
 * Keyed by the raw entry, weakly, so an entry dropped from the store takes its element with it.
 */
import { toRaw } from 'vue'

const mounts = new WeakMap<object, HTMLElement>()

export function setWidgetMount(entry: object, el: HTMLElement): void {
  mounts.set(toRaw(entry), el)
}

export function widgetMount(entry: object): HTMLElement | undefined {
  return mounts.get(toRaw(entry))
}

/**
 * Takes out of `list` the entry drawn into `dom`, the element CodeMirror is destroying, and
 * cleans it up.
 *
 * Found by its element, never by the widget's id: CodeMirror hands a kept element over to an
 * equal new widget and compares widgets in both directions, so which widget instance is
 * destroyed says nothing reliable about which entry it made. The element does.
 */
export function dropWidgetEntry<T extends { cleanup(): void }>(list: T[], dom: HTMLElement): void {
  const at = list.findIndex((entry) => {
    const mount = widgetMount(entry)
    return !!mount && dom.contains(mount)
  })
  if (at === -1) return
  list[at].cleanup()
  list.splice(at, 1)
}
