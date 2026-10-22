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
it('explains the missing command context in an ordinary chat before dispatch', async () => {
  await expect(
    resolveManagerTargets(client as never, 'command.v1.run', {
      worktree_id: 'sample-tree',
      argv: ['node', '--version'],
    })
  ).rejects.toThrow(/command_context_unavailable.*node.*session/i)
})
it.fails(
  'BUG: resolves a command context for a scoped ordinary chat without a provider session',
  async () => {
    const result = await resolveManagerTargets(client as never, 'command.v1.run', {
      worktree_id: 'sample-tree',
      argv: ['node', '--version'],
    })
    expect(result.session_id).toEqual(expect.any(String))
  }
)
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
