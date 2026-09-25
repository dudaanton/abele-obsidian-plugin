// ABELE PATCH: the engine's custom elements are registered under names of this load of the
// plugin. A name can be defined once per window and never taken back, so fixed names made the
// plugin fail to load again after being turned off and on or updated — until the app restarted —
// and a guard that skipped the second definition would have left the old engine's classes in use.
const LOAD = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')

/** The name `base` is registered under in this load, e.g. `foliate-view-kqzrtx`. */
export const tagName = base => `${base}-${LOAD}`

/** Registers `cls` under this load's name for `base`, once per window. */
export const defineElement = (base, cls, registry = customElements) => {
    const name = tagName(base)
    if (!registry.get(name)) registry.define(name, cls)
    return name
}
