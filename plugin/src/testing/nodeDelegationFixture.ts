import type { DelegationGrant } from '@abele/node-client'
import type { NodeDelegationController } from '@/node/NodeDelegationController'
import type { DelegationCard } from '@/node/delegation'
const grant: DelegationGrant = {
  grant_id: 'sample-grant',
  parent_id: 'sample-parent',
  installation_id: 'sample-installation',
  approved_by: 'sample-installation',
  project_ids: ['sample-project'],
  providers: ['pi'],
  actions: ['create', 'send', 'status', 'cancel', 'read'],
  allow_fake: false,
  revoked: false,
  created_at: '2028-01-01T00:00:00Z',
}
export function nodeDelegationGrantsFixture() {
  let current = { ...grant }
  const controller = {
    restore: async () => {},
    grants: async () => [current],
    approve: async () => {
      current = { ...grant }
      return current
    },
    revoke: async () => {
      current = { ...grant, revoked: true }
      return current
    },
    client: {
      listProjects: async (after?: string) =>
        after
          ? []
          : [
              {
                project_id: 'sample-project',
                root_path: '/workspace/sample-project-with-a-long-name',
                repository_path: '/workspace/sample-project-with-a-long-name',
                trust: 'trusted',
              },
            ],
      describe: async () => ({
        providers: [
          { provider: 'pi', available: true },
          { provider: 'claude', available: true },
          { provider: 'fake', available: true },
        ],
      }),
    },
  } as unknown as NodeDelegationController
  return {
    controller,
    label: 'Sample node',
    parents: [{ id: 'sample-parent', title: 'Sample parent chat with a longer title' }],
    initialParentId: 'sample-parent',
  }
}
export function nodeDelegationCardFixture(
  state?: 'working' | 'done' | 'failed' | 'empty' | 'paused' | 'warning' | 'prompt' | 'answering'
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
  if (state === 'paused') {
    card.state = 'stopped'
    card.reason = 'time_limit'
  }
  if (state === 'warning')
    card.warnings = ['sample-extension: session_shutdown: Sample cleanup warning']
  if (state === 'prompt' || state === 'answering')
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
          command: 'npm test -- tests/sample-parser.test.ts',
          cwd: '/workspace/sample-project/work/sample-parser',
        },
      },
    ]
  if (state === 'answering')
    card.answers = { 'sample-prompt': { choice: 'allow', state: 'pending' } }
  if (!state) return card
  card.branch = 'work/sample-parser-boundaries'
  card.pendingHumanPrompts =
    state === 'working' ? 2 : state === 'prompt' || state === 'answering' ? 1 : 0
  card.state =
    state === 'paused'
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
  return card
}
