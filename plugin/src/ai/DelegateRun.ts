import { nanoid } from 'nanoid'
import dayjs from 'dayjs'
import { ChatSession } from './ChatSession'
import { ChatService } from './ChatService'
import { AgentRegistry } from './agents/AgentRegistry'
import { RunStorage, type RunBranch, type RunFile, type RunStatus } from './RunStorage'
import type { AgentDefinition } from './agents/types'
import type { PermissionMode, ToolMode } from './types'

/** How often the run file is rewritten while sub-agents are streaming. */
const PERSIST_INTERVAL_MS = 300

export interface DelegateRunOptions {
  agent: AgentDefinition
  task: string
  /** One branch per item. Empty means a single branch running the task itself. */
  items: string[]
  /** How many branches run at once. */
  batchSize: number
  parent: ChatSession
  parentToolCallId: string
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
}

export interface DelegateRunResult {
  runId: string
  branches: RunBranch[]
}

/**
 * Runs one `delegate` call to completion and owns the file it is recorded in.
 *
 * One call is one file, fan-out included, and this is its only writer: N sub-agents streaming
 * at once would otherwise race each other for it. Writes are coalesced on a short timer, so a
 * twenty-branch run costs a handful of writes rather than one per token.
 */
export class DelegateRun {
  readonly runId = nanoid()

  private readonly branches: RunBranch[] = []
  private readonly sessions: ChatSession[] = []
  private persistTimer: number | null = null
  private persisting: Promise<void> | null = null
  private status: RunStatus = 'running'

  constructor(private readonly options: DelegateRunOptions) {}

  async run(): Promise<DelegateRunResult> {
    const { items, batchSize, signal } = this.options

    // The run file links back to the chat that started it, so that chat has to be on disk
    // before the link is written. Its own writes are otherwise deferred.
    await this.options.parent.flush()
    // No items means the task itself is the one piece of work.
    const work = items.length ? items : [this.options.task]

    for (const item of work) {
      this.branches.push({ item, status: 'running', messages: [] })
    }
    this.schedulePersist()

    let completed = 0
    for (let i = 0; i < work.length; i += batchSize) {
      if (signal?.aborted) break

      const slice = work.slice(i, i + batchSize)
      await Promise.all(
        slice.map(async (item, offset) => {
          const index = i + offset
          await this.runBranch(index, item)
          completed++
          this.options.onProgress?.(completed, work.length)
        })
      )
    }

    for (const branch of this.branches) {
      if (branch.status === 'running') branch.status = 'aborted'
    }
    this.status = this.branches.some((b) => b.status === 'error')
      ? 'error'
      : this.branches.some((b) => b.status === 'aborted')
        ? 'aborted'
        : 'done'

    await this.persistNow(true)
    this.destroy()

    return { runId: this.runId, branches: this.branches }
  }

  /** Where the branch transcripts were written, for the parent to point at. */
  get path(): string {
    return RunStorage.getInstance().runPath(this.runId)
  }

