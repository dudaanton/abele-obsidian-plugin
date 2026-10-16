import { EngineError, type FileSystem } from '@abele/sync-core'

export const PRIVATE_PLACEMENT_STAGES = Symbol.for('abele.sync.private-placement-stages-v1')

/** Trusted core integration only: these destinations are never server paths or inventory. */
export function privatePlacementStages(fs: FileSystem, privateRoot?: string) {
  const owned = new Set<string>()
  const destination = (path: string) => {
    if (
      !/^\.abele-sync\/placement-(?:inbox\/[a-f0-9-]+|outbox\/[a-f0-9]{64}\/[a-f0-9]{64})$/.test(
        path
      )
    )
      throw new EngineError('protocol', 'Invalid private placement stage')
  }
  const physical = (path: string) =>
    privateRoot ? privateRoot + path.slice('.abele-sync'.length) : path
  const retained = (path: string) => {
    if (!owned.has(path)) throw new EngineError('protocol', 'Unknown private placement stage')
  }
  return {
    async writeAtomic(path: string, bytes: Uint8Array, mtime: number) {
      destination(path)
      await fs.writeAtomic(physical(path), bytes, mtime)
      owned.add(path)
    },
    read(path: string) {
      retained(path)
      return fs.read(physical(path))
    },
    async remove(path: string) {
      retained(path)
      await fs.remove(physical(path))
      owned.delete(path)
    },
    async beginAtomicWrite(path: string, mtime: number, base: null) {
      destination(path)
      const stage = await fs.beginAtomicWrite(physical(path), mtime, base)
      owned.add(stage.id)
      return new Proxy(stage, {
        get(target, key) {
          if (key === 'commit')
            return () => {
              throw new EngineError('protocol', 'Private source stages cannot be installed')
            }
          if (key === 'discard')
            return async () => {
              await target.discard()
              owned.delete(target.id)
            }
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
    openRead(path: string) {
      retained(path)
      return fs.openRead(path)
    },
  }
}
