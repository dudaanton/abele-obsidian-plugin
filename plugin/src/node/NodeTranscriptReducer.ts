import { responseSchema } from '@abele/channel-protocol'
import type { JournalEvent } from '@abele/channel-protocol'
import { obsidianCallMessage, obsidianPromptCall } from './obsidianPresentation'
import {
  PromptSchema,
  SessionSchema,
  providerSessionUpdates,
  type Prompt,
} from '@abele/node-protocol'
import { t } from '@/i18n'
import type { ChatMessage } from '@/ai/types'
import { readAgentReplyText } from '@/ai/replyLinks'
import { piFailure } from './piFailure'
import { cancelledPrompt } from './promptOutcome'
import { LiveTranscript, type LiveProjection } from './liveTranscript'
import {
  UpdateTranscript,
  eventProvider,
  updatesOf,
  type UpdateProjection,
} from './updateTranscript'

export type NodeSessionState = 'idle' | 'queued' | 'accepted' | 'running' | 'needs-attention'
export interface NodeTranscript {
  messages: ChatMessage[]
  /** Creation sequence binds messages to journal worktree transitions, including equal timestamps. */
  messageSequences: Record<string, number>
  children: Record<string, ChatMessage[]>
  activeRuns: string[]
  queuedInputs: { id: string; text: string }[]
  session?: ReturnType<typeof SessionSchema.parse>
  prompts: Prompt[]
  state: NodeSessionState
  artifacts: { messageId: string; artifactId: string; size: number }[]
  unknown: JournalEvent[]
  /** A long-lived session's process, background work, context and compacting. */
  live: LiveProjection
  /** What the agent's updates say beside its messages: its commands, mode, options and plan. */
  agent: UpdateProjection
  /** The changes a pending permission question asks about, by prompt. */
  promptDiffs: Record<string, { path: string; old: string; new: string }[]>
  /** Resolved questions shown with the tool they belonged to. */
  toolPrompts: Record<string, Prompt[]>
}

