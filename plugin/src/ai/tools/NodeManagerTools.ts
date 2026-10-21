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
const id = z.string().min(1).max(128)
const targets = z.looseObject({ node: id, session_id: id, operation_id: id.optional() })
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
        ? 'Run argv (literal arguments) OR command in project_id, worktree_id or workspace_id returned by node_delegate. Without a target, use the session worktree. A specific worktree takes precedence over project_id. Optional cwd, timeout_ms and output_bytes (1024–16384 per stream). session_id is an existing node session (for example a developer session). For read-only Git inspection use node_git_status, node_git_diff or node_git_log instead of shell commands; these use the ordinary read permissions. Requires command_run_v1. Returns a pending owner approval, not execution success. Owner answers in chat; never answer prompts yourself. Preserve exact body and operation_id after uncertainty; poll node_command_status for exit_code, stdout/stderr tails and truncation flags.'
        : name === 'node_git_integrate'
          ? 'Integrate source_worktree_id (or source_workspace_id from delegation) into worktree_id (or workspace_id) using git_integrate_v1. Supply target_branch, source_branch and full expected_target_head/expected_source_head from fresh status reads. rebase defaults false (fast-forward only); true rebases the developer in its own worktree first. Always creates an exact owner approval. Poll node_command_status. After successful integration, report the retained developer worktree and offer removal; never remove it without the owner. Show conflicting_files and outcome_unknown plainly; inspect both heads before a new attempt, never retry blindly. Older nodes retain existing git tools; do not emulate integration with a shell command or create unmanaged worktrees through commands.'
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
      },
      required: [
        'node',
        'session_id',
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
      const service = NodeService.getInstance()
      const matches = service.nodes.value.filter((n) => n.id === node || n.expectedNodeId === node)
      if (matches.length !== 1) throw new Error('Choose an explicit node registration')
      const connection = service.connection(matches[0].id)
      const nodeId = matches[0].expectedNodeId ?? matches[0].id
      if (!nodeScopeEntries(parent).some((entry) => entry.node_id === nodeId))
        requireDelegationScope(parent, nodeId)
      await connection.connect()
      if (signal?.aborted) throw new Error('Manager call cancelled')
      requireGrantFreeDelegation(await connection.client.describe())
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
      const sessionId = id.parse(params.session_id)
      const guards: (() => void)[] = [permission]
      const entries = nodeScopeEntries(parent).filter((entry) => entry.node_id === nodeId)
      if (entries.some((entry) => entry.kind === 'node')) {
        guards.push(requireDelegationScope(parent, nodeId))
      } else {
        const session = await connection.client.getSession(sessionId)
        const binding = await connection.client.nodePath.sessionWorktreeGet({
          session_id: sessionId,
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
        value = await connection.manager.status(parentId, sessionId, id.parse(params.run_id))
      else {
        if (!operation_id) throw new Error('A stable operation_id is required')
        value = await connection.manager.mutate(
          parentId,
          name === 'node_command_run'
            ? 'command.v1.run'
            : name === 'node_git_integrate'
              ? 'git.v1.integrate'
              : 'command.v1.cancel',
          params,
          operation_id
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
