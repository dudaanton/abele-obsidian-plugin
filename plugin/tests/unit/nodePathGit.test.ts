import { describe, expect, it, vi } from 'vitest'
import { nodePathGit, pullSummary, type NodeGitClient } from '@/node/nodePathGit'
import { NodePathModel, type NodePathPort, type PathTarget } from '@/node/NodePathModel'

const target: PathTarget = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree',
  id: 'sample-worktree',
}
const seen = {
  kind: 'working' as const,
  observation_id: 'seen-observation',
  head: 'a'.repeat(40),
  observed_at: '2025-01-01T00:00:00.000Z',
}
function client(over: Partial<Record<keyof NodeGitClient, unknown>> = {}) {
  const ok = vi.fn(async () => ({ state: 'applied' }))
  return {
    info: vi.fn(async () => ({
      head: seen.head,
      branch: 'refs/heads/sample-branch',
      detached: false,
      operation: null,
      upstream: {
        ref: 'refs/remotes/fork/sample-branch',
        remote: 'fork',
        branch: 'refs/heads/sample-branch',
        ahead: 2,
        behind: 0,
      },
      default_branch: 'refs/remotes/origin/main',
      remotes: [
        {
          name: 'origin',
          url: 'https://example.invalid/a',
          forge: { kind: 'github', host: 'github.com', owner: 'sample', name: 'origin-repo' },
        },
        {
          name: 'fork',
          url: 'https://example.invalid/b',
          forge: { kind: 'github', host: 'github.com', owner: 'sample', name: 'fork-repo' },
        },
      ],
      author: { name: 'Sample Person', email: 'person@example.invalid' },
    })),
    stage: ok,
    unstage: ok,
    discard: ok,
    commit: vi.fn(async () => ({
      state: 'committed',
      commit: 'b'.repeat(40),
      author: { name: 'Sample Person', email: 'x' },
    })),
    update: vi.fn(async () => ({ state: 'conflicts', conflicted_paths: ['src/a.ts'] })),
    continue: vi.fn(async () => ({ state: 'continued' })),
    abort: vi.fn(async () => ({ state: 'aborted' })),
    push: vi.fn(async () => ({ state: 'pushed' })),
    ...over,
  }
}

describe('git on a node worktree', () => {
  it('names the branch, its upstream and the service of the remote it pushes to', async () => {
    const info = await nodePathGit(client() as never).info(target)
    expect(info).toMatchObject({
      branch: 'sample-branch',
      upstream: { ref: 'refs/remotes/fork/sample-branch', ahead: 2 },
      forge: { owner: 'sample', name: 'fork-repo' },
      author: { name: 'Sample Person' },
    })
  })
  it('stages against the HEAD the person saw, the files named or all of them', async () => {
    const raw = client()
    const git = nodePathGit(raw as never)
    await git.stage(target, seen, ['src/a.ts'])
    await git.stage(target, seen, 'all')
    expect(raw.stage.mock.calls).toEqual([
      [{ worktree_id: target.id, expected_head: seen.head, paths: ['src/a.ts'] }],
      [{ worktree_id: target.id, expected_head: seen.head, all: true }],
    ])
  })
  it('discards only with the observation looked at, and says it was confirmed', async () => {
    const raw = client()
    await nodePathGit(raw as never).discard(target, seen, ['src/a.ts'])
    expect(raw.discard).toHaveBeenCalledWith({
      worktree_id: target.id,
      paths: ['src/a.ts'],
      expected_observation_id: 'seen-observation',
      confirmed: true,
    })
    await expect(
      nodePathGit(raw as never).discard(target, { kind: 'commit', commit: seen.head }, ['x'])
    ).rejects.toThrow('Refresh')
  })
  it('says a git refusal in the node’s words with git’s own under it, and an unknown outcome plainly', async () => {
    const failing = client({
      commit: vi.fn(async () => ({
        state: 'failed',
        code: 'hook_failed',
        message: 'A commit hook refused the commit.',
        output: 'lint: 1 problem',
      })),
      push: vi.fn(async () => ({ state: 'outcome_unknown' })),
    })
    const git = nodePathGit(failing as never)
    await expect(git.commit(target, seen, 'Message')).rejects.toThrow(
      'A commit hook refused the commit.\n\nlint: 1 problem'
    )
    await expect(git.push(target, seen)).rejects.toThrow('Refresh to see what happened')
  })
  it('returns the files a rebase stopped on', async () => {
    const raw = client()
    expect(
      await nodePathGit(raw as never).update(target, seen, 'refs/remotes/origin/main')
    ).toEqual({
      conflicts: ['src/a.ts'],
    })
    expect(raw.update).toHaveBeenCalledWith({
      worktree_id: target.id,
      expected_head: seen.head,
      base_ref: 'refs/remotes/origin/main',
    })
  })
  it('replaces the remote branch only with the lease the person saw, fetches, and makes a branch here', async () => {
    const raw = client({
      fetch: vi.fn(async () => ({ state: 'fetched' })),
      createBranch: vi.fn(async () => ({ state: 'created' })),
    })
    const git = nodePathGit(raw as never)
    await git.push(target, seen, 'c'.repeat(40))
    expect(raw.push).toHaveBeenCalledWith({
      worktree_id: target.id,
      expected_head: seen.head,
      force_with_lease: 'c'.repeat(40),
    })
    await git.fetch(target)
    expect(raw.fetch).toHaveBeenCalledWith({ worktree_id: target.id })
    await git.createBranch(target, 'sample-branch', seen.head!, seen)
    expect(raw.createBranch).toHaveBeenCalledWith({
      worktree_id: target.id,
      name: 'sample-branch',
      start_point: seen.head,
      switch: true,
      expected_head: seen.head,
    })
  })
  it('keeps the node’s reason code on a refusal, so a rejected push can offer a replacement', async () => {
    const git = nodePathGit(
      client({
        push: vi.fn(async () => ({ state: 'failed', code: 'push_rejected', message: 'Rejected.' })),
      }) as never
    )
    await expect(git.push(target, seen)).rejects.toMatchObject({ code: 'push_rejected' })
  })
  it('reads a service’s pull request as the panel lists it', () => {
    expect(
      pullSummary({ number: 7, title: 'Sample', draft: true, head: { ref: 'sample-branch' } })
    ).toEqual({ number: 7, title: 'Sample', state: 'draft', branch: 'sample-branch' })
  })
})

