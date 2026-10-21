import { expect, it } from 'vitest'
import { foldDelegateHistory } from '@/node/obsidianDelegateHistory'
import { boundedConversation } from '@/node/NodeObsidianDelegate'
it('keeps the last complete message when a later version is only partly recorded', () => {
  const text = JSON.stringify({
    id: 'sample-message',
    role: 'assistant',
    content: 'Complete sample answer',
    timestamp: 1,
  })
  expect(
    foldDelegateHistory([
      { id: 'sample-message', version: 1, part: 0, parts: 1, text },
      { id: 'sample-message', version: 2, part: 0, parts: 2, text: '{"id":' },
    ])
  ).toEqual([JSON.parse(text)])
})
it('retains every ancestor scope and the stricter skills, permissions and GitHub rights in nested contexts', () => {
  const root = {
    scope: [{ type: 'file', path: 'sample.md' }],
    permissionMode: 'confirm-all',
    skills: ['sample'],
    githubConnections: { sample: 'ask' },
    toolModes: { read: 'auto', create: 'off' },
  }
  const target = {
    fullVaultAccess: true,
    permissionMode: 'allow-all',
    skills: ['sample', 'other'],
    githubConnections: { sample: 'auto', other: 'auto' },
    toolModes: { read: 'auto', create: 'auto' },
  }
  const first = boundedConversation(target, root),
    nested = boundedConversation(target, first)
  expect(nested.permissionMode).toBe('confirm-all')
  expect(nested.skills).toEqual(['sample'])
  expect(nested.githubConnections).toEqual({ sample: 'ask', other: 'off' })
  expect(nested.toolModes.create).toBe('off')
  expect(nested.ceilings).toEqual(
    expect.arrayContaining([expect.objectContaining({ scope: root.scope })])
  )
})
