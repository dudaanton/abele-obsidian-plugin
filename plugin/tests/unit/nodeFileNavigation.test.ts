import { expect, it } from 'vitest'
import { fileNavigation } from '@/node/fileNavigation'
import { nodeRepositoryLink } from '@/repository/nodeLinks'
import type { PathTarget } from '@/node/NodePathModel'
import { NodePathTabSchema } from '@/node/nodePathNavigation'

const target: PathTarget = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree',
  id: 'sample-tree',
}
const source = {
  provider: 'node' as const,
  installation: 'sample-installation',
  node: target.registrationId,
  project: target.projectId,
  workspace: target.id,
}
it('keeps a definition destination in a node file tab at its line', () => {
  const url = nodeRepositoryLink(source, {
    kind: 'file',
    ref: 'working-sample',
    path: 'src/sample.ts',
    lines: { from: 8, to: 8 },
  })
  expect(NodePathTabSchema.parse(fileNavigation(target, url))).toEqual({
    kind: 'file',
    target,
    path: 'src/sample.ts',
    line: 8,
  })
})
it('keeps the full working-file range from a repository citation', () => {
  const url = nodeRepositoryLink(source, {
    kind: 'file',
    ref: 'working-sample',
    path: 'src/sample.ts',
    lines: { from: 3, to: 7 },
  })
  expect(fileNavigation(target, url)).toMatchObject({ line: 3, endLine: 7 })
})
it('recognizes a working observation carried with a resolved ref', () => {
  const url = nodeRepositoryLink(
    source,
    { kind: 'file', ref: 'a'.repeat(40), path: 'sample.ts' },
    {
      kind: 'working-tree',
      head: 'a'.repeat(40),
      observation: 'sample-observation',
      observedAt: '2026-01-01T00:00:00Z',
    }
  )
  expect(fileNavigation(target, url)).toMatchObject({ kind: 'file', path: 'sample.ts', target })
})
it('leaves historical and other workspace links in the repository viewer', () => {
  expect(
    fileNavigation(
      target,
      nodeRepositoryLink(source, { kind: 'file', ref: 'a'.repeat(40), path: 'sample.ts' })
    )
  ).toBeUndefined()
  expect(
    fileNavigation(
      { ...target, id: 'other-tree' },
      nodeRepositoryLink(source, { kind: 'file', ref: 'working-sample', path: 'sample.ts' })
    )
  ).toBeUndefined()
})
it('treats only the editor origin ref as current when editing began from a committed comparison', () => {
  const ref = 'a'.repeat(40)
  const link = nodeRepositoryLink(source, { kind: 'file', ref, path: 'sample.ts' })
  expect(fileNavigation(target, link, ref)).toMatchObject({ kind: 'file', path: 'sample.ts' })
  expect(fileNavigation(target, link, 'b'.repeat(40))).toBeUndefined()
})
