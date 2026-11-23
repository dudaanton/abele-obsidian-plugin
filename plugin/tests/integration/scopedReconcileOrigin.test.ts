import { expect, it, vi } from 'vitest'
import { downloadToStage, sha256, TransferBudget } from '@abele/sync-sdk/core'
import { connectionAdapter, connectionInspectionApp } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { RECONCILE_ORIGIN, reconcileVaultFile } from '@/sync/vaultMutationEvents'
import { SerialQueue } from '@/sync/queue'
import { buildFakeVault } from '../helpers/fakeVault'

const bytes = new Uint8Array([1, 2, 3])
const root = 'Shared'
const privateRoot = connectionPrivateRoot('sample-reconcile')
const includes = (path: string) => path === root || path.startsWith(root + '/')
const assertPath = (path: string) => {
  if (!includes(path)) throw new Error('outside scope')
}
function fixture() {
  const app = buildFakeVault([{ path: 'Shared/seed.md', content: 'sample' }])
  app.workspace.iterateAllLeaves = () => {}
  const reconcile = vi.fn(function (
    this: { handler(kind: string, path: string): void },
    path: string
  ) {
    this.handler('file-created', path)
    return Promise.resolve()
  })
  Object.assign(app.vault.adapter, {
    handler: (_kind: string, path: string) => app.emit('vault', 'create', { path }),
    reconcileInternalFile: reconcile,
  })
  const adapter = connectionAdapter(app.vault.adapter, root, privateRoot)
  const scopedApp = connectionInspectionApp(app as never, adapter, root, privateRoot)
  const host = new ObsidianFileSystem(scopedApp, {
    adapter,
    fileScope: root,
    connectionId: 'sample-reconcile',
  })
  return { app, adapter, scopedApp, host, reconcile }
}

it('publishes through folder scope and placement and reconciles external installs', async () => {
  const f = fixture()
  const fs = new LocalFolderPlacement('Remote', root).fileSystem(
    scopedFileSystem(f.host, assertPath, includes, privateRoot, root)
  )
  const identity = { size: bytes.length, sha: await sha256(bytes) }
  const source = () => ({
    size: bytes.length,
    read: async (offset: number, length: number) => bytes.slice(offset, offset + length),
    assertUnchanged: async () => {},
    close: async () => {},
  })
  await downloadToStage(
    source(),
    await fs.beginAtomicWrite!('Remote/published.bin', 1000, null),
    identity,
    new TransferBudget()
  )
  expect(new Uint8Array(await f.app.vault.adapter.readBinary('Shared/published.bin'))).toEqual(
    bytes
  )
  expect(f.reconcile.mock.calls.some(([path]) => path === 'Shared/published.bin')).toBe(true)
  const external = new ExternalFileHost(f.scopedApp, { platform: 'mobile', assertOwned: () => {} })
  try {
    const artifact = {
      operationId: 'sample-install',
      path: privateRoot + '/external/.abele-external-sample.incoming',
      role: 'incoming' as const,
      ...identity,
    }
    await external.run(
      new SerialQueue(),
      {
        operationId: artifact.operationId,
        fileId: 'sample-file',
        paths: [artifact.path, 'Shared/external.bin'],
        assertIntent: () => {},
      },
      async (effects) => {
        expect(await effects.stageSource(artifact, source())).toEqual({ status: 'staged' })
        expect(await effects.install(artifact, 'Shared/external.bin')).toMatchObject({
          status: 'installed',
        })
      }
    )
    expect(f.reconcile.mock.calls.some(([path]) => path === 'Shared/external.bin')).toBe(true)
    expect(await external.fingerprint('Shared/external.bin')).toMatchObject(identity)
  } finally {
    external.close()
  }
})

it('checks and maps the reconciliation port without granting sibling or ancestor access', async () => {
  const f = fixture()
  const port = Reflect.get(f.adapter, RECONCILE_ORIGIN)
  const notify = vi.fn((_kind: string, _path: string, deliver: () => unknown) => deliver())
  await port('Shared/seed.md', notify)
  await port(privateRoot + '/sample.bin', notify)
  for (const path of [
    'Private/sample.bin',
    'Other/sample.bin',
    'Shared/../Private/sample.bin',
    '.abele-sync',
    connectionPrivateRoot('other') + '/sample.bin',
    '',
  ]) {
    const before = f.reconcile.mock.calls.length
    await expect(async () => port(path, notify)).rejects.toThrow()
    expect(f.reconcile).toHaveBeenCalledTimes(before)
  }
  const disk = Object.assign(f.host, { [RECONCILE_ORIGIN]: port })
  const fs = new LocalFolderPlacement('Remote', root).fileSystem(
    scopedFileSystem(disk, assertPath, includes, privateRoot, root)
  )
  notify.mockClear()
  const delivered = vi.fn()
  f.app.vault.on('create', delivered)
  f.reconcile.mockImplementationOnce(function (path) {
    this.handler('file-created', path)
    this.handler('file-created', 'Private/notification.bin')
    return Promise.resolve()
  })
  await Reflect.get(fs, RECONCILE_ORIGIN)('Remote/seed.md', notify)
  expect(f.reconcile.mock.calls.at(-1)).toEqual(['Shared/seed.md'])
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify.mock.calls.at(-1)?.slice(0, 2)).toEqual(['file-created', 'Remote/seed.md'])
  expect(delivered.mock.calls.some(([file]) => file.path === 'Private/notification.bin')).toBe(true)
  await expect(async () =>
    Reflect.get(fs, RECONCILE_ORIGIN)('Private/sample.bin', notify)
  ).rejects.toThrow()
  await reconcileVaultFile(f.app.vault as never, f.adapter, 'Shared/seed.md')
})

it('rechecks the current folder when a connection follows a moved root', async () => {
  const f = fixture()
  let current = 'Shared'
  const adapter = connectionAdapter(f.app.vault.adapter, () => current, privateRoot)
  const notify = (_kind: string, _path: string, deliver: () => unknown) => deliver()
  await Reflect.get(adapter, RECONCILE_ORIGIN)('Shared/seed.md', notify)
  current = 'Moved'
  const before = f.reconcile.mock.calls.length
  await expect(async () =>
    Reflect.get(adapter, RECONCILE_ORIGIN)('Shared/seed.md', notify)
  ).rejects.toThrow('outside this connection')
  expect(f.reconcile).toHaveBeenCalledTimes(before)
  await Reflect.get(adapter, RECONCILE_ORIGIN)('Moved/seed.md', notify)
  expect(f.reconcile.mock.calls.at(-1)).toEqual(['Moved/seed.md'])
})
