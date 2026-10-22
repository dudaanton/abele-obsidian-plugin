import { expect, it, vi } from 'vitest'
import { MemoryFileSystem } from '@abele/sync-sdk/core'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { reviewFileSystem } from '@/sync/reviewFileSystem'
import type { ConditionalFileOperation } from '@/sync/conditionalFiles'

it('checks both public paths and opaque stages before a conditional scope effect', async () => {
  const conditionalFile = vi.fn(async () => true),
    installedFile = vi.fn(async () => true)
  const disk = Object.assign(new MemoryFileSystem(), { conditionalFile, installedFile })
  const includes = (path: string) => path.startsWith('Shared/')
  const scoped = scopedFileSystem(
    disk,
    (path) => {
      if (!includes(path)) throw new Error('outside scope')
    },
    includes
  )
  for (const operation of [
    { path: 'Other/sample.bin', expected: null, effect: { kind: 'remove' } },
    { path: 'Shared/sample.bin', expected: null, effect: { kind: 'move', to: 'Other/sample.bin' } },
    {
      path: 'Shared/sample.bin',
      expected: null,
      effect: { kind: 'install', stageId: 'Other/sample.tmp' },
    },
  ])
    await expect(async () => Reflect.get(scoped, 'conditionalFile')(operation)).rejects.toThrow(
      'outside scope'
    )
  await expect(async () =>
    Reflect.get(scoped, 'installedFile')('receipt', 'Other/sample.bin', 'sha')
  ).rejects.toThrow('outside scope')
  expect(conditionalFile).not.toHaveBeenCalled()
  expect(installedFile).not.toHaveBeenCalled()
})

it('maps conditional public paths while retaining opaque receipt and stage identities', async () => {
  const conditionalFile = vi
      .fn<(operation: ConditionalFileOperation) => Promise<boolean>>()
      .mockResolvedValue(true),
    installedFile = vi
      .fn<(receipt: string, path: string, sha: string) => Promise<boolean>>()
      .mockResolvedValue(true)
  const disk = Object.assign(new MemoryFileSystem(), { conditionalFile, installedFile })
  const placed = new LocalFolderPlacement('Shared', 'Moved').fileSystem(disk)
  const operation: ConditionalFileOperation = {
    path: 'Shared/sample.bin',
    expected: null,
    effect: { kind: 'move', to: 'Shared/other.bin' },
  }
  await placed.conditionalFile(operation)
  expect(conditionalFile).toHaveBeenLastCalledWith({
    ...operation,
    path: 'Moved/sample.bin',
    effect: { kind: 'move', to: 'Moved/other.bin' },
  })
  await placed.conditionalFile({
    ...operation,
    effect: { kind: 'install', stageId: 'opaque-stage' },
  })
  expect(conditionalFile).toHaveBeenLastCalledWith({
    ...operation,
    path: 'Moved/sample.bin',
    effect: { kind: 'install', stageId: 'opaque-stage' },
  })
  await placed.installedFile('opaque-receipt', 'Shared/sample.bin', 'sha')
  expect(installedFile).toHaveBeenCalledWith('opaque-receipt', 'Moved/sample.bin', 'sha')
})

it('gates conditional effects and capture recovery on the current review approval', async () => {
  const conditionalFile = vi.fn(async () => true),
    recoverConditionalFiles = vi.fn(async () => {})
  const fs = reviewFileSystem(
    Object.assign(new MemoryFileSystem(), { conditionalFile, recoverConditionalFiles }),
    () => {
      throw new Error('review revoked')
    }
  )
  await expect(async () => fs.conditionalFile()).rejects.toThrow('review revoked')
  await expect(fs.recoverConditionalFiles()).rejects.toThrow('review revoked')
  expect(conditionalFile).not.toHaveBeenCalled()
  expect(recoverConditionalFiles).not.toHaveBeenCalled()
})