describe('git actions from the panel', () => {
  function model(git: NodePathPort['git']) {
    const port = {
      catalogue: vi.fn(async () => ({
        folders: [],
        targets: [target],
        sessions: [],
        capabilities: [],
      })),
      inspect: vi.fn(async () => ({ entries: [], changes: [], revision: seen })),
      file: vi.fn(),
      history: vi.fn(),
      commit: vi.fn(),
      watch: vi.fn(async () => () => {}),
      subscribe: vi.fn(async () => () => {}),
      git,
    } as unknown as NodePathPort
    const m = new NodePathModel('sample-node', 'sample-registration', port, {
      get: () => undefined,
      set: () => {},
    })
    return { m, port }
  }
  it('names a refused staging action and clears its banner after the next success', async () => {
    const raw = client({
      stage: vi
        .fn()
        .mockResolvedValueOnce({ state: 'failed', code: 'resource_busy', message: 'resource_busy' })
        .mockResolvedValue({ state: 'applied' }),
    })
    const { m } = model(nodePathGit(raw as never))
    await m.refresh()
    await m.select(target.id)
    try {
      await m.stage('all')
    } catch (error) {
      m.report(error)
    }
    expect(m.error.value).toContain('Could not stage the files')
    expect(m.error.value).not.toContain('delet')
    await m.stage('all')
    expect(m.error.value).toBe('')
    expect(raw.stage).toHaveBeenCalledTimes(2)
    m.destroy()
  })
  it('acts on what the panel shows, one action at a time, and reads the worktree again after', async () => {
    let release = () => {}
    const git = nodePathGit(
      client({
        stage: vi.fn(
          () => new Promise((resolve) => (release = () => resolve({ state: 'applied' })))
        ),
      }) as never
    )
    const { m, port } = model(git)
    await m.refresh()
    await m.select(target.id)
    const reads = vi.mocked(port.inspect).mock.calls.length
    const staging = m.stage(['src/a.ts'])
    expect(m.gitBusy.value).toBe('stage')
    await expect(m.commit('Message')).rejects.toThrow('still running')
    release()
    await staging
    expect(m.gitBusy.value).toBe('')
    expect(vi.mocked(port.inspect).mock.calls.length).toBeGreaterThan(reads)
    m.destroy()
  })
  it('offers nothing on a node without git writes', async () => {
    const { m } = model(undefined)
    await m.refresh()
    await m.select(target.id)
    await expect(m.stage('all')).rejects.toThrow('updated node')
    m.destroy()
  })
})
