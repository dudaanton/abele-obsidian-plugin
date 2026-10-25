import { expect, it, vi } from 'vitest'
import { resolveManagerTargets } from '@/node/managerTargets'
const client = {
  nodePath: {
    sessionWorktreeGet: vi.fn(async () => ({
      target: { kind: 'worktree', worktree_id: 'sample-tree' },
    })),
  },
  getWorkspace: vi.fn(async () => ({ project_id: 'sample-project' })),
  repository: {
    worktrees: vi.fn(async () => ({
      entries: [{ workspace_id: 'sample-workspace', worktree_id: 'sample-tree' }],
    })),
  },
}
it('accepts an explicit target for an ordinary chat without requiring a provider session', async () => {
  expect(
    await resolveManagerTargets(client as never, 'command.v1.run', {
      worktree_id: 'sample-tree',
      argv: ['node', '--version'],
    })
  ).toEqual({ worktree_id: 'sample-tree', argv: ['node', '--version'] })
})
it('normalises a session-less chat target for command context creation', async () => {
  expect(
    await resolveManagerTargets(client as never, 'command.v1.run', {
      workspace_id: 'sample-workspace',
      argv: ['node', '--version'],
    })
  ).toEqual({ worktree_id: 'sample-tree', argv: ['node', '--version'] })
})
it('accepts a delegate workspace and prefers its worktree over the accompanying project', async () => {
  expect(
    await resolveManagerTargets(client as never, 'command.v1.run', {
      session_id: 'sample-session',
      workspace_id: 'sample-workspace',
      project_id: 'sample-project',
      argv: ['pwd'],
    })
  ).toEqual({ session_id: 'sample-session', worktree_id: 'sample-tree', argv: ['pwd'] })
})
it('uses the child session binding when no command target is supplied', async () => {
  expect(
    await resolveManagerTargets(client as never, 'command.v1.run', {
      session_id: 'sample-session',
      command: 'pwd',
    })
  ).toEqual({ session_id: 'sample-session', worktree_id: 'sample-tree', command: 'pwd' })
})
it('resolves the source workspace for integration and never forwards alias fields', async () => {
  expect(
    await resolveManagerTargets(client as never, 'git.v1.integrate', {
      session_id: 'sample-session',
      worktree_id: 'target-tree',
      source_workspace_id: 'sample-workspace',
    })
  ).toEqual({
    session_id: 'sample-session',
    worktree_id: 'target-tree',
    source_worktree_id: 'sample-tree',
  })
})
it('refuses an unresolved workspace before dispatch with a useful code', async () => {
  await expect(
    resolveManagerTargets(client as never, 'command.v1.run', {
      session_id: 'sample-session',
      workspace_id: 'missing-workspace',
    })
  ).rejects.toThrow(/worktree_not_found.*workspace/i)
})

it('resolves a plain root workspace to its project without querying Git worktrees', async () => {
  const plain = {
    getWorkspace: vi.fn(async () => ({
      workspace_id: 'sample-folder',
      project_id: 'sample-project',
      kind: 'root',
      state: 'ready',
    })),
    getProject: vi.fn(async () => ({ project_id: 'sample-project', repository_path: null })),
    repository: {
      worktrees: vi.fn(async () => {
        throw new Error('not a repository')
      }),
    },
  }
  expect(
    await resolveManagerTargets(plain as never, 'command.v1.run', {
      workspace_id: 'sample-folder',
      argv: ['pwd'],
    })
  ).toEqual({ project_id: 'sample-project', argv: ['pwd'] })
  expect(plain.repository.worktrees).not.toHaveBeenCalled()
  for (const target of [{ project_id: 'other-project' }, { worktree_id: 'other-tree' }]) {
    await expect(
      resolveManagerTargets(plain as never, 'command.v1.run', {
        workspace_id: 'sample-folder',
        ...target,
        argv: ['pwd'],
      })
    ).rejects.toThrow(/different targets/i)
  }
})
