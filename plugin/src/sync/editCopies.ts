import { PHONE_FALLBACK_BYTES } from './mobileWholeRead'
import { sha256 } from './external/hash'
import {
  type FileSystem,
  type StateEntry,
  type StateStore,
  fingerprintFile,
  receiveToStage,
  TransferBudget,
} from '@abele/sync-sdk/core'
import { ConnectionRegistry, REGISTRY_KEY } from './connectionRegistry'
import type { LocalStorage } from './ledgerId'
import { PRIVATE_PLACEMENT_STAGES } from './privatePlacementStages'

export const EDIT_COPIES_KEY = 'local-edit-copies-v1'
export interface EditCopy {
  id: string
  path: string
  sha: string
  mtime: number
  bytes: number[]
  source?: { id: string; size: number }
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
  private filesystem: FileSystem | null = null
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
      total += value.source?.size ?? value.bytes.length
      if (
        value.source &&
        (typeof value.source.id !== 'string' ||
          !Number.isSafeInteger(value.source.size) ||
          value.source.size < 0 ||
          value.bytes.length !== 0)
      )
        throw new Error('Local edit capture requires recovery')
      if (
        total > LIMIT ||
        (!value.source && (await sha256(Uint8Array.from(value.bytes))) !== value.sha)
      )
        throw new Error('Local edit capture integrity requires recovery')
      if (value.source) {
        if (!this.filesystem) throw new Error('Local edit capture source requires recovery')
        const identity = await fingerprintFile(this.filesystem, value.source.id, sha256)
        if (identity.size !== value.source.size || identity.sha !== value.sha)
          throw new Error('Local edit capture integrity requires recovery')
      }
    }
    return values as EditCopy[]
  }
  /** Called with all affected path leases held, before any placement can erase the current bytes. */
  async capture(
    fs: FileSystem,
    paths: readonly string[],
    acknowledgedFingerprint?: (path: string) => Promise<{ size: number; sha: string }>
  ): Promise<void> {
    this.filesystem = fs
    if (!this.expected.length) return
    const batches = new Map<
      Destination,
      {
        path: string
        sha: string
        mtime: number
        bytes: Uint8Array
        source?: { id: string; size: number }
      }[]
    >()
    let retainedBytes = 0
    const histories = new Map<Destination, Promise<EditCopy[]>>()
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
      const identity =
        before.size > PHONE_FALLBACK_BYTES && acknowledgedFingerprint
          ? await acknowledgedFingerprint(path)
          : await fingerprintFile(fs, path, sha256)
      const sha = identity.sha
      const needed: Destination[] = []
      for (const destination of destinations) {
        const base = await destination.store.get(path)
        if (base?.sha === sha && base.mtime === before.mtime && base.size === before.size) continue
        // Already kept, e.g. by an offload that preserved it before reserving the path:
        // staging it again would be refused under that reservation.
        if (!histories.has(destination))
          histories.set(
            destination,
            destination.store.getMeta ? this.list(destination.store) : Promise.resolve([])
          )
        const kept = await histories.get(destination)
        if (
          kept.some(
            (copy) =>
              copy.path === path &&
              copy.sha === sha &&
              copy.mtime === before.mtime &&
              copy.base?.versionId === base?.versionId
          )
        )
          continue
        needed.push(destination)
      }
      if (!needed.length) continue
      let source: { id: string; size: number } | undefined
      let bytes: Uint8Array
      if (fs.openRead && fs.beginAtomicWrite) {
        const incoming = await fs.openRead(path)
        let stage
        try {
          const privateStages = Reflect.get(fs, PRIVATE_PLACEMENT_STAGES) as
            | ReturnType<typeof import('./privatePlacementStages').privatePlacementStages>
            | undefined
          // A retained history source is never an unfinished install into the live note.
          // Its owned private target survives an explicit change of local placement.
          stage = privateStages
            ? await privateStages.beginAtomicWrite(
                `.abele-sync/placement-outbox/${sha}/${sha}`,
                before.mtime,
                null
              )
            : await fs.beginAtomicWrite(path, before.mtime, identity)
        } catch (error) {
          await incoming.close()
          throw error
        }
        await receiveToStage(
          incoming,
          stage,
          identity,
          new TransferBudget({ maxActiveTransfers: 1 })
        )
        source = { id: stage.id, size: identity.size }
        bytes = new Uint8Array()
      } else bytes = await fs.read(path)
      const after = await fs.stat(path)
      if (
        !after ||
        before.mtime !== after.mtime ||
        before.size !== after.size ||
        (source?.size ?? bytes.length) !== after.size
      )
        throw new Error('Local edit changed during capture; placement held')
      for (const destination of needed) {
        const { store } = destination
        if (!store.getMeta || !store.setMeta)
          throw new Error('Durable local edit capture unavailable')
        const base = await store.get(path)
        if (base?.sha === sha && base.mtime === before.mtime && base.size === before.size) continue
        let batch = batches.get(destination)
        if (!batch) batches.set(destination, (batch = []))
        batch.push({ path, sha, mtime: before.mtime, bytes, ...(source ? { source } : {}) })
      }
      if (destinations.some((destination) => batches.get(destination)?.at(-1)?.path === path)) {
        retainedBytes += source?.size ?? bytes.length
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
          let size = copies.reduce(
              (total, copy) => total + (copy.source?.size ?? copy.bytes.length),
              0
            ),
            changed = false
          for (const { path, sha, mtime, bytes, source } of batch) {
            const base = await store.get(path)
            if (
              base?.sha === sha &&
              base.mtime === mtime &&
              base.size === (source?.size ?? bytes.length)
            )
              continue
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
            size += source?.size ?? bytes.length
            if (size > LIMIT) throw new Error('Local edit capture budget reached; placement held')
            copies.push({
              id: crypto.randomUUID(),
              path,
              sha,
              mtime,
              bytes: [...bytes],
              ...(source ? { source } : {}),
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
