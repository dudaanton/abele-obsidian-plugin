import type { DelegationCard } from '@/node/delegation'
import { OWNER_STOP_REASON } from '@/node/delegation'
export function nodePermissionCardFixture(
  state: 'running' | 'refused' | 'node-opt-in' | 'unknown'
): DelegationCard {
  const running = state === 'running'
  return {
    ...nodeDelegationCardFixture('working'),
    provider: 'codex',
    state: running ? 'running' : 'failed',
    pendingHumanPrompts: 0,
    toolPermissions:
      state === 'unknown'
        ? undefined
        : {
            permission_mode: state === 'refused' ? 'manual' : 'bypassPermissions',
            per_action_approval: false,
            status: running ? 'supported' : 'unsupported',
            reason: running
              ? undefined
              : state === 'refused'
                ? 'interactive_approval_unsupported'
                : 'bypass_not_allowed',
          },
    reports: [],
  }
}
export function nodeDelegationCardFixture(
  state?:
    | 'working'
    | 'done'
    | 'failed'
    | 'empty'
    | 'paused'
    | 'paused-prompt'
    | 'warning'
    | 'prompt'
    | 'answering'
    | 'owner-stopped'
    | 'lost',
  command: string | string[] = 'npm test -- tests/sample-parser.test.ts'
): DelegationCard {
  const card: DelegationCard = {
    delegationId: 'sample-delegation',
    sessionId: 'sample-child',
    nodeId: 'sample-node',
    title: 'Review a sample parser and improve its boundary cases',
    provider: 'pi',
    state: 'completed',
    pendingHumanPrompts: 1,
    reports: [
      {
        seq: 1,
        kind: 'question',
        text: 'A human approval is required in the child chat; this report does not answer it.',
      },
      {
        seq: 2,
        kind: 'result',
        text: 'Implemented the sample parser change and verified the unit tests.\nThe full transcript and changed files remain available in the child chat.',
      },
    ],
  }
  if (state === 'paused' || state === 'paused-prompt') {
    card.state = 'stopped'
    card.reason = 'time_limit'
  }
  if (state === 'warning')
    card.warnings = ['sample-extension: session_shutdown: Sample cleanup warning']
  if (state === 'prompt' || state === 'answering' || state === 'paused-prompt')
    card.prompts = [
      {
        kind: 'permission',
        prompt_id: 'sample-prompt',
        session_id: 'sample-child',
        run_id: 'sample-run',
        revision: 1,
        action_digest: 'a'.repeat(64),
        expires_at: Number.MAX_SAFE_INTEGER,
        state: 'pending',
        choice: null,
        installation_id: null,
        delivered: false,
        tool_name: 'Bash',
        title: 'Run sample checks',
        input: {
          ...(Array.isArray(command) ? { argv: command } : { command }),
          cwd: '/workspace/sample-project/work/sample-parser',
        },
      },
    ]
  if (state === 'answering')
    card.answers = { 'sample-prompt': { choice: 'allow', state: 'pending' } }
  if (!state) return card
  card.branch = 'work/sample-parser-boundaries'
  card.pendingHumanPrompts =
    state === 'working'
      ? 2
      : state === 'prompt' || state === 'answering' || state === 'paused-prompt'
        ? 1
        : 0
  card.state =
    state === 'paused' || state === 'paused-prompt'
      ? 'stopped'
      : state === 'warning'
        ? 'completed'
        : state === 'done'
          ? 'completed'
          : state === 'empty'
            ? 'outcome unknown'
            : state === 'failed'
              ? 'failed'
              : 'running'
  card.activity =
    state === 'empty'
      ? undefined
      : {
          message: 'Checking parser boundaries and validating the sample input. '.repeat(12),
          tool: state === 'working' ? 'Run tests' : undefined,
          files: ['src/parser.ts', 'tests/parser-boundaries.test.ts'],
        }
  if (state === 'empty') card.reports = []
  if (state === 'owner-stopped') {
    card.state = 'stopped'
    card.reason = OWNER_STOP_REASON
  }
  if (state === 'lost') {
    card.state = 'unknown'
    card.reason = 'pi_worker_lost'
    card.reports = []
  }
  return card
}
