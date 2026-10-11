import type { DataAdapter } from 'obsidian'

const REVISIONS = Symbol.for('abele.sync.adapter-config-revisions-v1')

/** Config writes have no vault-index event. Track adapter mutations without stat/list calls.
 * One wrapper per adapter, shared by all connections; no runtime or callbacks are retained.
 * Changes outside the adapter are still discovered by the existing config poll. */
export function adapterConfigRevision(adapter: DataAdapter, root: string): () => number {
  const shared = adapter as DataAdapter & { [REVISIONS]?: Map<string, number> }
  let roots = shared[REVISIONS]
  if (!roots) {
    roots = new Map()
    Object.defineProperty(adapter, REVISIONS, { value: roots })
    const held = roots
    for (const key of [
      'write',
      'writeBinary',
      'append',
      'appendBinary',
      'process',
      'mkdir',
      'rename',
      'copy',
      'remove',
      'rmdir',
    ] as const) {
      const original: unknown = Reflect.get(adapter, key)
      if (typeof original !== 'function') continue
      const change = (paths: unknown[]) => {
        for (const [root, revision] of held) {
          if (
            paths.some(
              (path) =>
                typeof path === 'string' &&
                (path === root || path.startsWith(root + '/') || root.startsWith(path + '/'))
            )
          )
            held.set(root, revision + 1)
        }
      }
      Object.defineProperty(adapter, key, {
        configurable: true,
        writable: true,
        value: function (this: DataAdapter, ...args: unknown[]) {
          const paths = args.slice(0, key === 'rename' || key === 'copy' ? 2 : 1)
          change(paths)
          try {
            return Promise.resolve(
              (original as (...args: unknown[]) => unknown).apply(this, args)
            ).finally(() => change(paths))
          } catch (error) {
            change(paths)
            throw error
          }
        },
      })
    }
  }
  if (!roots.has(root)) roots.set(root, 0)
  const held = roots
  return () => held.get(root) ?? 0
}
