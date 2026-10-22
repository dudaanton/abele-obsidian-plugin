import { expect, it } from 'vitest'
import { getAvailablePath } from '@/helpers/vaultUtils'
import { useVault } from '../helpers/testEnv'

it('uses space numbering for renamed chats while keeping other callers unchanged', async () => {
  useVault([
    { path: 'Chats/Sample.abchat', content: '' },
    { path: 'Chats/Sample 2.abchat', content: '' },
  ])
  expect(await getAvailablePath('Chats/Sample.abchat', undefined, 'space')).toBe(
    'Chats/Sample 3.abchat'
  )
  expect(await getAvailablePath('Chats/Sample.abchat')).toBe('Chats/Sample (1).abchat')
})

it('keeps long renamed chat filenames within the existing filename limit', async () => {
  useVault([])
  const path = await getAvailablePath(`Chats/${'x'.repeat(400)}.abchat`, undefined, 'space')
  expect(path.split('/').at(-1)!.length).toBeLessThanOrEqual(255)
  expect(path).toMatch(/ 2\.abchat$/)
})
