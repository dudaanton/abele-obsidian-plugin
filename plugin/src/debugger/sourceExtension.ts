import { createApp, h, ref } from 'vue'
import type { CodeSelection } from '@/views/codeSelectionHost'
import DebugSource from '@/components/debugger/DebugSource.vue'
import TracePointEditor from '@/components/debugger/trace/TracePointEditor.vue'
import { DebuggerService } from './DebuggerService'
import { marginMenu, namesOnLine, openRun, savePoint } from './trace/panel'

/** The node file tab supplies identity from its source/build mapping, never a guessed path.
 * DebugSource adds only the margin/current line, not a second set of controls. */
export interface DebugSourceContext {
  registrationId: string
  conversationId: string
  sourceId: string
  debugSessionId: string
  incarnation: string
  path: string
  text: string
}
export interface DebugSourceExtension {
  update(text: string): void
  destroy(): void
}
export function mountDebugSource(
  host: HTMLElement,
  context: DebugSourceContext,
  selection?: (action: 'ask' | 'add' | 'note', selected: CodeSelection & { path: string }) => void
): DebugSourceExtension {
  const service = DebuggerService.instance,
    text = ref(context.text),
    /** The line whose record point is being set up under it. */
    editing = ref<number>()
  const unregister = service.registerSource(
    context.registrationId,
    context.conversationId,
    context.sourceId,
    context.path,
    context.debugSessionId,
    context.incarnation
  )
  const app = createApp({
    render() {
      void service.active.value // also refresh when a previously unopened binding becomes active
      const binding = service.forSource(context.registrationId, context.conversationId)
      if (binding) void binding.revision.value
      const candidate = binding?.controller
      const matched =
        candidate?.snapshot?.debug_session_id === context.debugSessionId &&
        candidate.snapshot.incarnation === context.incarnation
      const model = matched ? candidate : undefined,
        snapshot = model?.snapshot
      const frame = model?.session.frames[model.session.frame]
      const trace = matched ? binding?.trace : undefined
      const marked = trace
        ?.breakpoints()
        .filter((b) => b.file === context.path || b.file === context.sourceId)
      const fail = (e: unknown) => binding?.fail(e)
      return h(
        DebugSource,
        {
          text: text.value,
          path: context.path,
          editing: editing.value,
          tails: !!trace,
          breakpoints:
            marked ??
            snapshot?.breakpoints
              .filter((b) => b.source_id === context.sourceId)
              .map((b) => ({
                file: context.path,
                line: b.resolved_line ?? b.line,
                state:
                  b.status === 'verified' || b.status === 'relocated'
                    ? 'set'
                    : b.status === 'rejected'
                      ? 'rejected'
                      : 'pending',
                reason: b.message ?? undefined,
              })) ??
            [],
          line:
            (model?.session.status === 'paused' || model?.session.status === 'lost') &&
            (frame?.file === context.path || frame?.file === context.sourceId)
              ? frame.line
              : undefined,
          stale: !model?.current,
          onSelection: selection,
          onBreakpoint: (line: number) => {
            if (binding && matched)
              void binding.controller
                .toggleBreakpoint(context.sourceId, line)
                .catch((e) => binding.fail(e))
          },
          onEditPoint: (line: number) => {
            if (trace) editing.value = line
          },
          onMarginMenu: (line: number, event: MouseEvent) => {
            if (binding && matched)
              marginMenu(binding, context.sourceId, line, event, (l) => (editing.value = l))
          },
          onOpenHits: () => {
            const newest = trace?.runs[0]
            if (binding && newest) openRun(binding, newest.id)
          },
        },
        {
          'point-editor': ({ line }: { line: number }) =>
            binding && trace
              ? h(TracePointEditor, {
                  key: line,
                  line,
                  point: marked?.find((b) => b.line === line && b.kind === 'record'),
                  inScope: namesOnLine(text.value, line),
                  onSave: (edit: { take: string[]; when?: string; note?: string }) => {
                    editing.value = undefined
                    void savePoint(binding, context.sourceId, line, edit)
                  },
                  onCancel: () => (editing.value = undefined),
                  onRemove: () => {
                    editing.value = undefined
                    const p = trace.pointAt(context.sourceId, line)
                    if (p) void trace.removePoint(p.id).catch(fail)
                  },
                  onToBreakpoint: () => {
                    editing.value = undefined
                    const p = trace.pointAt(context.sourceId, line)
                    if (p) void trace.toBreakpoint(p.id).catch(fail)
                  },
                })
              : null,
        }
      )
    },
  })
  app.mount(host)
  return {
    update(value) {
      text.value = value
    },
    destroy() {
      app.unmount()
      unregister()
    },
  }
}
export const registerDebugSourceRevealer = (
  handler: Parameters<DebuggerService['registerRevealer']>[0]
) => DebuggerService.instance.registerRevealer(handler)
