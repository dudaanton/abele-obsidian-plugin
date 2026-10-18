/** A plugin host whose registered disposers run on unload, matching Obsidian's lifecycle. */
export function withPluginLifecycle<T extends object>(host: T) {
  const disposers: (() => unknown)[] = []
  return Object.assign(host, {
    register(dispose: () => unknown) {
      disposers.push(dispose)
    },
    unload() {
      for (const dispose of disposers.splice(0).reverse()) dispose()
    },
  })
}
