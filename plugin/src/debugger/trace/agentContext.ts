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
    addPoint: async (file, line, edit) => {
      const source = service.sourceFor(binding, file)
      if (!source)
        throw new Error(
          `${file} is not open from the node in this debug session; ask the person to open it first.`
        )
      await trace.savePoint(source, line, edit)
    },
    writeNote: (runId) =>
      writeRunNote({ registrationId: binding.registrationId, projectId, runId }, trace.rpc),
  }
}
