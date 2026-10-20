import type { DebuggerController } from './DebuggerController'

/** Re-attach carries intent, while an identical point already restored by the node stays one. */
export async function restoreBreakpoint(
  controller: DebuggerController,
  sourceId: string,
  point: {
    requestedLine: number
    condition?: string
    enabled?: boolean
    log_message?: string
    hit_condition?: string
  }
): Promise<void> {
  const known = controller.snapshot?.breakpoints.find(
    (b) =>
      b.source_id === sourceId &&
      b.line === point.requestedLine &&
      b.condition === point.condition &&
      b.log_message === point.log_message &&
      b.hit_condition === point.hit_condition
  )
  if (known && (known.enabled !== false) === (point.enabled !== false)) return
  if (point.enabled === undefined && !point.log_message && !point.hit_condition) {
    await controller.setBreakpoint(
      known?.breakpoint_id ?? crypto.randomUUID(),
      sourceId,
      point.requestedLine,
      point.condition
    )
    return
  }
  await controller.setBreakpoint(
    known?.breakpoint_id ?? crypto.randomUUID(),
    sourceId,
    point.requestedLine,
    point.condition,
    {
      enabled: point.enabled,
      log_message: point.log_message,
      hit_condition: point.hit_condition,
    }
  )
}
