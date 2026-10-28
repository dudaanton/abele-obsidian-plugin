// The recording the agent's trace tools read: the debugger session open in the panel.
import type { TraceToolContext } from '@/ai/tools/TraceTools'
import { DebuggerService } from '../DebuggerService'
import { writeRunNote } from './runNote'

export function activeTraceContext(): TraceToolContext | undefined {
  const service = DebuggerService.instance
  const binding = service.active.value
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
      })),
    addPoint: async (file, line, edit, guard = () => {}) => {
      guard()
      current()
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
      await trace.savePoint(source, line, edit)
    },
    removePoint: async (file, line, guard = () => {}) => {
      guard()
      current()
      const source = service.sourceFor(binding, file) ?? binding.controller.mappedSource(file)?.[0]
      const point = binding.controller
        .knownBreakpoints()
        .find(
          (b) =>
            b.sourceId === source &&
            b.requestedLine === line &&
            trace.points.some((p) => p.breakpoint_id === b.id)
        )
      if (!point) throw new Error(`No record point at ${file}:${line}`)
      guard()
      current()
      await trace.removePoint(point.id)
    },
    writeNote: (runId) =>
      writeRunNote({ registrationId: binding.registrationId, projectId, runId }, trace.rpc),
  }
}
