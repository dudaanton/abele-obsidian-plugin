import { expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { connectionAdapter, connectionInspectionApp } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { transferBudgetOf } from '@/sync/transferBudget'
import { externalCoordinationOf } from '@/sync/external/ObsidianExternalFileHost'
import { buildFakeVault } from '../helpers/fakeVault'
import { nativeOf } from '@/sync/nativeVaultFs'

it('allows only exact read-only control-file access outside the folder', async () => {
  const app = buildFakeVault([])
  await app.vault.adapter.write('.abele-sync-ignore', 'Shared/excluded.md\n')
  const adapter = connectionAdapter(app.vault.adapter, 'Shared', connectionPrivateRoot('sample'))
  expect(await adapter.exists('.abele-sync-ignore')).toBe(true)
  expect(new TextDecoder().decode(await adapter.readBinary('.abele-sync-ignore'))).toBe(
    'Shared/excluded.md\n'
  )
  for (const path of ['.abele-sync-ignore-other', '.ABELE-SYNC-IGNORE', './.abele-sync-ignore'])
    expect(() => adapter.readBinary(path)).toThrow()
  expect(() => adapter.list('.abele-sync-ignore')).toThrow('outside')
  expect(() => adapter.list('')).toThrow('outside')
  expect(() => adapter.write('.abele-sync-ignore', '')).toThrow('outside')
  expect(() => adapter.remove('.abele-sync-ignore')).toThrow('outside')
  expect(() => adapter.rename('.abele-sync-ignore', 'Shared/settings.md')).toThrow('outside')
  expect(() => adapter.rename('Shared/settings.md', '.abele-sync-ignore')).toThrow('outside')
  expect(await app.vault.adapter.read('.abele-sync-ignore')).toBe('Shared/excluded.md\n')
})

it('keeps native backup recovery inside the connection namespace and preserves adapter queueing', async () => {
  const privateRoot = connectionPrivateRoot('sample')
  const mkdir = vi.fn(async () => {}),
    link = vi.fn(async () => {}),
    unlink = vi.fn(async () => {})
  const queue = vi.fn(async (work: () => Promise<void>) => work())
  const raw = {
    getFullPath: (path: string) => '/sample-vault/' + path,
    queue,
    fsPromises: { mkdir, link, unlink, stat: vi.fn(), rename: vi.fn(), rmdir: vi.fn() },
  }
  const adapter = connectionAdapter(raw as unknown as DataAdapter, 'Shared', privateRoot)
  const native = nativeOf(adapter, () => {}, privateRoot + '/recovery')!
  const archived = await native.archiveBackup!(privateRoot + '/writes/sample.old')
  expect(archived.startsWith('/sample-vault/' + privateRoot + '/recovery/')).toBe(true)
  expect(mkdir.mock.calls[0][0]).toBe('/sample-vault/' + privateRoot + '/recovery')
  expect(link).toHaveBeenCalledOnce()
  expect(unlink).toHaveBeenCalledOnce()
  await Reflect.get(adapter, 'queue')(async () => {})
  expect(queue).toHaveBeenCalledOnce()
})

it('keeps per-connection adapter instrumentation off the shared adapter', () => {
  const read = vi.fn(),
    replacement = vi.fn()
  const raw = { readBinary: read } as unknown as DataAdapter
  const scoped = connectionAdapter(raw, 'Shared', connectionPrivateRoot('sample'))
  Object.defineProperty(scoped, 'readBinary', { value: replacement, configurable: true })
  expect(raw.readBinary).toBe(read)
  expect(() => scoped.readBinary('Private/secret.md')).toThrow('outside')
  expect(replacement).not.toHaveBeenCalled()
})

it.each([
  'Private/secret.md',
  'Shared2/secret.md',
  'Shared/../Private/secret.md',
  '.abele-sync/connections/other/placement-inbox/sample',
])('refuses a direct adapter bypass before reading %s', async (path) => {
  const read = vi.fn(),
    futureRead = vi.fn()
  const adapter = connectionAdapter(
    { readBinary: read, futureRead } as unknown as DataAdapter,
    'Shared',
    connectionPrivateRoot('sample')
  )
  await expect(async () => adapter.readBinary(path)).rejects.toMatchObject({ code: 'protocol' })
  expect(() => Reflect.get(adapter, 'futureRead')('Shared/sample.md')).toThrow('no scope policy')
  expect(read).not.toHaveBeenCalled()
  expect(futureRead).not.toHaveBeenCalled()
})

it('checks both native operands and retains shared coordination through the inspection facade', async () => {
  const rename = vi.fn(async () => {}),
    readFile = vi.fn(async () => new Uint8Array())
  const raw = {
    getFullPath: (path: string) => '/sample-vault/' + path,
    fsPromises: { rename, readFile },
  }
  const adapter = connectionAdapter(
    raw as unknown as DataAdapter,
    'Shared',
    connectionPrivateRoot('sample')
  )
  const native = Reflect.get(adapter, 'fsPromises')
  await expect(async () =>
    native.rename('/sample-vault/Shared/sample.md', '/sample-vault/Private/secret.md')
  ).rejects.toThrow('outside')
  await expect(async () => native.readFile('/sample-vault/Private/secret.md')).rejects.toThrow(
    'outside'
  )
  expect(rename).not.toHaveBeenCalled()
  expect(readFile).not.toHaveBeenCalled()
  const app = buildFakeVault([])
  const scoped = connectionInspectionApp(
    app as never,
    adapter,
    'Shared',
    connectionPrivateRoot('sample')
  )
  expect(pathCoordinatorOf(scoped.vault)).toBe(pathCoordinatorOf(app.vault))
  expect(transferBudgetOf(scoped.vault)).toBe(transferBudgetOf(app.vault))
  expect(externalCoordinationOf(scoped.vault)).toBe(externalCoordinationOf(app.vault))
})