  private async runBranch(index: number, item: string): Promise<void> {
    const branch = this.branches[index]
    const { agent, parent, parentToolCallId, signal } = this.options

    const session = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'run',
      agentId: agent.id,
      depth: parent.depth + 1,
      root: parent.root,
      parent: { sessionId: parent.id, toolCallId: parentToolCallId },
      onPersist: () => this.schedulePersist(),
    })
    this.sessions.push(session)

    boundRunToParent(session, parent)

    const message = this.options.items.length ? `${this.options.task}\n\n${item}` : item

    const abort = () => session.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (signal?.aborted) {
        branch.status = 'aborted'
        return
      }
      await session.sendMessage(message)

      branch.messages = [...session.allMessages.value]
      branch.result = session.lastAssistantText()
      branch.status = signal?.aborted ? 'aborted' : session.error.value ? 'error' : 'done'
      if (session.error.value) branch.error = session.error.value
    } catch (err) {
      branch.messages = [...session.allMessages.value]
      branch.status = signal?.aborted ? 'aborted' : 'error'
      branch.error = err instanceof Error ? err.message : String(err)
    } finally {
      signal?.removeEventListener('abort', abort)
      this.schedulePersist()
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null
      void this.persistNow()
    }, PERSIST_INTERVAL_MS)
  }

  private async persistNow(finish = false): Promise<void> {
    // Streaming writes coalesce; the final transcript must wait, then save its own snapshot.
    if (this.persisting !== null && !finish) return
    while (this.persisting !== null) await this.persisting
    const operation = RunStorage.getInstance().save(this.snapshot())
    this.persisting = operation.then(
      (): void => {},
      (): void => {}
    )
    try {
      await operation
    } finally {
      this.persisting = null
    }
  }

  private snapshot(): RunFile {
    const { agent, parent, parentToolCallId, task } = this.options
    return {
      type: 'abele-run',
      runId: this.runId,
      agentId: agent.id,
      agentName: agent.name,
      parentChat: parent.currentChatFile.value?.path ?? '',
      parentToolCallId,
      task,
      created: dayjs().format('YYYY-MM-DD HH:mm'),
      status: this.status,
      depth: parent.depth + 1,
      branches: this.branches.map((b) => ({ ...b, messages: [...b.messages] })),
    }
  }

  private destroy(): void {
    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    for (const session of this.sessions) session.destroy()
    this.sessions.length = 0
  }
}

export const MAX_DELEGATE_DEPTH = 3
export const MAX_DELEGATE_ITEMS = 20
export const MAX_RUNS_PER_CHAT = 50

const PERMISSION_RANK: Record<PermissionMode, number> = {
  'confirm-all': 0,
  'allow-edit': 1,
  'allow-all': 2,
}
const TOOL_RANK: Record<ToolMode, number> = { off: 0, ask: 1, auto: 2 }

function intersectModes(
  a: Record<string, ToolMode>,
  b: Record<string, ToolMode>
): Record<string, ToolMode> {
  const result: Record<string, ToolMode> = {}
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[name] ?? 'off'
    const y = b[name] ?? 'off'
    result[name] = TOOL_RANK[x] <= TOOL_RANK[y] ? x : y
  }
  return result
}

/** No target can widen its parent's access; empty target scopes inherit the parent's. */
export function boundRunToParent(run: ChatSession, parent: ChatSession): void {
  const target = run.agent.value
  const inherit = !target?.fullVaultAccess && !target?.scope.length
  run.applyRunScope(
    inherit ? parent.scopeResolver.entries.value : target.scope,
    inherit ? parent.scopeResolver.fullVaultAccess.value : target.fullVaultAccess,
    parent.scopeResolver.snapshot()
  )
  // Always capture the stricter mode, even when equal: otherwise the computed mode keeps
  // following the executor and a later settings edit can lift it above the parent.
  run.permissionMode.value =
    PERMISSION_RANK[parent.permissionMode.value] < PERMISSION_RANK[run.permissionMode.value]
      ? parent.permissionMode.value
      : run.permissionMode.value
  run.toolModes.value = intersectModes(parent.toolModes.value, run.toolModes.value)
  run.depthLimit = Math.min(parent.depthLimit, parent.agent.value?.maxDelegateDepth ?? 0)
  run.skillCeiling = parent.offeredSkillNames()
  run.githubConnectionCeiling = intersectModes(
    parent.githubAgent()?.githubConnections ?? {},
    target?.githubConnections ?? {}
  )
}

/** Whether an agent is allowed to hand work further down the root-bounded chain. */
export function canDelegate(session: ChatSession): boolean {
  const agent = session.agent.value
  if (!agent) return false
  return session.depth < Math.min(MAX_DELEGATE_DEPTH, agent.maxDelegateDepth, session.depthLimit)
}

/** Resolves a delegation target by id or name, utility agents included. */
export function resolveTargetAgent(idOrName: string): AgentDefinition | null {
  return AgentRegistry.getInstance().resolve(idOrName)
}
