import type { Prompt } from '@abele/node-client'
import type { NodeManagerController } from '@/node/NodeManagerController'
export function nodeManagerFixture(
  state: import('@abele/node-protocol').ManagerRun['state'] = 'pending_approval'
): Awaited<ReturnType<NodeManagerController['cards']>>[number] {
  const prompt: Prompt = {
    kind: 'permission' as const,
    prompt_id: 'sample-command-prompt',
    session_id: 'sample-session',
    run_id: 'sample-command',
    revision: 1 as const,
    action_digest: 'b'.repeat(64),
    expires_at: Number.MAX_SAFE_INTEGER,
    state: 'pending' as const,
    choice: null,
    installation_id: null,
    delivered: false,
    tool_name: 'command.v1.run',
    title: 'Run sample project checks',
    input: {
      method: 'command.v1.run',
      params: { argv: ['npm', 'test'], project_id: 'sample-project' },
      cwd: '/workspace/sample-project',
    },
  }
  return {
    operation: 'sample-operation',
    title: ['failed', 'applied', 'outcome_unknown'].includes(state)
      ? 'work/sample-parser → main'
      : 'npm test -- tests/sample-parser.test.ts',
    answers: {},
    prompts: state === 'pending_approval' ? [prompt] : [],
    run: {
      run_id: 'sample-command',
      prompt_id: prompt.prompt_id,
      session_id: prompt.session_id,
      method: ['failed', 'applied', 'outcome_unknown'].includes(state)
        ? 'git.v1.integrate'
        : 'command.v1.run',
      state,
      stdout: ['pending_approval', 'denied'].includes(state)
        ? ''
        : 'Sample check output\n'.repeat(20),
      stderr: state === 'failed' ? 'Sample rebase conflict' : '',
      stdout_truncated: state === 'running',
      stderr_truncated: false,
      ...(state === 'exited' ? { exit_code: 0 } : {}),
      ...(state === 'applied' ? { head: 'c'.repeat(40) } : {}),
      ...(state === 'failed'
        ? { reason: 'rebase_conflict', conflicting_files: ['src/sample-parser.ts'] }
        : {}),
      ...(state === 'outcome_unknown' ? { reason: 'restart' } : {}),
    },
  }
}
