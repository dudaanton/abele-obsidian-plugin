import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { bindingKey } from '@/sync/publication/LinkSnapshotStore'
import { PublicationIntents } from '@/sync/publication/publicationIntents'
import { publicationFixture } from '../helpers/publicationFixture'
import { reducePublication, answerPublication } from '@/sync/publication/publicationDecision'
import { PluginSharing } from '@/sync/pluginSharing'
import { PublicationPrompt } from '@/sync/publicationPrompt'
import { emptyConnection } from '@/sync/connection'
import { writeLedgerId } from '@/sync/ledgerId'
import { bindDeviceToken } from '@/secrets/deviceSecret'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'
import {
  retirePublicationStores,
  PUBLICATION_STORE_LIMIT,
} from '@/sync/publication/publicationRetirement'
import {
  PublicationDecisionStore,
  existingPublicationQuestion,
  answerExistingPublication,
  existingExposureKey,
} from '@/sync/publication/publicationDecision'

function fixture() {
  const app = useVault([])
  setSecrets(null)
  AbeleConfig.getInstance().applySettings()
  const factory = new IDBFactory()
  const connection = ref({
    ...emptyConnection(),
    serverUrl: 'https://sync.example',
    vaultId: 'sample-vault',
    deviceId: 'sample-device',
    deviceTokenId: 'abele-sync-device-sample',
  })
  const host = new PluginSharing(
    app as never,
    {
      connection,
      publicationPrompt: new PublicationPrompt(() => true),
      scopedStatus: vi.fn(),
    } as never,
    { indexedDB: factory, fetch: vi.fn() as never }
  )
  hosts.push(host)
  const token = 'absd_' + 'a'.repeat(43)
  writeLedgerId(app, { stateId: 'sample-ledger', vaultId: connection.value.vaultId })
  bindDeviceToken(
    secrets().device,
    connection.value.deviceTokenId,
    token,
    connection.value.serverUrl
  )
  const open = () =>
    host.ownerPublication({
      app: app as never,
      connection: connection.value,
      token,
      client: { commitRaw: vi.fn() } as never,
      state: new MemoryStateStore(),
      fetch: vi.fn() as never,
      held: () => true,
    })
  return { app, factory, connection, host, open }
}

