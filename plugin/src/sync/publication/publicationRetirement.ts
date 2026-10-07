import { sha256 } from '@abele/sync-core'
import type { App } from 'obsidian'
import { IndexedDbStateStore } from '../IndexedDbStateStore'
import { bindingKey, LinkSnapshotStore } from './LinkSnapshotStore'
import { PublicationDecisionStore } from './publicationDecision'
import type { SnapshotDescriptor } from './snapshotDatabase'

export const PUBLICATION_DESCRIPTOR = 'abele-owner-publication'
export const PUBLICATION_SENTINEL = '.abele-owner-publication'
const CATALOGUE = 'abele-owner-publication-stores-v1'
/** A full recovery budget holds allocation, never silently evicts unfinished evidence. */
export const PUBLICATION_STORE_LIMIT = 16
interface StoreRecord {
  key: string
  sentinel: string
  descriptor: SnapshotDescriptor
  retiring?: boolean
}
const hash = (value: unknown) => sha256(new TextEncoder().encode(JSON.stringify(value)))
function save(app: App, records: StoreRecord[]) {
  app.saveLocalStorage(CATALOGUE, records)
  if (JSON.stringify(app.loadLocalStorage(CATALOGUE)) !== JSON.stringify(records))
    throw new Error('Publication store catalogue was not persisted; recovery required')
}
async function checkResources(app: App, record: StoreRecord, allowMissing: boolean): Promise<void> {
  const current = app.loadLocalStorage(record.key)
  if (current != null && JSON.stringify(current) !== JSON.stringify(record.descriptor))
    throw new Error('Publication store descriptor changed; recovery required')
  if (!allowMissing && (current == null || !(await app.vault.adapter.exists(record.sentinel))))
    throw new Error('Publication store descriptor or sentinel lost; recovery required')
}

async function catalogue(app: App, forget = false): Promise<StoreRecord[]> {
  const stored = app.loadLocalStorage(CATALOGUE) as StoreRecord[] | null
  if (stored != null && !Array.isArray(stored))
    throw new Error('Publication store catalogue malformed; recovery required')
  const records = structuredClone(stored ?? [])
  // Upgrade existing per-binding stores using vault-local sentinels, never global database names.
  const files = (await app.vault.adapter.list('')).files
  for (const sentinel of files) {
    if (
      sentinel !== PUBLICATION_SENTINEL &&
      !/^\.abele-owner-publication-[a-f0-9]{64}$/.test(sentinel)
    )
      continue
    const key =
      PUBLICATION_DESCRIPTOR + sentinel.slice(PUBLICATION_SENTINEL.length).replace('-', ':')
    const descriptor = app.loadLocalStorage(key) as SnapshotDescriptor | null
    const retained = records.find((r) => r.key === key)
    // A catalogue copy is ownership proof for explicit Forget, not permission to recreate
    // a lost live descriptor. Only a durable retirement intent permits automatic deletion.
    if (!descriptor && !retained?.retiring && !(forget && retained))
      throw new Error('Link snapshot descriptor lost; recovery required')
    if (descriptor && !retained) records.push({ key, sentinel, descriptor })
  }
  for (const r of records) {
    const suffix = r.key.slice(PUBLICATION_DESCRIPTOR.length)
    if (
      !r.descriptor?.id ||
      !r.descriptor.binding ||
      (r.key !== PUBLICATION_DESCRIPTOR && !/^:[a-f0-9]{64}$/.test(suffix)) ||
      r.sentinel !== PUBLICATION_SENTINEL + suffix.replace(':', '-') ||
      (suffix && suffix.slice(1) !== (await hash(bindingKey(r.descriptor.binding))))
    )
      throw new Error('Publication store catalogue binding changed; recovery required')
    // Every known store is checked, including the current keep binding. A missing pair
    // cannot mean fresh allocation when the ownership catalogue still proves prior work.
    await checkResources(app, r, forget || r.retiring === true)
  }
  save(app, records)
  return records
}

