// Resolve the recording by source or explicit process without changing the viewed session.
import type { TraceToolContext } from '@/ai/tools/TraceTools'
import { DebuggerService, type DebuggerBinding, type SourceAdmission } from '../DebuggerService'
import { describeAttachment, type Attachment } from './attachment'
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
        try {
          owner = service.fileBinding(folder, params.file)
        } catch {
          /* An explicit selector resolves shared-source ambiguity. */
        }
        if (owner && owner !== matched)
          throw new Error(
            `This file belongs to another process (${attachmentOf(owner).name}); use that process or omit the explicit selector.`
          )
      }
    } else {
      const attached = service.attachedBindings(folder)
      if (attached.length === 1) selected = attached[0]
      else pendingFile = true
    }
  }
  const binding = selected
  const trace = binding?.trace
  const projectId = trace?.projectId
  if (!binding || !trace || !projectId) return undefined
  const sessionId = binding.sessionId
  const incarnation = binding.controller.snapshot?.incarnation
  const attachedDescription = (file: string) => {
    const attached = folder ? service.attachedBindings(folder) : [binding]
    if (!attached.length) return 'Nothing is attached in this folder.'
    return attached.map((entry) => describeAttachment(attachmentOf(entry), file)).join('\n')
  }
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
            .map((line) => `${file}:${line} · pending · ${attachedDescription(file)}`)
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
          .map((b) => `${b.file}:${b.requestedLine} · ${b.state} · ${attachmentOf(binding).name}`)
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
          reason: `${attachedDescription(file)} The point is pending in the folder; select a process if several are attached.`,
        }
      }
      if (!binding.controller.current || binding.controller.session.unavailable)
        throw new Error(
          'The debug session has ended or detached. Attach to the program before setting a record point.'
        )
      let source = service.sourceFor(binding, file)
      let admission: SourceAdmission | undefined
      if (!source) {
        admission = await service.admitSessionFile(binding, file)
        guard()
        current()
        source = service.sourceFor(binding, file)
        if (!source && admission.message)
          throw new Error(
            `${describeAttachment(admission.attachment ?? attachmentOf(binding), file)} ${admission.message}`
          )
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
          reason: `${describeAttachment(admission?.attachment ?? attachmentOf(binding), file, true)} ${point?.reason || 'The point is pending in this process.'}`,
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
      const points = new Set(
        binding.controller
          .knownBreakpoints()
          .filter((b) => atLine(b) && trace.points.some((p) => p.breakpoint_id === b.id))
          .map((b) => b.id)
      )
      if (source) for (const id of trace.registeredPointIds(source, line, file)) points.add(id)
      if (!points.size) throw new Error(`No record point at ${file}:${line}`)
      for (const id of points) {
        guard()
        current()
        await trace.removePoint(id)
      }
      current()
      if (
        (source && trace.registeredPointIds(source, line, file).length) ||
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

function attachmentOf(binding: DebuggerBinding): Attachment {
  const target = binding.controller.snapshot?.target
  const launch = target?.launch_configuration_id ?? ''
  const pid = target?.process_evidence?.pid ?? Number(/ · pid (\d+)$/.exec(launch)?.[1])
  return {
    name:
      binding.entryPath?.split('/').pop() ||
      launch.split(' · pid ')[0].split('/').pop() ||
      'program',
    ...(Number.isFinite(pid) ? { pid } : {}),
    folder: DebuggerService.instance.folder(binding)?.location?.path ?? 'folder path unknown',
    files: [],
  }
}
