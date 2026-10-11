import { describe, expect, it, vi } from 'vitest'
import { NodePathHistoryModel } from '@/node/NodePathHistoryModel'
import type { NodePathPort } from '@/node/NodePathModel'
const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-tree',
}
const commit = (hash: string) => ({
  hash,
  subject: 'Sample change',
  author: 'Sample',
  when: '12:00',
  day: 'Today',
})
describe('frozen target history', () => {
  it('keeps the list in its original order after inspecting a commit', async () => {
    const port = {
      history: vi.fn(async () => ({
        entries: [commit('newest'), commit('older')],
        cursor: null,
        revision: { kind: 'commit' as const, commit: 'a'.repeat(40) },
      })),
      commit: vi.fn(async (t, hash) => ({ ...commit(hash), files: [] })),
    } as unknown as NodePathPort
    const model = new NodePathHistoryModel(port, target)
    await model.load()
    await model.open('newest')
    model.back()
    expect(model.commits.value.map((c) => c.hash)).toEqual(['newest', 'older'])
  })
  it('continues older pages from the captured revision and does not duplicate a commit', async () => {
    const history = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [commit('newest')],
        cursor: 'next',
        revision: { kind: 'commit', commit: 'a'.repeat(40) },
      })
      .mockResolvedValueOnce({ entries: [commit('newest'), commit('older')], cursor: null })
    const model = new NodePathHistoryModel({ history } as unknown as NodePathPort, target)
    await model.load()
    await model.load(true)
    expect(history.mock.calls[1]).toEqual([
      target,
      'next',
      { kind: 'commit', commit: 'a'.repeat(40) },
    ])
    expect(model.commits.value).toHaveLength(2)
  })
  it('does not publish a late error after leaving a commit', async () => {
    let reject!: (error: Error) => void
    const model = new NodePathHistoryModel(
      {
        commit: vi.fn(
          () =>
            new Promise((_resolve, failure) => {
              reject = failure
            })
        ),
      } as unknown as NodePathPort,
      target
    )
    const pending = model.open('sample-hash')
    model.back()
    reject(new Error('late failure'))
    await expect(pending).rejects.toThrow('late failure')
    expect(model.error.value).toBe('')
  })
})
