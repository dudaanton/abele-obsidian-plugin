import { createApp, h, ref } from 'vue'
import DebugSource from '@/components/debugger/DebugSource.vue'
import { DebuggerService } from './DebuggerService'

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
  context: DebugSourceContext
): DebugSourceExtension {
  const service = DebuggerService.instance,
    text = ref(context.text)
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
      return h(DebugSource, {
        text: text.value,
        path: context.path,
        breakpoints:
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
            })) ?? [],
        line:
          (model?.session.status === 'paused' || model?.session.status === 'lost') &&
          (frame?.file === context.path || frame?.file === context.sourceId)
            ? frame.line
            : undefined,
        stale: !model?.current,
        onBreakpoint: (line: number) => {
          if (binding && matched)
            void binding.controller
              .toggleBreakpoint(context.sourceId, line)
              .catch((e) => binding.fail(e))
        },
      })
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
