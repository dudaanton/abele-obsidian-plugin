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
