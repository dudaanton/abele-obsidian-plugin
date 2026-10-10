import { sha256 } from './external/hash'
import { type FileSystem, type StateEntry, type StateStore } from '@abele/sync-core'
import { ConnectionRegistry, REGISTRY_KEY } from './connectionRegistry'
import type { LocalStorage } from './ledgerId'

export const EDIT_COPIES_KEY = 'local-edit-copies-v1'
export interface EditCopy {
  id: string
  path: string
  sha: string
  mtime: number
  bytes: number[]
  base: StateEntry | null
}
type Store = Pick<StateStore, 'get' | 'getMeta' | 'setMeta' | 'transaction'>
interface Destination {
  store: Store
  accepts(path: string, size: number): boolean | Promise<boolean>
  tail: Promise<void>
}
const LIMIT = 256 * 1024 * 1024

/** Durable per-destination preservation. No upload routing or authority inference. */
export class EditCopies {
  private expected: string[] = []
  private readonly destinations = new Map<string, Destination>()
  expect(ids: string[]): void {
    this.expected = [...new Set(ids)]
  }
  register(id: string, store: Store, accepts: Destination['accepts']): () => void {
    const destination = { store, accepts, tail: Promise.resolve() }
    this.destinations.set(id, destination)
    return () => {
      if (this.destinations.get(id) === destination) this.destinations.delete(id)
    }
  }
  async list(store: Store): Promise<EditCopy[]> {
    const raw = await store.getMeta?.(EDIT_COPIES_KEY)
    if (!raw) return []
    const values: unknown = JSON.parse(raw)
    if (
      !Array.isArray(values) ||
      values.some(
        (value) =>
          !value ||
          typeof value.id !== 'string' ||
          typeof value.path !== 'string' ||
          typeof value.sha !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.sha) ||
          !Number.isSafeInteger(value.mtime) ||
          value.mtime < 0 ||
          !Array.isArray(value.bytes) ||
          value.bytes.some(
            (byte: unknown) => !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255
          )
      )
    )
      throw new Error('Local edit capture requires recovery')
    let total = 0
    for (const value of values as EditCopy[]) {
      total += value.bytes.length
      if (total > LIMIT || (await sha256(Uint8Array.from(value.bytes))) !== value.sha)
        throw new Error('Local edit capture integrity requires recovery')
    }
    return values as EditCopy[]
  }
  /** Called with all affected path leases held, before any placement can erase the current bytes. */
  async capture(fs: FileSystem, paths: readonly string[]): Promise<void> {
    if (!this.expected.length) return
    const batches = new Map<
      Destination,
      { path: string; sha: string; mtime: number; bytes: Uint8Array }[]
    >()
    let retainedBytes = 0
    for (const path of new Set(paths)) {
      if (path === '.abele-sync' || path.startsWith('.abele-sync/')) continue
      const before = await fs.stat(path)
      if (!before) continue
      const destinations: Destination[] = []
      for (const id of this.expected) {
        const destination = this.destinations.get(id)
        if (!destination)
          throw new Error('Destination local edit capture is not ready; placement held')
        if (await destination.accepts(path, before.size)) destinations.push(destination)
      }
      if (!destinations.length) continue
      const bytes = await fs.read(path),
        sha = await sha256(bytes),
        after = await fs.stat(path)
      if (
        !after ||
        before.mtime !== after.mtime ||
        before.size !== after.size ||
        bytes.length !== after.size
      )
        throw new Error('Local edit changed during capture; placement held')
      for (const destination of destinations) {
        const { store } = destination
        if (!store.getMeta || !store.setMeta)
          throw new Error('Durable local edit capture unavailable')
        const base = await store.get(path)
        if (base?.sha === sha && base.mtime === before.mtime && base.size === bytes.length) continue
        let batch = batches.get(destination)
        if (!batch) batches.set(destination, (batch = []))
        batch.push({ path, sha, mtime: before.mtime, bytes })
      }
      if (destinations.some((destination) => batches.get(destination)?.at(-1)?.path === path)) {
        retainedBytes += bytes.length
        if (retainedBytes > LIMIT)
          throw new Error('Local edit capture budget reached; placement held')
      }
    }
    // One serialized durable write per destination, rather than re-encoding and
    // revalidating the entire accumulated archive for every installed plugin file.
    for (const [destination, batch] of batches) {
      const { store } = destination
      const preserving = destination.tail.then(() =>
        store.transaction(async () => {
          const copies = await this.list(store)
          let size = copies.reduce((total, copy) => total + copy.bytes.length, 0),
            changed = false
          for (const { path, sha, mtime, bytes } of batch) {
            const base = await store.get(path)
            if (base?.sha === sha && base.mtime === mtime && base.size === bytes.length) continue
            if (
              copies.some(
                (copy) =>
                  copy.path === path &&
                  copy.sha === sha &&
                  copy.mtime === mtime &&
                  copy.base?.versionId === base?.versionId
              )
            )
              continue
            size += bytes.length
            if (size > LIMIT) throw new Error('Local edit capture budget reached; placement held')
            copies.push({
              id: crypto.randomUUID(),
              path,
              sha,
              mtime,
              bytes: [...bytes],
              base,
            })
            changed = true
          }
          if (changed) await store.setMeta(EDIT_COPIES_KEY, JSON.stringify(copies))
        })
      )
      destination.tail = preserving.catch(() => {})
      await preserving
    }
  }
}
const SLOT = Symbol.for('abele.sync.edit-copies-v1')
export function editCopiesOf(host: object): EditCopies {
  const held = host as { [SLOT]?: EditCopies }
  return (held[SLOT] ??= new EditCopies())
}

/** Durable disconnected/revoked records no longer block the remaining destinations. */
export function refreshEditCopyDestinations(host: object, storage: LocalStorage): void {
  if (storage.loadLocalStorage(REGISTRY_KEY) == null) return
  const registry = ConnectionRegistry.open(storage)
  editCopiesOf(host).expect(
    registry
      .records()
      .filter(
        (record) =>
          record.address &&
          record.spaceId &&
          record.secretReference &&
          !record.pending &&
          record.status !== 'needs-token' &&
          record.status !== 'scope_unavailable'
      )
      .map((record) => record.id)
  )
}
