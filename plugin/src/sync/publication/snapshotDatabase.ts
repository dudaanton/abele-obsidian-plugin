import { IndexedDbStateStore } from '../IndexedDbStateStore'
import {
  LinkSnapshotStore,
  bindingKey,
  type SnapshotAttestor,
  type SnapshotBinding,
} from './LinkSnapshotStore'
export interface SnapshotDescriptor {
  id: string
  binding: SnapshotBinding
}
/** Thin host port: vault-local descriptor plus a recovery sentinel outside IndexedDB. */
export interface SnapshotResources {
  loadDescriptor(): SnapshotDescriptor | null
  saveDescriptor(value: SnapshotDescriptor): void | Promise<void>
  hasSentinel(): Promise<boolean>
  writeSentinel(): Promise<void>
}
const HEADER = 'link-snapshot-identity-v1'
/** No production call site until the disabled publication fence's prerequisite gates pass. */
export async function openLinkSnapshots(
  factory: IDBFactory,
  resources: SnapshotResources,
  binding: SnapshotBinding,
  attest: SnapshotAttestor
): Promise<{ snapshots: LinkSnapshotStore; databaseName: string; close: () => void }> {
  const old = resources.loadDescriptor()
  const sentinel = await resources.hasSentinel()
  if (!old && sentinel) throw new Error('Link snapshot descriptor lost; recovery required')
  if (old && !sentinel) throw new Error('Link snapshot recovery sentinel lost; recovery required')
  if (old && (!old.id || !old.binding || bindingKey(old.binding) !== bindingKey(binding)))
    throw new Error('Link snapshot binding changed; recovery required')
  const fresh = !old
  const descriptor = old ?? {
    id: crypto.randomUUID(),
    binding: JSON.parse(JSON.stringify(binding)) as SnapshotBinding,
  }
  if (fresh) {
    // Crash between these writes blocks recovery rather than manufacturing a local-create base.
    await resources.writeSentinel()
    if (!(await resources.hasSentinel()))
      throw new Error('Link snapshot sentinel was not persisted; recovery required')
    await resources.saveDescriptor(descriptor)
    if (JSON.stringify(resources.loadDescriptor()) !== JSON.stringify(descriptor))
      throw new Error('Link snapshot descriptor was not persisted; recovery required')
  }
  const databaseName = 'abele-link-snapshots-' + descriptor.id
  const expected = JSON.stringify({ id: descriptor.id, binding: bindingKey(binding) })
  const meta = await IndexedDbStateStore.open(factory, databaseName, {
    identity: { key: HEADER, value: expected },
  })
  try {
    const stored = await meta.getMeta(HEADER)
    if (stored === null) {
      if (!fresh) throw new Error('Link snapshot database identity lost; recovery required')
      await meta.setMeta(HEADER, expected)
    } else if (stored !== expected)
      throw new Error('Link snapshot database identity changed; recovery required')
    if ((await meta.getMeta(HEADER)) !== expected)
      throw new Error('Link snapshot identity was not persisted; recovery required')
    return {
      snapshots: new LinkSnapshotStore(meta, binding, attest),
      databaseName,
      close: () => meta.close(),
    }
  } catch (error) {
    meta.close()
    throw error
  }
}
