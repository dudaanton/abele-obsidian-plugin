import type { DebuggerController } from './DebuggerController'
import type { DebuggerBinding } from './DebuggerService'
import { t } from '@/i18n'

export function forgottenBreakpointLocations(binding: DebuggerBinding | undefined) {
  if (!binding?.forgottenBreakpoints?.size) return []
  return binding.controller
    .knownBreakpoints()
    .filter((point) => binding.forgottenBreakpoints.has(point.id))
    .map(({ file, requestedLine }) => ({ file, requestedLine }))
}

/** The node can restore its retained points too; local removals must win over that history. */
export async function removeForgottenBreakpoints(
  previous: DebuggerBinding | undefined,
  next: DebuggerBinding,
  removed = forgottenBreakpointLocations(previous)
) {
  if (!removed.length) return
  const points = next.controller
    .knownBreakpoints()
    .filter((point) =>
      removed.some((old) => old.file === point.file && old.requestedLine === point.requestedLine)
    )
  if (!points.length) return
  const controller = next.controller
  const target = controller.snapshot
  const current = () =>
    controller.current &&
    controller.snapshot?.debug_session_id === target?.debug_session_id &&
    controller.snapshot?.incarnation === target?.incarnation
  const isPaused = () => controller.session.status === 'paused'
  let heldEpoch: number | undefined
  const initialStop = target?.threads.find(
    (thread) => thread.thread_id === target.selected_thread_id
  )?.stop
  const hits = initialStop?.hit_breakpoint_ids ?? []
  // The node can restore ordinary breakpoints before their record metadata. A stop
  // caused solely by the points explicitly discarded in the ended session is ours
  // to release after removing them; a mixed or unrelated stop stays paused.
  if (
    initialStop?.reason === 'breakpoint' &&
    hits.length &&
    isPaused() &&
    hits.every((id) => points.some((point) => point.id === id))
  )
    heldEpoch = target.stop_epoch
  // Restored record points may fire on every timer tick. Hold execution while patching their
  // intent, rather than racing each capture's changing state fence or removing captures first.
  if (
    next.trace &&
    points.some((point) => next.trace.points.some((record) => record.breakpoint_id === point.id)) &&
    (controller.session.status === 'running' || next.trace.isRecordStop())
  ) {
    let sent = 0
    let requestedPause = false
    for (let round = 0; round < 100; ++round) {
      if (!current()) throw new Error(t('node.error.generic'))
      if (isPaused() && !next.trace.isRecordStop()) {
        const snapshot = controller.snapshot
        const stop = snapshot?.threads.find(
          (thread) => thread.thread_id === snapshot.selected_thread_id
        )?.stop
        if (requestedPause && !stop) {
          await new Promise((resolve) => window.setTimeout(resolve, 20))
          continue
        }
        if (requestedPause && stop?.reason === 'pause') heldEpoch = snapshot?.stop_epoch
        break
      }
      if (controller.session.status === 'running' && !requestedPause) {
        const result = await controller.command('pause')
        if (result && result.outcome === 'completed') requestedPause = true
        // Retry only a proven non-dispatched state-fence rejection; never uncertain effects.
        else if (
          !result ||
          result.outcome !== 'rejected' ||
          result.dispatch !== 'not_dispatched' ||
          result.code !== 'stale_state' ||
          ++sent >= 3
        )
          throw new Error(t('node.error.generic'))
      }
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    }
    if (controller.session.status !== 'paused' || next.trace.isRecordStop())
      throw new Error(t('node.error.generic'))
  }
  for (const point of points) {
    if (controller.snapshot && !current()) throw new Error(t('node.error.generic'))
    if (next.trace?.points.some((record) => record.breakpoint_id === point.id))
      await next.trace.removePoint(point.id)
    else {
      const receipt = await next.controller.removeBreakpoint(point.id)
      if (receipt && receipt.outcome !== 'completed') throw new Error(t('node.error.generic'))
    }
  }
  if (
    heldEpoch !== undefined &&
    current() &&
    controller.snapshot?.stop_epoch === heldEpoch &&
    controller.session.status === 'paused'
  )
    await controller.command('continue')
}

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
