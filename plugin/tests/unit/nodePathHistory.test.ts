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

describe('commit page loading', () => {
  const files = Array.from({ length: 10 }, (_, i) => ({
    path: `file-${i}.txt`,
    kind: 'modified' as const,
    before: '',
    after: '',
    added: 0,
    removed: 0,
    pending: true,
  }))
  function held() {
    const releases: (() => void)[] = []
    let active = 0,
      peak = 0
    const port = {
      commit: vi.fn(),
      commitIndex: vi.fn(async (_t: unknown, hash: string) => ({ ...commit(hash), files })),
      commitFile: vi.fn(async (_t: unknown, _c: unknown, file: (typeof files)[number]) => {
        peak = Math.max(peak, ++active)
        await new Promise<void>((resolve) => releases.push(resolve))
        active--
        return { ...file, pending: undefined, after: `text of ${file.path}` }
      }),
    }
    return { port, releases, peak: () => peak }
  }
  it('shows the files of a commit at once and fills their contents two at a time', async () => {
    const h = held()
    const model = new NodePathHistoryModel(h.port as unknown as NodePathPort, target)
    const opening = model.open('sample-hash')
    await vi.waitFor(() => expect(model.openCommit.value).toBe('sample-hash'))
    expect(model.busy.value).toBe(false)
    expect(model.commits.value[0].files?.map((f) => f.pending)).toEqual(files.map(() => true))
    await vi.waitFor(() => expect(h.releases).toHaveLength(2))
    while (h.port.commitFile.mock.calls.length < files.length || h.releases.length) {
      h.releases.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await opening
    expect(h.peak()).toBe(2)
    expect(model.commits.value[0].files?.map((f) => f.after)).toEqual(
      files.map((f) => `text of ${f.path}`)
    )
    expect(model.commits.value[0].files?.some((f) => f.pending)).toBe(false)
    expect(h.port.commit).not.toHaveBeenCalled()
  })
  it('stops reading the files of a commit once it is left', async () => {
    const h = held()
    const model = new NodePathHistoryModel(h.port as unknown as NodePathPort, target)
    const opening = model.open('sample-hash')
    await vi.waitFor(() => expect(h.releases).toHaveLength(2))
    model.back()
    for (const release of h.releases.splice(0)) release()
    await opening
    expect(h.port.commitFile).toHaveBeenCalledTimes(2)
    expect(model.openCommit.value).toBe('')
  })
})
