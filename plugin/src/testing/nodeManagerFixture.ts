import type { Prompt } from '@abele/node-client'
import type { NodeManagerController } from '@/node/NodeManagerController'
import { t } from '@/i18n'
export function nodeManagerFixture(
  state: import('@abele/node-protocol').ManagerRun['state'] = 'pending_approval',
  escaped = false,
  codex = false,
  presentation?: {
    managerJustification?: string
    managerCommand?: string
    managerLegacyIntegration?: boolean
    managerOldNode?: boolean
    managerReason?: string
  }
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
      params: {
        argv: escaped ? ['printf', 'sample\nline\r\u202e\u200b'] : ['npm', 'test'],
        project_id: 'sample-project',
      },
      cwd: '/workspace/sample-project',
    },
  }
  if (codex) {
    prompt.tool_name = 'codex.command'
    prompt.input = {
      command: "npm test -- 'sample case'",
      cwd: '/workspace/sample-project',
      reason: 'Run the sample checks outside the restricted environment',
      request_id: 42,
      thread_id: 'sample-hidden-thread',
    }
  }
  if (presentation?.managerCommand !== undefined) {
    prompt.title = t('node.manager.command')
    prompt.input.context_id = 'sample-context'
    prompt.input.command = presentation.managerCommand
    prompt.input.params = { command: presentation.managerCommand }
  }
  if (presentation?.managerLegacyIntegration) {
    prompt.tool_name = 'git.v1.integrate'
    prompt.input = {
      method: 'git.v1.integrate',
      cwd: '/workspace/sample-project',
      params: {
        source_branch: 'work/sample-parser',
        target_branch: 'main',
        expected_source_head: 'a'.repeat(40),
        expected_target_head: 'b'.repeat(40),
        worktree_id: 'sample-target',
        source_worktree_id: 'sample-source',
      },
    }
  }
  if (presentation?.managerOldNode) {
    state = 'failed'
    prompt.session_id = 'unsubmitted-command'
    prompt.input.context_id = 'unsubmitted-command'
  }
  return {
    operation: 'sample-operation',
    justification: presentation?.managerJustification,
    command: presentation?.managerCommand,
    argv: presentation?.managerCommand !== undefined ? undefined : ['npm', 'test'],
    folder: '/workspace/sample-project',
    folderLabel: 'sample-project',
    title: ['failed', 'applied', 'outcome_unknown'].includes(state)
      ? 'work/sample-parser → main'
      : 'npm test -- tests/sample-parser.test.ts',
    answers: {},
    prompts: state === 'pending_approval' ? [prompt] : [],
    run: {
      run_id: 'sample-command',
      prompt_id: prompt.prompt_id,
      session_id: prompt.session_id,
      method: presentation?.managerLegacyIntegration
        ? 'git.v1.integrate'
        : presentation?.managerCommand === undefined &&
            ['failed', 'applied', 'outcome_unknown'].includes(state)
          ? 'git.v1.integrate'
          : 'command.v1.run',
      state,
      stdout:
        presentation?.managerOldNode || ['pending_approval', 'denied'].includes(state)
          ? ''
          : Array.from({ length: 20 }, (_, index) => `Sample check output ${index + 1}\n`).join(''),
      stderr:
        state === 'failed' && !presentation?.managerOldNode
          ? presentation?.managerCommand === undefined
            ? 'Sample rebase conflict'
            : 'Sample executable not found'
          : '',
      stdout_truncated: state === 'running',
      stderr_truncated: false,
      ...(state === 'exited' ? { exit_code: 0 } : {}),
      ...(state === 'applied' ? { head: 'c'.repeat(40) } : {}),
      ...(presentation?.managerOldNode
        ? { reason: t('node.manager.contextUpdate') }
        : state === 'failed'
          ? presentation?.managerCommand === undefined
            ? { reason: 'rebase_conflict', conflicting_files: ['src/sample-parser.ts'] }
            : {
                reason:
                  'executable_not_found: The requested executable was not found in this folder.',
              }
          : {}),
      ...(state === 'outcome_unknown' ? { reason: 'restart' } : {}),
      ...(presentation?.managerReason ? { reason: presentation.managerReason } : {}),
    },
  }
}
