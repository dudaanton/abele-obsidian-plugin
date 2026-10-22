import { expect, it } from 'vitest'
import { canEditNodeFile } from '@/node/fileEditContext'
import type { PathDocument, PathFileStage } from '@/node/NodePathModel'

const document: PathDocument = {
  target: {
    nodeId: 'sample',
    registrationId: 'sample',
    projectId: 'sample',
    kind: 'worktree',
    id: 'sample',
  },
  path: 'sample.ts',
  text: 'working',
  contentId: 'a'.repeat(64),
  change: {
    path: 'sample.ts',
    kind: 'modified',
    before: 'before',
    after: 'working',
    added: 1,
    removed: 1,
  },
}
it('admits only working text documents', () => {
  expect(canEditNodeFile(document)).toBe(true)
  expect(canEditNodeFile(undefined)).toBe(false)
  for (const stage of ['staged', { kind: 'committed', base: 'sample' }] as PathFileStage[])
    expect(canEditNodeFile(document, stage)).toBe(false)
  expect(canEditNodeFile({ ...document, revision: { kind: 'commit', commit: 'sample' } })).toBe(
    false
  )
  for (const change of [
    { kind: 'deleted' as const },
    { binary: true },
    { pending: true },
    { stage: 'staged' as const },
  ])
    expect(canEditNodeFile({ ...document, change: { ...document.change!, ...change } })).toBe(false)
})
