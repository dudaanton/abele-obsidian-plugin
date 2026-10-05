export type CanvasProbePhase =
  | 'selector'
  | 'ownership'
  | 'animation'
  | 'hittability'
  | 'native-reply-unknown'
  | 'confirmation-transition'
  | 'capture-launch-unknown'
  | 'capture-await'
  | 'capture-png'
  | 'capture-write'
  | 'capture-reply-unknown'

export interface CanvasControlState {
  present: boolean
  connected: boolean
  owned: boolean
  animating: boolean
  inViewport: boolean
  hittable: boolean
}

/** Pure classification, shared by the live probe and deterministic negative controls. */
export function canvasControlFailure(state: CanvasControlState): CanvasProbePhase | null {
  if (!state.present || !state.connected) return 'selector'
  if (!state.owned) return 'ownership'
  if (state.animating) return 'animation'
  if (!state.inViewport || !state.hittable) return 'hittability'
  return null
}

export class CanvasProbeError extends Error {
  constructor(
    readonly phase: CanvasProbePhase,
    readonly cause: unknown,
    readonly snapshot: unknown = null,
    readonly diagnosticError: unknown = null
  ) {
    super(`Canvas probe [${phase}]: ${cause instanceof Error ? cause.message : 'probe failed'}`)
  }
}

/** Neither input nor capture is retried. Diagnostic failure never replaces the first cause. */
export async function canvasProbeOnce<T>(
  phase: CanvasProbePhase,
  invoke: () => T | Promise<T>,
  observe: () => unknown | Promise<unknown>
): Promise<T> {
  try {
    return await invoke()
  } catch (cause) {
    let snapshot: unknown = null,
      diagnosticError: unknown = null
    try {
      snapshot = await observe()
    } catch (error) {
      diagnosticError = error
    }
    throw new CanvasProbeError(phase, cause, snapshot, diagnosticError)
  }
}

/** Actual phone screenshot orchestration: the observer is never evaluated unguarded. */
export function canvasCapturePhoneOnce(
  path: string,
  screenshot: (path: string) => void,
  observe: () => unknown | Promise<unknown>
): Promise<void> {
  return canvasProbeOnce('capture-reply-unknown', () => screenshot(path), observe)
}

export interface CanvasCaptureJob {
  done?: boolean
  stage?: string
  error?: string
}

/** Observe an acknowledged producer once per query; never admit a completion past its deadline. */
export async function canvasObserveCaptureJob(ports: {
  deadline: number
  now(): number
  read(allowance: number): CanvasCaptureJob | null
  pause(): Promise<void>
  observe(): unknown | Promise<unknown>
  result(job: CanvasCaptureJob): void
}): Promise<CanvasCaptureJob> {
  // The protected CLI contract is three readonly attempts, each with a 1000ms minimum.
  const attempts = 3,
    minimum = 1000
  while (ports.now() < ports.deadline) {
    const remaining = ports.deadline - ports.now()
    if (remaining < attempts * minimum) break
    const allowance = Math.min(5000, Math.floor(remaining / attempts))
    let job: CanvasCaptureJob | null
    try {
      job = ports.read(allowance)
    } catch (cause) {
      throw new CanvasProbeError('capture-reply-unknown', cause)
    }
    // A transport may exceed its allowance; completion is not permission to extend the ceiling.
    if (ports.now() >= ports.deadline) break
    if (job?.done) {
      ports.result(job)
      if (job.error)
        throw new CanvasProbeError(job.stage as CanvasProbePhase, new Error(job.error), job)
      return job
    }
    await ports.pause()
  }
  return canvasProbeOnce(
    'capture-await',
    () => {
      throw new Error('One capture did not complete within the existing 45-second ceiling')
    },
    ports.observe
  )
}

export async function canvasDispatchOnce<T>(
  state: CanvasControlState,
  invoke: () => T | Promise<T>,
  observe: () => unknown | Promise<unknown>
): Promise<T> {
  const phase = canvasControlFailure(state)
  if (phase) throw new CanvasProbeError(phase, new Error('control is not admitted'), state)
  return canvasProbeOnce('native-reply-unknown', invoke, observe)
}
