// Resolve the recording by source or explicit process without changing the viewed session.
import type { TraceToolContext } from '@/ai/tools/TraceTools'
import { DebuggerService, type DebuggerBinding } from '../DebuggerService'
import type { PathTarget } from '@/node/NodePathModel'
import { writeRunNote } from './runNote'

export function activeTraceContext(
  params: Record<string, unknown> = {}
): TraceToolContext | undefined {
  const service = DebuggerService.instance
  const binding = service.active.value
  const folder = binding && service.folder(binding)
  return traceContextFor(binding, folder ? { ...folder } : undefined, params)
}

function traceContextFor(
  captured: DebuggerBinding | null,
  folder: PathTarget | undefined,
  params: Record<string, unknown>
): TraceToolContext | undefined {
  const service = DebuggerService.instance
  if (
    typeof params.file === 'string' &&
    /^(?:\/|[a-z]:)|\\|(?:^|\/)\.\.(?:\/|$)|(?:^|\/)\.git(?:\/|$)|\0/i.test(params.file)
  )
    throw new Error('Use a source path inside the node folder')
  let selected = captured
  let pendingFile = false
  if (folder && (params.file || params.session || params.process !== undefined)) {
    const matched = service.fileBinding(
      folder,
      typeof params.file === 'string' ? params.file : '',
      {
        session: typeof params.session === 'string' ? params.session : undefined,
        process: typeof params.process === 'number' ? params.process : undefined,
      }
    )
    if (matched) {
      selected = matched
      if (typeof params.file === 'string' && (params.session || params.process !== undefined)) {
        let owner: typeof matched | undefined
        let ambiguous = false
        try {
          owner = service.fileBinding(folder, params.file)
        } catch {
          ambiguous = true
        }
        if (owner && owner !== matched)
          throw new Error(
            `This file belongs to another process (${owner.sessionId}); use that session or omit the explicit selector.`
          )
        if (!owner && !ambiguous && matched.controller.snapshot?.lifecycle === 'active')
          pendingFile = true
      }
    } else pendingFile = true
  }
  const binding = selected
  const trace = binding?.trace
  const projectId = trace?.projectId
  if (!binding || !trace || !projectId) return undefined
  const sessionId = binding.sessionId
  const incarnation = binding.controller.snapshot?.incarnation
  const current = () => {
    if (
      binding.trace !== trace ||
      binding.sessionId !== sessionId ||
      binding.controller.snapshot?.incarnation !== incarnation
    )
      throw new Error('Debug session changed; retry trace_point_add')
  }
  return {
    select: (params) => {
      current()
      return traceContextFor(binding, folder, params)
    },
    sessionId,
    rpc: trace.rpc,
    projectId,
    registrationId: binding.registrationId,
    worktreeId: binding.controller.snapshot?.target.worktree_id ?? undefined,
    workspaceId: binding.controller.snapshot?.target.workspace_id ?? undefined,
    runs: async () =>
      (await trace.rpc.runs(projectId)).runs.map((r) => ({
        id: r.id,
        name: r.name,
        steps: r.steps,
        state: r.state,
        debugSessionId: r.debug_session_id,
      })),
    listPoints: async () => {
      const file = typeof params.file === 'string' ? params.file : undefined
      if (pendingFile && folder && file)
        return (
          service
            .pendingBreakpoints(folder, file)
            .filter((line) => service.pendingPoint(folder, file, line)?.record)
            .map((line) => `${file}:${line} · pending · process not attached`)
            .join('\n') || 'No record points in this folder.'
        )
      return (
        binding.controller
          .knownBreakpoints()
          .filter((b) => trace.points.some((p) => p.breakpoint_id === b.id))
          .filter(
            (b) =>
              !params.file ||
              b.file === params.file ||
              (typeof params.file === 'string' &&
                service.sourceFor(binding, params.file) === b.sourceId)
          )
          .map((b) => `${b.file}:${b.requestedLine} · ${b.state} · ${binding.sessionId}`)
          .join('\n') || 'No record points in this session.'
      )
    },
    addPoint: async (file, line, edit, guard = () => {}) => {
      guard()
      current()
      if (pendingFile && folder) {
        service.editPendingPoint(folder, file, line, {
          record: { take: edit.take, note: edit.note },
          condition: edit.when,
        })
        return {
          recording: false,
          reason:
            'No attached process runs this file. The point is pending in the folder and will apply when its process attaches.',
        }
      }
      if (!binding.controller.current || binding.controller.session.unavailable)
        throw new Error(
          'The debug session has ended or detached. Attach to the program before setting a record point.'
        )
      let source = service.sourceFor(binding, file)
      if (!source) {
        const admission = await service.admitSessionFile(binding, file)
        guard()
        current()
        source = service.sourceFor(binding, file)
        if (!source && admission.message) throw new Error(admission.message)
      }
      if (!source)
        throw new Error(
          `Cannot attach ${file} to this debug session. Use a source path inside the session's node folder and retry trace_point_add.`
        )
      guard()
      current()
      const result = await trace.savePoint(source, line, edit)
      const point = binding.controller
        .knownBreakpoints()
        .find((p) => p.sourceId === source && p.requestedLine === line)
      if (result?.pending || point?.state !== 'set')
        return {
          recording: false,
          reason:
            point?.reason ||
            'The selected process has not bound this source. Check that it runs this file.',
        }
      return { recording: true }
    },
    removePoint: async (file, line, guard = () => {}) => {
      guard()
      current()
      if (pendingFile && folder) {
        if (!service.pendingPoint(folder, file, line)?.record)
          throw new Error(`No record point at ${file}:${line}`)
        service.togglePendingBreakpoint(folder, file, line)
        return
      }
      await trace.refreshPoints()
      guard()
      current()
      const source = service.sourceFor(binding, file) ?? binding.controller.mappedSource(file)?.[0]
      const atLine = (b: ReturnType<typeof binding.controller.knownBreakpoints>[number]) =>
        (b.sourceId === source || b.file === file) && b.requestedLine === line
      // Several adapter registrations can name the same requested location. Removing the
      // person's point removes all of those, within its owning process.
      const points = binding.controller
        .knownBreakpoints()
        .filter((b) => atLine(b) && trace.points.some((p) => p.breakpoint_id === b.id))
      if (!points.length) throw new Error(`No record point at ${file}:${line}`)
      for (const point of points) {
        guard()
        current()
        await trace.removePoint(point.id)
      }
      current()
      if (
        binding.controller
          .knownBreakpoints()
          .some((b) => atLine(b) && trace.points.some((p) => p.breakpoint_id === b.id))
      )
        throw new Error(`Record point removal could not be confirmed at ${file}:${line}`)
    },
    writeNote: (runId) =>
      writeRunNote({ registrationId: binding.registrationId, projectId, runId }, trace.rpc),
  }
}