/** The journal is canonical. Projection is disposable; replay never executes a plugin tool. */
export function reduceTranscript(
  events: readonly JournalEvent[],
  ownerStoppedTurnStarts: ReadonlySet<number> = new Set()
): NodeTranscript {
  const messages = new Map<string, ChatMessage>()
  const obsidianCalls = new Map<string, { name: string; args: unknown; run: string; seq: number }>()
  const callKey = (name: string, args: unknown, run: string): string =>
    JSON.stringify([name, args, run], (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value
    )
  const messageSequences: Record<string, number> = {}
  let sequence = 0
  const prompts = new Map<string, Prompt>()
  const inputs = new Map<string, string>()
  const runs = new Set<string>()
  const runInputs = new Map<string, string>()
  const messageRuns = new Map<string, string>()
  const turnStarts = new Map<string, number>()
  const missingStopReasons = new Map<string, NonNullable<ChatMessage['sessionMark']>>()
  const interruptions: { run: string; from: number; to: number }[] = []
  const artifacts: NodeTranscript['artifacts'] = []
  const unknown: JournalEvent[] = []
  const seen = new Set<number>()
  let session: NodeTranscript['session']
  let at = 0
  let currentRun = ''
  let currentTurn = ''
  let boundaryTurn = ''
  const toolRuns = new Map<string, string>()
  const startedTools = new Set<string>()
  const completedTools = new Set<string>()
  let touchedTools: string[] = []
  const message = (id: string, role: ChatMessage['role']): ChatMessage => {
    let current = messages.get(id)
    if (!current) {
      current = { id, role, content: '', timestamp: at }
      messages.set(id, current)
      messageSequences[id] = sequence
      if (currentTurn && role !== 'user') current.nodeTurnId = currentTurn
    }
    if (currentRun) messageRuns.set(id, currentRun)
    if (role === 'tool-call' && currentRun) {
      toolRuns.set(id, currentRun)
      touchedTools.push(id)
    }
    return current
  }
  let failed = false
  const live = new LiveTranscript(message, runs, (ids, outcome) => {
    for (const id of ids)
      inputs.set(id, outcome === 'success' ? 'completed' : outcome || 'completed')
    failed = outcome !== 'success'
  })
  const agent = new UpdateTranscript(message, live)
  /** Providers that start a call as soon as they report it; ACP agents say when they do. */
  const startsAtCall = new Set(['claude', 'pi', ''])
  /** What the provider's own record says that the shared updates do not. */
  const residual = (
    type: string,
    data: Record<string, unknown>,
    provider: string,
    piError: string,
    decided: string | undefined
  ): boolean => {
    const text = (key: string) => (typeof data[key] === 'string' ? data[key] : '')
    if (type === 'claude.tool.authorization') {
      const tool = message(agent.toolId(provider, text('run_id'), text('tool_use_id')), 'tool-call')
      tool.content = 'Allowed by your Claude settings'
      return true
    }
    if (type === 'claude.message.final' && data.role === 'assistant') {
      const usage = data.usage as Record<string, unknown> | undefined
      const id = agent.messageId(
        provider,
        text('run_id'),
        text('message_id'),
        text('parent_tool_use_id') || null
      )
      const answer = messages.get(id)
      if (
        answer &&
        typeof usage?.input_tokens === 'number' &&
        typeof usage.output_tokens === 'number'
      )
        answer.usage = {
          input: usage.input_tokens,
          output: usage.output_tokens,
          total: usage.input_tokens + usage.output_tokens,
        }
      return false
    }
    if (type === 'pi.message.final' || type === 'pi.message.start')
      piSnapshot(data, provider, type === 'pi.message.final')
    if (piError) {
      const answer = message(piAnswerId(data, provider), 'assistant')
      answer.error = piError
      const input = runInputs.get(text('run_id'))
      if (input) answer.retryInputId = `input:${input}`
      return true
    }
    if (decided) {
      const tool = messages.get(decided)
      if (tool) tool.content = permissionWords(data)
      return true
    }
    return false
  }
  /** The id pi's own updates give an answer. */
  const piAnswerId = (data: Record<string, unknown>, provider: string): string => {
    const run = typeof data.run_id === 'string' ? data.run_id : ''
    const plain = (v: unknown) =>
      typeof v === 'string' || typeof v === 'number' ? String(v) : undefined
    const native = [run || undefined, plain(data.runtime_generation), plain(data.message_id)]
      .filter((v) => v !== undefined)
      .join(':')
      .slice(0, 256)
    return agent.messageId(provider, run, native)
  }
  /**
   * What pi's whole-message snapshot says beyond its text: the calls it asked for (shown before
   * pi reports running them) and, once final, that streamed text it no longer holds is gone.
   */
  const piSnapshot = (data: Record<string, unknown>, provider: string, final: boolean): void => {
    const snapshot = data.message as Record<string, unknown> | undefined
    if (snapshot?.role !== 'assistant' || !Array.isArray(snapshot.content)) return
    const run = typeof data.run_id === 'string' ? data.run_id : ''
    const content = snapshot.content as Record<string, unknown>[]
    content.forEach((block) => {
      if (block?.type !== 'toolCall' || typeof block.id !== 'string' || !block.id) return
      if (agent.hasTool(agent.toolId(provider, run, block.id))) return
      const name = typeof block.name === 'string' ? block.name : 'Tool'
      for (const update of providerSessionUpdates('pi', 'pi.tool.call', {
        tool_use_id: block.id,
        name,
        input: block.arguments,
      }))
        agent.apply(update, provider, run, 0)
    })
    // An empty snapshot of a stopped answer does not take back what was already streamed.
    if (!final || (snapshot.stopReason === 'aborted' && !content.length)) return
    const kept = new Set<number>()
    content.forEach((b, i) => {
      if (b?.type === 'text' || b?.type === 'thinking') kept.add(i)
    })
    agent.keepOnly(piAnswerId(data, provider), kept)
  }
  const permissionDecision = (
    data: Record<string, unknown>,
    provider: string,
    run: string
  ): string | undefined => {
    if (typeof data.tool_call_id !== 'string' || !data.tool_call_id) return undefined
    const id = agent.toolId(provider, run, data.tool_call_id)
    return messages.has(id) ? id : undefined
  }
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(event.seq)) continue
    seen.add(event.seq)
    sequence = event.seq
    const data =
      event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {}
    const text = (key: string) => (typeof data[key] === 'string' ? data[key] : '')
    at = Date.parse(event.at)
    if (event.type === 'obsidian.tools.updated') {
      const call = obsidianCallMessage(data, at)
      if (call) {
        const previous = messages.get(call.id)
        messages.set(call.id, { ...call, timestamp: previous?.timestamp ?? at })
        if (!previous) messageSequences[call.id] = sequence
        if (!obsidianCalls.has(call.id))
          obsidianCalls.set(call.id, {
            name: text('tool_name'),
            args: data.arguments,
            run: text('run_id'),
            seq: sequence,
          })
      }
      continue
    }
    if (event.type === 'obsidian.tools.configured') continue
    currentRun = text('run_id')
    if (event.type === 'turn.started') boundaryTurn = text('turn_id') || `legacy-turn:${event.seq}`
    currentTurn = text('turn_id') || boundaryTurn
    if (event.type === 'turn.completed') boundaryTurn = ''
    touchedTools = []
    if (event.type === 'turn.started' || event.type === 'run.started') {
      missingStopReasons.delete(currentRun)
      turnStarts.set(currentRun, sequence)
      const ids = Array.isArray(data.input_ids) ? data.input_ids.map(String) : []
      for (const id of ids) inputs.set(id, 'delivered')
      const input =
        ids[0] ||
        text('input_id') ||
        (event.type === 'turn.started'
          ? [...inputs].findLast(([, state]) => ['accepted', 'queued'].includes(state))?.[0]
          : undefined)
      if (input) {
        runInputs.set(currentRun, input)
        inputs.set(input, 'delivered')
      }
    }
    if (event.type === 'turn.completed' || event.type === 'run.interrupted') {
      missingStopReasons.delete(currentRun)
      if (data.outcome === 'interrupted' || event.type === 'run.interrupted') {
        const from = turnStarts.get(currentRun) ?? 0
        interruptions.push({ run: currentRun, from, to: sequence })
        for (const [id, run] of toolRuns) {
          if (run !== currentRun || completedTools.has(id) || messageSequences[id] < from) continue
          const tool = messages.get(id)!
          tool.toolExecution = startedTools.has(id) ? 'interrupted' : 'not-run'
          tool.toolStatus = 'rejected'
        }
        if (event.type === 'turn.completed') {
          const line = message(`stopped:${event.seq}`, 'system')
          const reason = text('terminal_reason')
          const ownerStopped = reason === 'stopped_by_owner' || ownerStoppedTurnStarts.has(from)
          line.sessionMark = {
            kind: 'notice',
            level: 'info',
            text: t(ownerStopped ? 'streamB.nodeStopped' : 'streamB.nodeRunEnded'),
            ...(!ownerStopped && reason ? { detail: reason } : {}),
          }
          if (!ownerStopped && !reason) missingStopReasons.set(currentRun, line.sessionMark)
        }
      }
    }
    if (event.type === 'session.process' && data.state === 'exited') {
      const mark = missingStopReasons.get(currentRun)
      if (mark && text('reason')) mark.detail = text('reason')
      missingStopReasons.delete(currentRun)
    }
    if (
      event.type === 'session.process' &&
      data.state === 'exited' &&
      /failed|error|crash|unexpected/.test(text('reason'))
    ) {
      const pending = [...inputs].filter(([, state]) =>
        ['accepted', 'queued', 'delivered'].includes(state)
      )
      for (const [id] of pending) inputs.set(id, 'failed')
      const line = message(`start-failed:${event.seq}`, 'assistant')
      line.error = t('streamB.nodeStartFailed', {
        reason: text('error') || text('reason').replaceAll('_', ' '),
      })
      if (pending[0]) line.retryInputId = `input:${pending[0][0]}`
      failed = true
    }
    if (event.type === 'session.created' || event.type === 'session.updated') {
      const parsed = responseSchema(SessionSchema).safeParse(data)
      if (parsed.success) session = parsed.data
      else unknown.push(event)
      continue
    }
    const provider = eventProvider(event)
    if (provider && event.type.startsWith(`${provider}.`) && (data.artifact_id || data.late)) {
      unknown.push(event)
      // A record the node mapped is already shown through its updates; the whole of it stays
      // in the details.
      if (
        text('artifact_id') &&
        data.mapped !== true &&
        !['claude.raw', 'claude.unknown'].includes(event.type)
      )
        artifacts.push({
          messageId: `event:${event.seq}`,
          artifactId: text('artifact_id'),
          size: Number(data.size),
        })
      continue
    }
    // Accepted input evidence also carries delivery state and origin metadata. Process it
    // independently of the normalized user update, joining both by the canonical input id.
    if (event.type.startsWith('input.'))
      inputs.set(text('input_id'), text('state') || event.type.slice(6))
    if (event.type === 'input.accepted') {
      const input = message(`input:${text('input_id')}`, 'user')
      const replied = readAgentReplyText(text('text'))
      input.content = replied?.content ?? text('text')
      if (replied) input.replyTo = replied.replyTo
      const sender = data.sender as { id?: unknown; title?: unknown } | undefined
      if (sender && typeof sender.id === 'string' && typeof sender.title === 'string')
        input.fromSession = { id: sender.id, title: sender.title }
      const from = data.from_session as { session_id?: unknown; title?: unknown } | undefined
      if (from && typeof from.session_id === 'string')
        input.fromSession = {
          id: from.session_id,
          title: typeof from.title === 'string' ? from.title : '',
        }
    }
    let updates = updatesOf(event)
    updates = updates.filter(
      (update) =>
        !(
          update.kind === 'notice' &&
          update.code === 'extension_warning' &&
          update.text ===
            'pi extension display onTerminalInput is unavailable in this headless run; execution continues'
        )
    )
    if (event.type === 'pi.extension.error' && data.mapped !== true) {
      const extension = text('extension') || text('extension_path') || text('extension_id')
      const reason = text('error') || text('message')
      updates = [
        {
          kind: 'notice',
          level: 'error',
          text:
            extension || reason
              ? t('streamB.nodeExtensionFailed', {
                  extension: extension || t('streamB.nodeUnknownExtension'),
                  reason: reason || t('streamB.nodeMissingDiagnostic'),
                })
              : t('streamB.nodeExtensionMissingDiagnostic'),
        },
      ]
    }
    updates = updates.map((update) =>
      update.kind === 'notice' &&
      update.code === 'extension_error' &&
      update.text === 'A pi extension failed'
        ? { ...update, text: t('streamB.nodeExtensionMissingDiagnostic') }
        : update
    )
    const piError = event.type === 'pi.message.final' ? piFailure(data) : ''
    // pi's failure is said on the answer it belongs to, with the way to send it again.
    if (piError) updates = updates.filter((u) => u.kind !== 'notice')
    // A decision the node took for a call is said on the call itself.
    const decided =
      event.type === 'acp.permission' ? permissionDecision(data, provider, currentRun) : undefined
    if (decided) updates = updates.filter((u) => u.kind !== 'notice')
    for (const update of updates) {
      agent.apply(update, provider, currentRun, event.seq, currentTurn)
      if (update.kind !== 'tool_call' && update.kind !== 'tool_call_update') continue
      const id = agent.toolId(provider, currentRun, update.tool_call_id)
      if (
        update.status === 'in_progress' ||
        (update.kind === 'tool_call' && startsAtCall.has(provider))
      )
        startedTools.add(id)
      if (update.status === 'completed' || update.status === 'failed') {
        startedTools.add(id)
        completedTools.add(id)
        const tool = messages.get(id)
        if (tool) delete tool.toolExecution
      }
    }
    const extra = residual(event.type, data, provider, piError, decided)
    const providerRecord = !!provider && event.type.startsWith(`${provider}.`)
    if (updates.length || extra || (providerRecord && data.mapped === true)) {
      if (piError) unknown.unshift(event)
      continue
    }
    if (event.type === 'session.update') {
      // A kind from a newer node: kept, never drawn as a known one.
      unknown.push(event)
      continue
    }
    if (QUIET_RECORDS.has(event.type)) continue
    if (event.type === 'chat.restored') {
      live.apply('session.process', { state: 'exited' }, at)
      const line = message(`history:${event.seq}`, 'system')
      line.sessionMark = {
        kind: 'notice',
        level: 'info',
        text: t(
          Array.isArray(data.restored_files) && data.restored_files.length
            ? 'streamB.nodeHistoryFilesRestored'
            : 'streamB.nodeHistoryRestored'
        ),
      }
      failed = false
      continue
    }
    if (live.apply(event.type, data, at)) continue
    if (event.type.startsWith('input.')) {
      const state = text('state') || event.type.slice(6)
      inputs.set(text('input_id'), state)
      if (event.type === 'input.accepted') {
        const input = message(`input:${text('input_id')}`, 'user')
        // A reply was sent as links over the words: shown again as the words and its places.
        const replied = readAgentReplyText(text('text'))
        input.content = replied?.content ?? text('text')
        if (replied) input.replyTo = replied.replyTo
        const sender = data.sender as { id?: unknown; title?: unknown } | undefined
        if (sender && typeof sender.id === 'string' && typeof sender.title === 'string')
          input.fromSession = { id: sender.id, title: sender.title }
        const from = data.from_session as { session_id?: unknown; title?: unknown } | undefined
        if (from && typeof from.session_id === 'string')
          input.fromSession = {
            id: from.session_id,
            title: typeof from.title === 'string' ? from.title : '',
          }
      }
    } else if (event.type === 'run.started') {
      runs.add(text('run_id'))
      if (text('input_id')) {
        runInputs.set(text('run_id'), text('input_id'))
        inputs.set(text('input_id'), 'delivered')
      }
      failed = false
    } else if (['run.completed', 'run.failed', 'run.interrupted'].includes(event.type)) {
      runs.delete(text('run_id'))
      const input = runInputs.get(text('run_id'))
      if (input) inputs.set(input, event.type.slice(4))
      failed = event.type !== 'run.completed'
      if (event.type === 'run.interrupted') {
        for (const [id, run] of toolRuns) {
          if (run !== currentRun || completedTools.has(id)) continue
          const tool = messages.get(id)
          if (!tool) continue
          tool.toolExecution = startedTools.has(id) ? 'interrupted' : 'not-run'
          tool.toolStatus = 'rejected'
        }
      }
    } else if (event.type === 'content.delta') {
      const current = message(`run:${text('run_id')}`, 'assistant')
      if (text('artifact_id'))
        artifacts.push({
          messageId: current.id,
          artifactId: text('artifact_id'),
          size: Number(data.size),
        })
      else current.content += text('text')
    } else if (event.type === 'prompt.delivered') {
      const current = prompts.get(text('prompt_id'))
      // Delivery is a separate committed, identity-bound fact, not a full prompt snapshot.
      if (
        current &&
        current.state !== 'pending' &&
        current.run_id === text('run_id') &&
        current.choice === text('choice')
      )
        prompts.set(current.prompt_id, { ...current, delivered: true })
      else unknown.push(event)
    } else if (event.type.startsWith('prompt.')) {
      const parsed = responseSchema(PromptSchema).safeParse(event.data)
      if (parsed.success) prompts.set(parsed.data.prompt_id, parsed.data)
      else unknown.push(event)
    } else if (event.type === 'tool.started') {
      const current = message(`tool:${text('tool_call_id')}`, 'tool-call')
      current.toolName = text('name')
      current.toolParams =
        data.params && typeof data.params === 'object'
          ? (data.params as Record<string, unknown>)
          : {}
      current.toolStatus = 'approved'
      startedTools.add(current.id)
    } else if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const current = message(`tool:${text('tool_call_id')}`, 'tool-call')
      current.toolResult =
        typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
      current.toolStatus = event.type === 'tool.failed' ? 'rejected' : 'approved'
      completedTools.add(current.id)
      delete current.toolExecution
    } else unknown.push(event)
  }
  const attention =
    failed ||
    ['delivery_unknown', 'failed', 'interrupted'].includes([...inputs.values()].at(-1) ?? '') ||
    [...prompts.values()].some((p) => p.state === 'pending')
  const state: NodeSessionState = attention
    ? 'needs-attention'
    : runs.size
      ? 'running'
      : [...inputs.values()].includes('queued')
        ? 'queued'
        : [...inputs.values()].includes('accepted')
          ? 'accepted'
          : 'idle'
  const promptDiffs: NodeTranscript['promptDiffs'] = {}
  const toolPrompts: NodeTranscript['toolPrompts'] = {}
  for (const prompt of prompts.values()) {
    const obsidian = obsidianPromptCall(prompt)
    if (obsidian) {
      if (obsidian.toolDiff)
        promptDiffs[prompt.prompt_id] = [{ path: obsidian.toolPath ?? '', ...obsidian.toolDiff }]
      if (prompt.state !== 'pending') (toolPrompts[obsidian.id] ??= []).push(prompt)
      continue
    }
    if (!prompt.tool_use_id) continue
    const id = agent.toolByNativeId(prompt.tool_use_id, prompt.run_id)
    const tool = id ? messages.get(id) : undefined
    // The call waits for you: its line says so, and the question shows what it would change.
    if (tool && prompt.state === 'pending' && tool.toolResult === undefined)
      tool.toolStatus = 'pending'
    if (id) promptDiffs[prompt.prompt_id] = agent.pendingDiffs(id)
    if (id && prompt.state !== 'pending') {
      ;(toolPrompts[id] ??= []).push(prompt)
    }
  }
  for (const [id, decisions] of Object.entries(toolPrompts)) {
    const tool = messages.get(id)
    const decision = decisions.at(-1)
    if (tool && decision?.choice === 'deny') {
      if (cancelledPrompt(decision)) {
        tool.toolStatus = 'rejected'
        tool.toolExecution = 'not-run'
        tool.toolResult = undefined
        continue
      }
      if (
        tool.toolExecution === 'interrupted' ||
        (tool.toolExecution === 'not-run' &&
          interruptions.some(
            (turn) =>
              turn.run === messageRuns.get(id) &&
              messageSequences[id] >= turn.from &&
              messageSequences[id] <= turn.to
          ))
      )
        continue
      tool.toolStatus = 'rejected'
      tool.toolExecution = 'not-run'
      tool.toolResult = t('node.actionDeniedByOwner')
    }
  }
  const children: NodeTranscript['children'] = {}
  // Provider wrappers and the owner coordinator describe the same bridge call. Only
  // pair preceding wrappers from this trusted bridge, in order, and retain unmatched calls.
  const wrappers = new Map<string, { ids: string[]; next: number }>()
  for (const m of messages.values()) {
    if (m.role !== 'tool-call' || m.id.startsWith('obsidian:')) continue
    const wire = m.toolName?.replace(/^mcp__abele_debugger__/, '')
    if (!wire?.startsWith('obsidian_')) continue
    const key = callKey(wire.slice('obsidian_'.length), m.toolParams, messageRuns.get(m.id) ?? '')
    const bucket = wrappers.get(key) ?? { ids: [], next: 0 }
    bucket.ids.push(m.id)
    wrappers.set(key, bucket)
  }
  for (const call of obsidianCalls.values()) {
    const bucket = wrappers.get(callKey(call.name, call.args, call.run))
    const id = bucket?.ids[bucket.next]
    if (bucket && id && messageSequences[id] < call.seq) {
      messages.delete(id)
      bucket.next++
    }
  }
  // Some runtimes report an empty model error immediately before the interruption receipt.
  // The committed outcome is authoritative; keep partial text, remove that false diagnosis.
  for (const m of messages.values()) {
    if (
      !interruptions.some(
        (turn) =>
          turn.run === messageRuns.get(m.id) &&
          messageSequences[m.id] >= turn.from &&
          messageSequences[m.id] <= turn.to
      )
    )
      continue
    delete m.error
    delete m.retryInputId
    if (m.sessionMark?.kind === 'notice' && m.sessionMark.text === 'The model request failed')
      messages.delete(m.id)
  }
  for (const m of messages.values())
    if (m.parentId && messages.has(m.parentId)) (children[m.parentId] ??= []).push(m)
  return {
    messages: [...messages.values()].filter((m) => !m.parentId || !messages.has(m.parentId)),
    children,
    messageSequences,
    activeRuns: [...runs],
    queuedInputs: [...inputs]
      .filter(([, state]) => ['accepted', 'queued'].includes(state))
      .map(([id]) => ({ id, text: messages.get(`input:${id}`)?.content ?? '' })),
    session,
    prompts: [...prompts.values()],
    state,
    artifacts,
    unknown,
    live: live.projection(),
    agent: agent.projection(),
    promptDiffs,
    toolPrompts,
  }
}

/** Provider records the shared updates carry nothing of, and nothing else needs. */
const QUIET_RECORDS = new Set(['pi.message.start'])

const DECIDED_BY: Record<string, string> = {
  session_mode: 'by the session mode',
  owner: 'by you',
  node: 'by the node',
}
/** What the node decided for a call it was asked about, in words. */
function permissionWords(data: Record<string, unknown>): string {
  const decision = typeof data.decision === 'string' ? data.decision : 'rejected'
  const by = DECIDED_BY[typeof data.by === 'string' ? data.by : ''] ?? ''
  return `${decision[0].toUpperCase()}${decision.slice(1)}${by ? ' ' + by : ''}`
}