/** Unknown, incomplete or corrupt rows are retained. Only proved terminal work is retired. */
async function settled(
  meta: IndexedDbStateStore,
  descriptor: SnapshotDescriptor
): Promise<boolean> {
  const binding = descriptor.binding,
    key = bindingKey(binding)
  if ((await meta.getJournal()) !== null || (await meta.getCursor()) !== 0) return false
  for await (const _entry of meta.all()) return false
  const rows = await meta.pluginMeta()
  if (
    !rows.has('owner-publication-audiences-v1') ||
    !rows.has('native-owner-v1:' + JSON.stringify(binding) + ':pastes')
  )
    return false
  const intentsKey = 'publication-intents-v1:' + key
  const intentEnvelope = JSON.parse(rows.get(intentsKey) ?? 'null')
  if (!intentEnvelope || intentEnvelope.checksum !== (await hash(intentEnvelope.ledger)))
    return false
  const ledger = intentEnvelope.ledger
  if (
    ![1, 2].includes(ledger.version) ||
    bindingKey(ledger.binding) !== key ||
    !Array.isArray(ledger.units)
  )
    return false
  const units = new Set<string>()
  const publishedDecisions = new Set<string>()
  for (const u of ledger.units) {
    if (
      (ledger.version === 2 ? u.s : u.settled) !== true ||
      !Array.isArray(u.holds) ||
      u.holds.length ||
      !Array.isArray(u.intents) ||
      u.intents.some((i: { state: string }) => i.state !== 'published')
    )
      return false
    units.add(ledger.version === 2 ? u.e.r : u.unit.requestId)
    for (const intent of u.intents)
      publishedDecisions.add(intent.proposal.exposureKey + ':' + intent.proposal.fingerprint)
  }
  const decisions = new PublicationDecisionStore(meta)
  const snapshots = new LinkSnapshotStore(meta, binding, () => false)
  const native = 'native-owner-v1:' + JSON.stringify(binding) + ':'
  const snapshot = 'link-snapshot-v1:' + key + ':'
  for (const [name, raw] of rows) {
    if (name === 'link-snapshot-identity-v1' || name === intentsKey) continue
    if (name === 'owner-publication-audiences-v1') {
      const envelope = JSON.parse(raw)
      if (
        envelope.checksum !== (await hash(envelope.value)) ||
        bindingKey(envelope.value.binding) !== key
      )
        return false
    } else if (name.startsWith(native)) {
      const record = JSON.parse(raw),
        part = name.slice(native.length)
      if (
        record.key !== part ||
        bindingKey(record.binding) !== key ||
        record.checksum !==
          (await hash({ binding: record.binding, key: record.key, value: record.value }))
      )
        return false
      if (part === 'pastes') {
        if (
          !Array.isArray(record.value) ||
          record.value.some((p: { done: boolean }) => p.done !== true)
        )
          return false
      } else if (part === 'existing-candidates') {
        if (!Array.isArray(record.value) || record.value.length) return false
      } else if (part === 'received-bases' || part === 'delayed-local-links') {
        if (!record.value || Object.keys(record.value).length) return false
      } else if (part.startsWith('unit:') || part.startsWith('receipt:')) {
        if (!units.has(part.slice(part.indexOf(':') + 1))) return false
      } else return false
    } else if (name.startsWith(snapshot + 'note:')) {
      await snapshots.get(name.slice((snapshot + 'note:').length))
    } else if (name === snapshot + 'renames') {
      await snapshots.renames()
    } else if (name.startsWith('publication-decision-v1:')) {
      const d = await decisions.get(name.slice('publication-decision-v1:'.length))
      if (
        !d ||
        (d.state !== 'declined' &&
          !(d.state === 'approved' && publishedDecisions.has(d.exposureKey + ':' + d.fingerprint)))
      )
        return false
    } else if (name.startsWith('existing-publication-decision-v1:')) {
      const d = await decisions.getExisting(name.slice('existing-publication-decision-v1:'.length))
      if (
        !d ||
        bindingKey(d.observation.binding) !== key ||
        (d.state !== 'declined' && !(d.state === 'approved' && d.completed === true))
      )
        return false
    } else if (name === 'existing-publication-v1:' + key + ':index') {
      const keys = JSON.parse(raw)
      if (
        !Array.isArray(keys) ||
        (await Promise.all(keys.map((k) => decisions.getExisting(k)))).some((d) => !d)
      )
        return false
    } else return false
  }
  return true
}

/** Called after engine teardown on Disconnect/Forget, and before allocating a new binding. */
export async function retirePublicationStores(
  app: App,
  factory: IDBFactory,
  keep: string | null = null,
  forget = false
): Promise<void> {
  const records = await catalogue(app, forget)
  for (const record of [...records]) {
    if (record.key === keep && !record.retiring) continue
    if (!record.retiring && !forget) {
      let meta: IndexedDbStateStore | null = null
      try {
        meta = await IndexedDbStateStore.open(
          factory,
          'abele-link-snapshots-' + record.descriptor.id
        )
        const expected = JSON.stringify({
          id: record.descriptor.id,
          binding: bindingKey(record.descriptor.binding),
        })
        if (
          (await meta.getMeta('link-snapshot-identity-v1')) !== expected ||
          !(await settled(meta, record.descriptor))
        )
          continue
      } catch {
        // Loss/corruption keeps evidence for the existing recovery path, never deletes it.
        continue
      } finally {
        meta?.close()
      }
    }
    await checkResources(app, record, true)
    record.retiring = true
    save(app, records) // Durable deletion intent permits retry after any of the following steps.
    await IndexedDbStateStore.delete(factory, 'abele-link-snapshots-' + record.descriptor.id)
    await checkResources(app, record, true)
    app.saveLocalStorage(record.key, null)
    if (app.loadLocalStorage(record.key) != null)
      throw new Error('Publication descriptor was not cleared')
    if (await app.vault.adapter.exists(record.sentinel))
      await app.vault.adapter.remove(record.sentinel)
    if (await app.vault.adapter.exists(record.sentinel))
      throw new Error('Publication sentinel was not removed')
    records.splice(records.indexOf(record), 1)
    save(app, records)
  }
  if (keep && !records.some((r) => r.key === keep) && records.length >= PUBLICATION_STORE_LIMIT)
    throw new Error('Publication recovery store budget reached; recovery or Forget required')
}

export async function rememberPublicationStore(
  app: App,
  key: string,
  sentinel: string,
  descriptor: SnapshotDescriptor
): Promise<void> {
  const records = await catalogue(app)
  const retained = records.find((r) => r.key === key)
  if (
    retained &&
    (retained.sentinel !== sentinel ||
      JSON.stringify(retained.descriptor) !== JSON.stringify(descriptor))
  )
    throw new Error('Publication store registration changed; recovery required')
  if (!retained) records.push({ key, sentinel, descriptor })
  save(app, records)
}
