import { requireNodeActionPermission } from '../nodeActionPermissions'
import { requireGrantFreeDelegation } from '@/node/delegationCapability'
import { requireDelegationScope } from './node/delegationScope'
import { nodeScopeEntries } from '../nodeScope'
import { t } from '@/i18n'
import { z } from 'zod'
import type { AgentTool } from '../client'
import type { ChatSession } from '../ChatSession'
import { NodeService } from '@/node/NodeService'
import { resolveManagerTargets } from '@/node/managerTargets'
import { nodeMutationKey } from './node/mutations'
import { commandJustification } from '@/node/commandJustification'
import { managerCapability } from '@/node/NodeManagerController'
const id = z.string().min(1).max(128)
const targets = z.looseObject({ node: id, session_id: id.optional(), operation_id: id.optional() })
export const NODE_COMMAND_TOOLS = [
  'node_command_run',
  'node_command_status',
  'node_command_cancel',
  'node_git_integrate',
]
export function createNodeManagerTools(owner?: ChatSession): AgentTool[] {
  return NODE_COMMAND_TOOLS.map((name) => ({
    name,
    label: t(
      name === 'node_command_run'
        ? 'settings.metadata.nodeManagerRun'
        : name === 'node_command_status'
          ? 'settings.metadata.nodeManagerStatus'
          : name === 'node_command_cancel'
            ? 'settings.metadata.nodeManagerCancel'
            : 'settings.metadata.nodeManagerIntegrate'
    ),
    category: 'Nodes',
    description:
      name === 'node_command_run'
        ? 'Run argv (literal arguments) OR command in an accessible project_id, worktree_id or delegation workspace_id. Ordinary chats need no provider session, delegation or terminal binding. With one scoped folder it may be inferred; otherwise choose an explicit target. A specific worktree takes precedence over project_id. Requires node 0.4.47+ with command_context_v1. Required justification: one short sentence in the chat language explaining what you want to do and why (max 200 characters). Optional cwd, timeout_ms and output_bytes (1024–16384 per stream). The owner mode controls execution: Ask returns one exact pending approval and executes nothing before the owner allows it; bypass runs without a card. Never supply or change permission_mode. Owner answers in chat; never answer prompts yourself. A receipt is not execution success. Preserve exact body and operation_id after uncertainty; poll node_command_status with the receipt session_id (context journal, not a provider session) and run_id for exit_code, stdout/stderr and truncation flags. Use node_git_status, node_git_diff and node_git_log for read-only Git inspection.'
        : name === 'node_git_integrate'
          ? 'Integrate source_worktree_id (or source_workspace_id from delegation) into worktree_id (or workspace_id) using git_integrate_v1. Supply target_branch, source_branch and full expected_target_head/expected_source_head from fresh status reads. rebase defaults false (fast-forward only); true rebases the developer in its own worktree first. Ask mode creates an exact owner approval; without-asking mode must not show an approval card on nodes that support it. Poll node_command_status. After successful integration, report the retained developer worktree and offer removal; never remove it without the owner. Show conflicting_files and outcome_unknown plainly; inspect both heads before a new attempt, never retry blindly. Older nodes retain existing git tools; do not emulate integration with a shell command or create unmanaged worktrees through commands.'
          : name === 'node_command_status'
            ? 'Read the current/final status of this parent chat’s command or integration using session_id and run_id. Read-only; no owner approval. Returns bounded output, exit code, truncation flags and conflicts.'
            : 'Cancel this parent chat’s pending or running command using session_id, run_id and stable operation_id. An already running integration refuses cancellation; inspect its status.',
    parameters: {
      type: 'object',
      properties: {
        ...Object.fromEntries(
          [
            'node',
            'session_id',
            'operation_id',
            'run_id',
            'project_id',
            'worktree_id',
            'workspace_id',
            'source_workspace_id',
            'source_worktree_id',
            'command',
            'cwd',
            'target_branch',
            'source_branch',
            'expected_target_head',
            'expected_source_head',
          ].map((key) => [key, { type: 'string' }])
        ),
        argv: { type: 'array', items: { type: 'string' } },
        timeout_ms: { type: 'integer' },
        output_bytes: { type: 'integer' },
        rebase: { type: 'boolean' },
        justification: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description:
            'One short sentence in the chat language explaining to the owner what you want to do and why. Display-only; the exact command remains authoritative.',
        },
      },
      required: [
        'node',
        ...(name !== 'node_command_run' ? ['session_id'] : []),
        ...(name === 'node_command_status'
          ? ['run_id']
          : name === 'node_command_cancel'
            ? ['operation_id', 'run_id']
            : name === 'node_git_integrate'
              ? [
                  'operation_id',
                  'target_branch',
                  'source_branch',
                  'expected_target_head',
                  'expected_source_head',
                ]
              : ['operation_id']),
        ...(['node_command_run', 'node_git_integrate'].includes(name) ? ['justification'] : []),
      ],
    },
    execute: async (_call, raw, signal, context) => {
      if (signal?.aborted) throw new Error('Manager call cancelled')
      const parent = context?.session ?? owner
      if (!parent) throw new Error('Manager tool requires an executing parent chat')
      const permission = () => requireNodeActionPermission(parent, name, context?.approved === true)
      permission()
      const parentId = await parent.ensureDelegationParentId()
      permission()
      const { node, operation_id, ...input } = targets.parse(raw)
      let justification: string | undefined
      if (['node_command_run', 'node_git_integrate'].includes(name)) {
        justification = commandJustification.parse(input.justification)
        delete input.justification
      }
      const service = NodeService.getInstance()
      const matches = service.nodes.value.filter((n) => n.id === node || n.expectedNodeId === node)
      if (matches.length !== 1) throw new Error('Choose an explicit node registration')
      const connection = service.connection(matches[0].id)
      const nodeId = matches[0].expectedNodeId ?? matches[0].id
      if (!nodeScopeEntries(parent).some((entry) => entry.node_id === nodeId))
        requireDelegationScope(parent, nodeId)
      if (
        name === 'node_command_run' &&
        !input.project_id &&
        !input.worktree_id &&
        !input.workspace_id &&
        !input.session_id
      ) {
        const scoped = nodeScopeEntries(parent).filter(
          (e) => e.node_id === nodeId && e.kind !== 'node'
        )
        if (scoped.length === 1) {
          const entry = scoped[0]
          if (entry.kind === 'target' && entry.target.kind === 'worktree')
            input.worktree_id = entry.target.worktree_id
          else if (entry.kind === 'target' && entry.target.kind === 'workspace')
            input.workspace_id = entry.target.workspace_id
          else if (entry.kind === 'project') input.project_id = entry.project_id
        }
      }
      await connection.connect()
      if (signal?.aborted) throw new Error('Manager call cancelled')
      const description = await connection.client.describe()
      if (name === 'node_git_integrate' && parent.permissionMode?.value === 'allow-all')
        throw new Error(t('node.manager.integrateBypassUpdate'))
      if (name === 'node_command_run' && !managerCapability(description, 'command_context_v1')) {
        try {
          return await connection.manager.refuse(
            parentId,
            input,
            id.parse(operation_id),
            parent.permissionMode?.value === 'allow-all' ? 'bypass' : 'ask',
            justification!,
            new Error(t('node.manager.contextUpdate'))
          )
        } finally {
          await connection.refreshDelegations()
        }
      }
      if (name === 'node_git_integrate') requireGrantFreeDelegation(description)
      const method =
        name === 'node_command_run'
          ? 'command.v1.run'
          : name === 'node_git_integrate'
            ? 'git.v1.integrate'
            : 'command.v1.cancel'
      const params = await resolveManagerTargets(
        connection.client,
        name === 'node_command_status' ? 'command.v1.status' : method,
        input
      )
      const sessionId = name === 'node_command_run' ? undefined : id.parse(params.session_id)
      const storedTarget =
        sessionId && name !== 'node_git_integrate'
          ? await connection.manager.targetFor(parentId, sessionId, id.parse(params.run_id))
          : undefined
      if (storedTarget) Object.assign(params, storedTarget)
      const guards: (() => void)[] = [permission]
      const entries = nodeScopeEntries(parent).filter((entry) => entry.node_id === nodeId)
      if (entries.some((entry) => entry.kind === 'node')) {
        guards.push(requireDelegationScope(parent, nodeId))
      } else {
        if (name !== 'node_command_run' && !storedTarget) {
          const session = await connection.client.getSession(sessionId!)
          const binding = await connection.client.nodePath.sessionWorktreeGet({
            session_id: sessionId!,
          })
          const workspace = session.workspace_id
            ? await connection.client.getWorkspace(session.workspace_id)
            : undefined
          guards.push(
            requireDelegationScope(
              parent,
              nodeId,
              workspace?.project_id ?? binding.project_id,
              session.workspace_id ?? undefined,
              binding.target.kind === 'worktree' ? binding.target.worktree_id : undefined
            )
          )
        }
        if (typeof params.project_id === 'string')
          guards.push(requireDelegationScope(parent, nodeId, params.project_id))
        for (const worktree of [params.worktree_id, params.source_worktree_id]) {
          if (typeof worktree !== 'string') continue
          let found = false
          for (const project of new Set(
            entries.flatMap((entry) => (entry.kind !== 'node' ? [entry.project_id] : []))
          )) {
            let cursor: string | undefined
            do {
              const page = await connection.client.repository.worktrees({
                project_id: project,
                cursor,
                limit: 256,
              })
              const row = page.entries.find((row) => row.worktree_id === worktree)
              if (row) {
                guards.push(
                  requireDelegationScope(
                    parent,
                    nodeId,
                    project,
                    row.workspace_id ?? undefined,
                    worktree
                  )
                )
                found = true
                break
              }
              if (!page.cursor || page.cursor === cursor) break
              cursor = page.cursor
            } while (!found)
            if (found) break
          }
          if (!found)
            throw new Error(
              'worktree_not_found: This worktree was not found in the accessible projects. Use worktree_id from status, or pass the delegation workspace_id.'
            )
        }
      }
      const guard = () => {
        if (signal?.aborted) throw new Error('Manager call cancelled')
        guards.forEach((check) => check())
      }
      guard()
      let value: unknown
      if (name === 'node_command_status')
        value = await connection.manager.status(parentId, sessionId!, id.parse(params.run_id))
      else if (name === 'node_command_run') {
        if (!operation_id) throw new Error('A stable operation_id is required')
        const mode = parent.permissionMode?.value === 'allow-all' ? 'bypass' : 'ask'
        try {
          value = await connection.manager.command(
            parentId,
            params,
            operation_id,
            mode,
            justification!,
            () => {
              guard()
              if (mode === 'bypass' && parent.permissionMode?.value !== 'allow-all')
                throw new Error(t('node.manager.permissionChanged'))
            }
          )
        } catch (error) {
          await connection
            .refreshDelegations()
            .catch((refreshError) =>
              console.debug('[Abele node] refused command card awaits refresh', refreshError)
            )
          throw error
        }
      } else {
        if (!operation_id) throw new Error('A stable operation_id is required')
        value = await connection.manager.mutate(
          parentId,
          name === 'node_git_integrate' ? 'git.v1.integrate' : 'command.v1.cancel',
          name === 'node_command_cancel'
            ? { session_id: sessionId, run_id: params.run_id }
            : params,
          nodeMutationKey(parentId, name, operation_id, params),
          operation_id,
          justification
        )
      }
      guard()
      await connection.refreshDelegations()
      const completed = value as { method?: string; state?: string; run_id?: string }
      const cleanup =
        completed.method === 'git.v1.integrate' && completed.state === 'applied' && completed.run_id
          ? await connection.manager.cleanupFor(parentId, completed.run_id)
          : undefined
      guard()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(cleanup ? { ...completed, worktree_cleanup: cleanup } : value),
          },
        ],
      }
    },
  }))
}
