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

export async function canvasDispatchOnce<T>(
  state: CanvasControlState,
  invoke: () => T | Promise<T>,
  observe: () => unknown | Promise<unknown>
): Promise<T> {
  const phase = canvasControlFailure(state)
  if (phase) throw new CanvasProbeError(phase, new Error('control is not admitted'), state)
  return canvasProbeOnce('native-reply-unknown', invoke, observe)
}
