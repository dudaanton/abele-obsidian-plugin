import { expect, it, vi } from 'vitest'
import type { NodeClient } from '@abele/node-client'
import { referencePreviewReader } from '@/node/referencePreview'

it('shares the working-tree observation and skips large or binary preview bodies', async () => {
  const source = 'sample()'
  const content = vi.fn(async () => ({ offset: 0, total: source.length, base64: btoa(source) }))
  const observe = vi.fn(async () => ({
    revision: { kind: 'working', observation_id: 'fake-observation' },
  }))
  const blob = vi.fn(async ({ path }: { path: string }) => ({
    content_id: path,
    binary: path === 'binary.ts',
    size: path === 'large.ts' ? 1024 * 1024 : source.length,
  }))
  const client = { repository: { observe, blob, content } } as unknown as NodeClient
  const read = referencePreviewReader(client, {
    nodeId: 'fake-node',
    registrationId: 'fake-registration',
    projectId: 'fake-project',
    kind: 'worktree',
    id: 'fake-worktree',
  })
  expect(await read('first.ts')).toBe(source)
  expect(await read('second.ts')).toBe(source)
  expect(await read('large.ts')).toBe('')
  expect(await read('binary.ts')).toBe('')
  expect(observe).toHaveBeenCalledOnce()
  expect(content).toHaveBeenCalledTimes(2)
  expect(blob).toHaveBeenCalledWith(
    expect.objectContaining({
      worktree_id: 'fake-worktree',
      revision: { kind: 'working', observation_id: 'fake-observation' },
    })
  )
})
