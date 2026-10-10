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
