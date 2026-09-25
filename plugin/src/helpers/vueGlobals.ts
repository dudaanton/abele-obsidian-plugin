/**
 * Vue keeps a list of setters on the global object, `window` here, so that several copies of
 * it on one page agree on the component being set up (`@vue/runtime-core`,
 * `registerGlobalSetter`). Every copy pushes its own, and nothing ever takes one out.
 *
 * Every time Obsidian switches the plugin off and on — a reload, an update, a toggle in the
 * settings — it evaluates `main.js` afresh, so a new copy of Vue pushes a new setter. The old
 * one closes over the old bundle's scope and holds all of it: measured on a development build,
 * about 65 MB stayed behind per reload, and the window's renderer crashed after some thirty.
 * Every old setter is also called again on every component Vue sets up afterwards.
 *
 * A development build of Vue does the same with the formatter it adds to
 * `window.devtoolsFormatters`, so those builds leaked through that too.
 *
 * `claimVueSetters` is called once the bundle's modules have run, when the last setter in each
 * list — and, in a development build, the last formatter — is this bundle's own; the function it
 * returns takes those out again on unload.
 */
export const VUE_SETTER_KEYS = ['__VUE_INSTANCE_SETTERS__', '__VUE_SSR_SETTERS__'] as const

export function claimVueSetters(devBuild = process.env.NODE_ENV !== 'production'): () => void {
  const g = window as unknown as Record<string, unknown[] | undefined>
  const keys: string[] = [...VUE_SETTER_KEYS]
  // Only a development build of Vue adds one; in a production build the last formatter, if
  // there is any, belongs to someone else.
  if (devBuild) keys.push('devtoolsFormatters')
  const own = keys.map((key) => {
    const list = g[key]
    return { list, setter: list?.[list.length - 1] }
  })
  return () => {
    for (const { list, setter } of own) {
      if (!list || !setter) continue
      const at = list.indexOf(setter)
      // The list stays: Vue's next copy finds it and pushes into it.
      if (at !== -1) list.splice(at, 1)
    }
  }
}
