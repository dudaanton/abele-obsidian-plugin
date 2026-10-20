import { expect, it, vi } from 'vitest'
import { Notice, type App } from 'obsidian'
import { preservePrivateArtifacts, showPrivateRecoveryNotice } from '@/sync/privateRecovery'
import { makeParents } from '@/sync/vaultFolders'
import { buildFakeVault } from '../helpers/fakeVault'
import { sha256 } from '@abele/sync-sdk/core'

it('announces a changed displaced routine copy even after an earlier notice', async () => {
  const app = buildFakeVault([]) as unknown as App
  const path = '.obsidian/plugins/abele/sync-staging/sample-reused.bin'
  const kept = path.replace('/sync-staging/', '/sync-recovery/')
  await makeParents(app.vault.adapter, path)
  await app.vault.adapter.write(path, 'unique evidence')
  await preservePrivateArtifacts(app, [path])
  const expected = { path, sha: await sha256(new TextEncoder().encode('routine')), size: 7 }
  await app.vault.adapter.write(path, 'routine')
  await preservePrivateArtifacts(app, [path], () => {}, [expected])
  await app.vault.adapter.write(kept, 'changed evidence')
  const count = Notice.shown.length
  await app.vault.adapter.write(path, 'routine')
  await preservePrivateArtifacts(app, [path], () => {}, [expected])
  expect(Notice.shown.length).toBe(count + 1)
  const files = await app.vault.adapter.list(kept.slice(0, kept.lastIndexOf('/')))
  expect(await Promise.all(files.files.map((file) => app.vault.adapter.read(file)))).toContain(
    'changed evidence'
  )
})

it('does not announce an empty recovery directory or byte-verified routine evidence, but detects later edits', async () => {
  const app = buildFakeVault([]) as unknown as App
  const count = Notice.shown.length
  const recovery = '.obsidian/plugins/abele/sync-recovery'
  await app.vault.adapter.mkdir(recovery)
  await showPrivateRecoveryNotice(app)
  expect(Notice.shown.length).toBe(count)
  const path = '.obsidian/plugins/abele/sync-staging/sample-evidence.bin'
  await makeParents(app.vault.adapter, path)
  await app.vault.adapter.write(path, 'ordinary retained bytes')
  const expected = {
    path,
    sha: await sha256(new TextEncoder().encode('ordinary retained bytes')),
    size: 23,
  }
  await preservePrivateArtifacts(app, [path], () => {}, [expected])
  await showPrivateRecoveryNotice(app)
  expect(Notice.shown.length).toBe(count)
  const kept = path.replace('/sync-staging/', '/sync-recovery/')
  await app.vault.adapter.write(kept, 'a unique later edit')
  await showPrivateRecoveryNotice(app)
  expect(Notice.shown.length).toBe(count + 1)
  expect(await app.vault.adapter.read(kept)).toBe('a unique later edit')
})

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

it('retains the classification of concurrent routine copies from independent connections', async () => {
  const app = buildFakeVault([]) as unknown as App
  const count = Notice.shown.length
  const paths = ['sample-a.bin', 'sample-b.bin'].map(
    (name) => '.obsidian/plugins/abele/sync-staging/' + name
  )
  const bytes = new TextEncoder().encode('ordinary retained bytes')
  const sha = await sha256(bytes)
  for (const path of paths) {
    await makeParents(app.vault.adapter, path)
    await app.vault.adapter.write(path, 'ordinary retained bytes')
  }
  await Promise.all(
    paths.map((path) =>
      preservePrivateArtifacts(app, [path], () => {}, [{ path, sha, size: bytes.length }])
    )
  )
  await showPrivateRecoveryNotice(app)
  expect(Notice.shown.length).toBe(count)
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
