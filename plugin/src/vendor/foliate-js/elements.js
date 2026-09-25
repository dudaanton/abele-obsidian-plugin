// ABELE PATCH: the engine's custom elements are registered under names of this load of the
// plugin. A name can be defined once per window and never taken back, so fixed names made the
// plugin fail to load again after being turned off and on or updated — until the app restarted —
// and a guard that skipped the second definition would have left the old engine's classes in use.
const LOAD = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')

// ABELE PATCH: the engine's own elements are registered when a book first asks for one, not
// when the plugin loads. A registered class can never be taken back, and it holds the whole
// bundle it came from — so registering on load kept every earlier load of the plugin in memory
// (about 65 MB each, measured on a development build) after every reload, toggle or update,
// book or no book. Now only a load that opened a book leaves one behind.
const pending = new Map()

/**
 * The name `base` is registered under in this load, e.g. `foliate-view-kqzrtx` — registering it
 * first if it was left for later by `defineOnFirstUse`. Elements are created through this, so
 * the class is always defined before an element of it exists.
 */
export const tagName = base => {
    const name = `${base}-${LOAD}`
    const cls = pending.get(base)
    if (cls) {
        pending.delete(base)
        if (!customElements.get(name)) customElements.define(name, cls)
    }
    return name
}

/** Registers `cls` under this load's name for `base`, once per window. */
export const defineElement = (base, cls, registry = customElements) => {
    const name = `${base}-${LOAD}`
    if (!registry.get(name)) registry.define(name, cls)
    return name
}

/** Leaves `cls` to be registered in this window the first time `tagName(base)` is asked for. */
export const defineOnFirstUse = (base, cls) => {
    pending.set(base, cls)
}
