import { expect, it } from 'vitest'
import { collectFiles, targetPath } from '@/transfer/files'
import { useVault } from '../helpers/testEnv'

it('transfers folder access with relative placement under the receiving chats directory', async () => {
  const app = useVault([
    { path: 'AI/Chats/Projects/_folder.abeleaccess', content: '{"web_search":"auto"}' },
  ])
  const entries = await collectFiles(app as never, '', 'AI/Chats')
  const access = entries.find((entry) => entry.section === 'chat-folder-access')!
  expect(access.data).toEqual({
    path: 'Projects/_folder.abeleaccess',
    base: 'AI/Chats',
    content: '{"web_search":"auto"}',
  })
  expect(targetPath(access, '', 'Conversations')).toBe('Conversations/Projects/_folder.abeleaccess')
})
