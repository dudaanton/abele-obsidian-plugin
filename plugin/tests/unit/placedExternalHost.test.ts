import { expect, it, vi } from 'vitest'
import { placedExternalHost } from '@/sync/placedExternalHost'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import type { ExternalHostRequest } from '@/sync/external/ObsidianExternalFileHost'

it('reserves physical paths but retains canonical intent and uncertain-outcome evidence', async () => {
  const artifact = {
    path: 'Shared/source.bin',
    operationId: 'operation',
    sha: 'a'.repeat(64),
    size: 1,
    role: 'retained' as const,
  }
  const install = vi.fn(async () => ({
    status: 'outcome-unknown',
    paths: ['Moved/target.bin'],
    artifacts: [{ ...artifact, path: 'Moved/source.bin' }],
  }))
  let reserved: ExternalHostRequest | undefined
  const raw = {
    run: async (
      _serial: unknown,
      request: ExternalHostRequest,
      work: (effects: unknown) => Promise<unknown>
    ) => {
      reserved = request
      request.assertIntent('install', ['Moved/source.bin'], {
        ...artifact,
        path: 'Moved/source.bin',
      })
      return work({ install })
    },
  }
  const intent = vi.fn(),
    host = placedExternalHost(raw as never, new LocalFolderPlacement('Shared', 'Moved'))
  const result = await host.run(
    { run: (work) => work() },
    {
      operationId: 'operation',
      fileId: 'file',
      paths: ['Shared/source.bin', 'Shared/target.bin'],
      assertIntent: intent,
    },
    (effects) => effects.install(artifact, 'Shared/target.bin')
  )
  expect(reserved?.paths).toEqual(['Moved/source.bin', 'Moved/target.bin'])
  expect(intent).toHaveBeenCalledWith('install', ['Shared/source.bin'], artifact)
  expect(install).toHaveBeenCalledWith(
    { ...artifact, path: 'Moved/source.bin' },
    'Moved/target.bin'
  )
  expect(result).toMatchObject({ paths: ['Shared/target.bin'], artifacts: [artifact] })
})

it('checks the physical ancestor after translating a placed attachment path', async () => {
  const { buildFakeVault } = await import('../helpers/fakeVault')
  const { ExternalFileHost } = await import('@/sync/external/ObsidianExternalFileHost')
  const app = buildFakeVault([{ path: 'Moved/sample.bin', content: 'external' }])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  Object.assign(app.vault.adapter, {
    getFullPath: (p: string) => p,
    fsPromises: { lstat: async (p: string) => ({ isSymbolicLink: () => p === 'Moved' }) },
  })
  const read = vi.spyOn(app.vault.adapter, 'readBinary')
  const raw = new ExternalFileHost(app as never, { platform: 'mobile', assertOwned: () => {} })
  const host = placedExternalHost(raw, new LocalFolderPlacement('Shared', 'Moved'))
  try {
    await expect(host.read('Shared/sample.bin')).rejects.toThrow(/symbolic link/i)
    expect(read).not.toHaveBeenCalled()
  } finally {
    raw.close()
  }
})
