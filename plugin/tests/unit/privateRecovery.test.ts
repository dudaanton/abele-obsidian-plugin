import { expect, it, vi } from 'vitest'
import { Notice, type App } from 'obsidian'
import { preservePrivateArtifacts, showPrivateRecoveryNotice } from '@/sync/privateRecovery'
import { makeParents } from '@/sync/vaultFolders'
import { buildFakeVault } from '../helpers/fakeVault'

it('notifies again when new copies are preserved after the first notice is dismissed', async () => {
  const app = buildFakeVault([]) as unknown as App
  const count = Notice.shown.length
  const first = '.obsidian/plugins/abele/sync-staging/sample-first.bin'
  const second = '.obsidian/plugins/abele/sync-staging/sample-second.bin'
  await makeParents(app.vault.adapter, first)
  await app.vault.adapter.write(first, 'sample first edit')
  await preservePrivateArtifacts(app, [first])
  expect(Notice.shown.length).toBe(count + 1)
  document.querySelectorAll('.notice').forEach((el) => el.remove())
  await showPrivateRecoveryNotice(app)
  expect(Notice.shown.length).toBe(count + 1)
  await app.vault.adapter.write(second, 'sample second edit')
  await preservePrivateArtifacts(app, [second])
  expect(Notice.shown.length).toBe(count + 2)
  await preservePrivateArtifacts(app, [first, second])
  expect(Notice.shown.length).toBe(count + 2)
  expect(await app.vault.adapter.read(first.replace('/sync-staging/', '/sync-recovery/'))).toBe(
    'sample first edit'
  )
  expect(await app.vault.adapter.read(second.replace('/sync-staging/', '/sync-recovery/'))).toBe(
    'sample second edit'
  )
})

it('notifies about preserved copies even when a later move in the batch fails', async () => {
  const app = buildFakeVault([]) as unknown as App
  const prefix = '.obsidian/plugins/abele/sync-staging/'
  const paths = ['sample-initial.bin', 'sample-kept.bin', 'sample-failed.bin'].map(
    (name) => prefix + name
  )
  for (const path of paths) {
    await makeParents(app.vault.adapter, path)
    await app.vault.adapter.write(path, 'sample recovery bytes')
  }
  await preservePrivateArtifacts(app, [paths[0]])
  const count = Notice.shown.length
  const rename = app.vault.adapter.rename.bind(app.vault.adapter)
  vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
    if (from === paths[2]) throw new Error('sample move failed')
    return rename(from, to)
  })
  await expect(preservePrivateArtifacts(app, paths.slice(1))).rejects.toThrow('sample move failed')
  expect(Notice.shown.length).toBe(count + 1)
  expect(await app.vault.adapter.read(paths[1].replace('/sync-staging/', '/sync-recovery/'))).toBe(
    'sample recovery bytes'
  )
  expect(await app.vault.adapter.read(paths[2])).toBe('sample recovery bytes')
})
