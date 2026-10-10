import { expect, it } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { TokenAttachmentHost } from '@/sync/tokenAttachmentHost'

it('resolves private links only on explicit note inspection and retains local identity through rename/restart', async () => {
  const app = useVault([
    { path: 'Notes/sample.md', content: '![[Private/sample.png]]' },
    { path: 'Private/sample.png', content: 'private bytes' },
  ])
  const host = new TokenAttachmentHost(app as never)
  const note = await host.note('Notes/sample.md')
  expect(note?.targets).toHaveLength(1)
  const target = note!.targets[0]
  await app.vault.rename(app.vault.getFileByPath(target.path)!, 'Private/renamed.png')
  host.renamed('Private/sample.png', 'Private/renamed.png')
  expect(new TokenAttachmentHost(app as never).resolve(target.id)?.path).toBe('Private/renamed.png')
  expect(app.loadLocalStorage('abele-token-local-files-v1')).not.toBeNull()
})
it('keeps consent identity through proven offload and hydration, but never adopts a replacement file', async () => {
  const app = useVault([{ path: 'sample.bin', content: 'bytes' }])
  let absent = false
  const host = new TokenAttachmentHost(app as never, () => absent)
  host.remember('sample.bin')
  const rows = app.loadLocalStorage('abele-token-local-files-v1') as { id: string }[],
    id = rows[0].id
  await app.vault.adapter.remove('sample.bin')
  absent = true
  expect(host.resolve(id)?.path).toBe('sample.bin')
  absent = false
  expect(host.resolve(id)).toBeNull()
  await app.vault.adapter.write('sample.bin', 'bytes')
  host.hydrated('sample.bin')
  expect(host.resolve(id)?.path).toBe('sample.bin')
  await app.vault.adapter.remove('sample.bin')
  await app.vault.adapter.write('sample.bin', 'different file', { ctime: 9876 })
  expect(host.resolve(id)).toBeNull()
})