it('bounds publication databases and sentinels across twenty re-enrolments', async () => {
  const { factory, connection, open, app } = fixture()
  for (let n = 0; n < 20; n++) {
    connection.value = { ...connection.value, deviceId: 'sample-device-' + n }
    const runtime = await open()
    expect(
      (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
        .length
    ).toBeLessThanOrEqual(1)
    expect(
      (await app.vault.adapter.list('')).files.filter((p) =>
        p.startsWith('.abele-owner-publication')
      ).length
    ).toBeLessThanOrEqual(1)
    runtime.close()
  }
})

it('retires terminal stores on Disconnect but holds uncompleted recovery at a fixed budget', async () => {
  const { host, factory, app, connection, open } = fixture()
  const empty = await open()
  const oldKey =
    'abele-owner-publication:' +
    (await sha256(new TextEncoder().encode(JSON.stringify(bindingKey((host as any).live.binding)))))
  empty.close()
  await retirePublicationStores(app as never, factory)
  expect(app.loadLocalStorage(oldKey)).toBeNull()
  expect(
    (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
  ).toEqual([])
  for (let n = 0; n < PUBLICATION_STORE_LIMIT; n++) {
    connection.value = { ...connection.value, deviceId: 'sample-pending-device-' + n }
    const runtime = await open()
    await (host as any).live.resources.meta.setMeta(
      'sample-retained-work',
      'invented-pending-intent'
    )
    runtime.close()
  }
  connection.value = { ...connection.value, deviceId: 'sample-overflow-device' }
  await expect(open()).rejects.toThrow(/recovery.*budget|budget.*recovery/i)
  expect(
    (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-')).length
  ).toBe(PUBLICATION_STORE_LIMIT)
  await host.retirePublication(true)
  expect(
    (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
  ).toEqual([])
})

it.each(['matching', 'changed'] as const)(
  'retires completed publication only with a %s approved exposure fingerprint',
  async (fingerprint) => {
    const { host, factory, open } = fixture()
    const runtime = await open()
    const { binding, resources } = (host as any).live
    const input = await publicationFixture(false)
    input.binding = binding
    input.current.binding = binding
    if (input.baseline.kind === 'complete') input.baseline.binding = binding
    const proposal = await reducePublication(input)
    if (proposal.kind !== 'confirm') throw new Error('Expected reviewable exposure')
    const approved = await answerPublication(proposal, input, true)
    if (approved.kind !== 'confirmed-intent') throw new Error('Expected confirmed exposure')
    await new PublicationDecisionStore(resources.meta).remember(approved, 'approved')
    const authority = {
      grantId: 'sample-grant',
      active: true,
      revision: 1,
      admissionGeneration: 1,
      publicationGeneration: 0,
      withdrawalGeneration: 0,
      targetFileId: 'sample-asset',
      targetVersionId: 'asset-v1',
      sponsorFileId: 'sample-note',
      sponsorVersionId: 'note-v1',
    }
    const intents = new PublicationIntents(
      resources.meta,
      binding,
      {
        attest: async () => true,
        verifyReceipt: async () => true,
        inspect: async () => authority,
        lookup: async () => null,
        apply: async () => ({ status: 'applied' }),
      },
      () => true,
      () => true
    )
    const unit = {
      requestId: 'sample-published-request',
      ops: [
        {
          op: 'modify' as const,
          file_id: 'sample-note',
          base_version_id: 'base-note',
          sha: input.current.sha,
          size: 22,
          mtime: 1,
        },
      ],
      createHandles: {},
    }
    await intents.prepare(unit, [input])
    await intents.settle({
      requestId: unit.requestId,
      ops: unit.ops,
      outcomes: [
        {
          index: 0,
          status: 'applied',
          fileId: 'sample-note',
          versionId: 'note-v1',
          sha: input.current.sha,
          path: 'Shared/sample.md',
        },
      ],
    })
    await intents.retry(unit.requestId)
    expect(
      JSON.parse((await resources.meta.getMeta('publication-intents-v1:' + bindingKey(binding)))!)
        .ledger.units[0].intents[0].state
    ).toBe('published')
    if (fingerprint === 'changed')
      await new PublicationDecisionStore(resources.meta).remember(
        { ...approved, fingerprint: 'f'.repeat(64) },
        'approved'
      )
    runtime.close()
    await host.retirePublication()
    expect(
      (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
        .length
    ).toBe(fingerprint === 'matching' ? 0 : 1)
  }
)

it('retries a partially completed retirement without allocating another store', async () => {
  const { host, app, factory, open } = fixture()
  const runtime = await open()
  runtime.close()
  vi.spyOn(app.vault.adapter, 'remove').mockRejectedValueOnce(new Error('Invented removal failure'))
  await expect(host.retirePublication()).rejects.toThrow(/removal failure/)
  await host.retirePublication()
  expect(
    (await app.vault.adapter.list('')).files.filter((p) => p.startsWith('.abele-owner-publication'))
  ).toEqual([])
  expect(
    (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
  ).toEqual([])
})

it('does not apply stored consent from a previous principal to a new binding', async () => {
  const { host, connection, open } = fixture()
  const first = await open()
  const binding = (host as any).live.binding
  const observation = {
    binding,
    target: {
      fileId: 'sample-target',
      versionId: 'sample-target-version',
      path: 'sample-image.png',
      sha: 'a'.repeat(64),
      eligible: true,
    },
    sponsor: {
      fileId: 'sample-sponsor',
      versionId: 'sample-sponsor-version',
      path: 'sample-note.md',
      sha: 'b'.repeat(64),
      inScope: true,
      intrinsic: true,
      admissionGeneration: 1,
    },
    audience: {
      grantId: 'sample-audience',
      label: 'Sample audience',
      active: true,
      alreadyShared: false,
      revision: 1,
      withdrawalGeneration: 0,
    },
    linked: true,
  }
  const question = (await existingPublicationQuestion(observation))!
  const accepted = (await answerExistingPublication(question, observation, true))!
  const decisions = new PublicationDecisionStore((host as any).live.resources.meta)
  await decisions.rememberExisting(accepted)
  first.close()
  connection.value = { ...connection.value, deviceId: 'sample-reenrolled-device' }
  const second = await open()
  const next = { ...observation, binding: (host as any).live.binding }
  const current = new PublicationDecisionStore((host as any).live.resources.meta)
  expect(await current.existing(next.binding)).toEqual([])
  expect(
    await current.getExisting(
      await existingExposureKey(next.binding, next.target.fileId, next.audience.grantId)
    )
  ).toBeNull()
  expect(await existingPublicationQuestion(next, accepted)).not.toBeNull()
  second.close()
})

it.each(['legacy', 'current', 'retired'] as const)(
  'holds recovery when a %s sentinel outlives its descriptor',
  async (kind) => {
    const { app, host, factory, connection, open } = fixture()
    const runtime = await open()
    const resources = (host as any).live.resources
    const binding = (host as any).live.binding
    const identity = await sha256(new TextEncoder().encode(JSON.stringify(bindingKey(binding))))
    await resources.meta.setMeta('sample-retained-work', 'invented-pending-intent')
    runtime.close()
    app.saveLocalStorage('abele-owner-publication:' + identity, null)
    if (kind === 'legacy') {
      app.saveLocalStorage('abele-owner-publication-stores-v1', null)
      await app.vault.adapter.rename(
        '.abele-owner-publication-' + identity,
        '.abele-owner-publication'
      )
    }
    if (kind === 'retired')
      connection.value = { ...connection.value, deviceId: 'sample-new-device' }
    await expect(open()).rejects.toThrow(/descriptor.*lost|recovery/i)
    expect(
      (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
        .length
    ).toBe(1)
  }
)

it.each(['pending', 'declined'] as const)(
  'holds a known current store after both markers are lost with a %s decision',
  async (state) => {
    const { app, host, factory, open } = fixture()
    const runtime = await open()
    const { binding, resources } = (host as any).live
    const input = await publicationFixture(false)
    input.binding = binding
    input.current.binding = binding
    if (input.baseline.kind === 'complete') input.baseline.binding = binding
    const proposal = await reducePublication(input)
    if (proposal.kind !== 'confirm') throw new Error('Expected explicit exposure review')
    await new PublicationDecisionStore(resources.meta).remember(proposal, state)
    const identity = await sha256(new TextEncoder().encode(JSON.stringify(bindingKey(binding))))
    const before = JSON.parse(
      JSON.stringify(app.loadLocalStorage('abele-owner-publication-stores-v1'))
    )
    runtime.close()
    app.saveLocalStorage('abele-owner-publication:' + identity, null)
    await app.vault.adapter.remove('.abele-owner-publication-' + identity)
    await expect(open()).rejects.toThrow(/lost|recovery/i)
    expect(app.loadLocalStorage('abele-owner-publication-stores-v1')).toEqual(before)
    expect(
      (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
        .length
    ).toBe(1)
    await host.retirePublication(true)
    expect(
      (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
    ).toEqual([])
    const next = await open()
    expect(
      await new PublicationDecisionStore((host as any).live.resources.meta).get(
        proposal.exposureKey
      )
    ).toBeNull()
    next.close()
  }
)

it('Forget deletes publication stores including retained unknown recovery work', async () => {
  const { host, factory, app, open } = fixture()
  const runtime = await open()
  await (host as any).live.resources.meta.setMeta('sample-retained-work', 'invented-pending-intent')
  runtime.close()
  await host.retirePublication(true)
  expect(
    (await factory.databases()).filter((db) => db.name?.startsWith('abele-link-snapshots-'))
  ).toEqual([])
  expect(
    (await app.vault.adapter.list('')).files.filter((p) => p.startsWith('.abele-owner-publication'))
  ).toEqual([])
})

const hosts: PluginSharing[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  setSecrets(null)
})

it.each(['reenrolment', 'forget', 'another-vault'] as const)(
  'opens a separate publication identity on %s without blocking an unshared personal connection',
  async (change) => {
    const app = useVault([])
    setSecrets(null)
    AbeleConfig.getInstance().applySettings()
    const factory = new IDBFactory()
    const connection = ref({
      ...emptyConnection(),
      serverUrl: 'https://sync.example',
      vaultId: 'sample-vault',
      deviceId: 'sample-device',
      deviceTokenId: 'abele-sync-device-sample',
    })
    const sync = {
      connection,
      publicationPrompt: new PublicationPrompt(() => true),
      scopedStatus: vi.fn(),
    }
    const host = new PluginSharing(app as never, sync as never, {
      indexedDB: factory,
      fetch: vi.fn() as never,
    })
    hosts.push(host)
    const token = 'absd_' + 'a'.repeat(43)
    const open = async (ledgerId: string) => {
      writeLedgerId(app, { stateId: ledgerId, vaultId: connection.value.vaultId })
      bindDeviceToken(
        secrets().device,
        connection.value.deviceTokenId,
        token,
        connection.value.serverUrl
      )
      return host.ownerPublication({
        app: app as never,
        connection: connection.value,
        token,
        client: { commitRaw: vi.fn() } as never,
        state: new MemoryStateStore(),
        fetch: vi.fn() as never,
        held: () => true,
      })
    }
    const original = await open('sample-ledger')
    // Retained old-identity work must neither disappear nor become a new principal's work.
    const old = (host as any).live.resources.meta
    const oldName = (host as any).live.resources.databaseName
    await old.setMeta('sample-retained-work', 'invented-pending-intent')
    original.close()
    connection.value = {
      ...connection.value,
      deviceId: 'sample-new-device',
      vaultId: change === 'another-vault' ? 'sample-other-vault' : 'sample-vault',
    }
    const replacement = await open(change === 'reenrolment' ? 'sample-ledger' : 'sample-new-ledger')
    expect((host as any).live.resources.databaseName).not.toBe(oldName)
    expect(host.audiences.value).toEqual([])
    expect(await (host as any).live.resources.meta.getMeta('sample-retained-work')).toBeNull()
    replacement.close()
    connection.value = { ...connection.value, deviceId: 'sample-device', vaultId: 'sample-vault' }
    const restored = await open('sample-ledger')
    expect((host as any).live.resources.databaseName).toBe(oldName)
    expect(await (host as any).live.resources.meta.getMeta('sample-retained-work')).toBe(
      'invented-pending-intent'
    )
    restored.close()
  }
)
