export interface ManualControlWitness {
  kind: 'editable' | 'noneditable' | 'sizing-copy'
  physical: boolean
  focused: boolean
  nativeKeyboard: number
  fullHeight: number
  baselineInnerHeight: number
  baselineVisualHeight: number
  innerHeight: number
  visualTop: number
  visualHeight: number
  acknowledged: boolean
  initialTarget: boolean
  trustedFocus: boolean
}

/** Browser-serialized prerequisite; physical editable controls need software-keyboard proof. */
export function manualControlReady(sample: ManualControlWitness): boolean {
  if (sample.kind === 'sizing-copy') return true
  if (!sample.focused) return false
  if (!sample.physical || sample.kind !== 'editable') return true
  const keyboard = Math.max(
    0,
    sample.nativeKeyboard,
    sample.baselineInnerHeight - sample.innerHeight,
    sample.baselineVisualHeight - sample.visualHeight
  )
  return sample.acknowledged && sample.initialTarget && sample.trustedFocus && keyboard > 0
}
