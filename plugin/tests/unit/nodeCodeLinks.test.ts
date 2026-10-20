import { expect, it } from 'vitest'
import { nodeCodeLink, resolveNodeCodeLink } from '@/node/codeLinks'
const scope = {
  nodeId: 'node',
  registrationId: 'registration',
  projectId: 'project',
  kind: 'worktree' as const,
  id: 'tree',
}
it('round trips working content and ranges within the chat scope', () => {
  const link = nodeCodeLink(scope, 'src/sample.ts', { start: 3, end: 7 })
  expect(resolveNodeCodeLink(link, scope)).toEqual({ path: 'src/sample.ts', line: 3, endLine: 7 })
  expect(resolveNodeCodeLink(link, { ...scope, id: 'other' })).toBeUndefined()
})
it('resolves natural citations and confines absolute paths to a known root', () => {
  expect(resolveNodeCodeLink('src/sample.ts:3-7', scope)).toEqual({
    path: 'src/sample.ts',
    line: 3,
    endLine: 7,
  })
  expect(
    resolveNodeCodeLink('file:///sample/tree/src/sample.ts#L3-L7', scope, '/sample/tree')
  ).toEqual({ path: 'src/sample.ts', line: 3, endLine: 7 })
  for (const path of [
    '../secret.ts:3',
    '/other/sample.ts:3',
    'src/../../secret.ts:3',
    'src/sample.ts:0',
    'src/sample.ts:7-3',
  ])
    expect(resolveNodeCodeLink(path, scope, '/sample/tree')).toBeUndefined()
})
